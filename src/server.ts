/**
 * HTTP server for the Govyn proxy.
 *
 * Uses Node.js http.createServer() — NOT Express (per BUILD_ROADMAP and ADR-013).
 * Each incoming request is matched via matchRoute and forwarded via forwardRequest.
 * GET /health is served directly via handleHealth.
 * GET /api/costs is served via handleCostApi.
 * GET /api/budgets is served via handleBudgetApi.
 * Budget limits are enforced before forwarding: hard limits return 429, soft limits warn.
 * Unmatched routes return 404 JSON. Errors return appropriate status codes.
 */

import * as http from 'node:http';
import type { ProxyConfig } from './types.js';
import { matchRoute } from './router.js';
import { forwardRequest } from './proxy.js';
import { handleHealth } from './health.js';
import { resolveAgentId } from './agents.js';
import { handleCostApi } from './cost-api.js';
import { handleBudgetApi } from './budget-api.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import { govynEvents } from './events.js';
import type { PricingTable } from './pricing.js';

/**
 * Send a JSON error response.
 */
function sendJsonError(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
  code: string,
): void {
  const body = JSON.stringify({ error: { message, code } });
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

/**
 * Create and start the Govyn HTTP proxy server.
 *
 * @param config - Proxy configuration (port, host, providers, agents, pricing, budgets)
 * @param aggregator - In-memory cost aggregator for tracking request costs
 * @param budgetEnforcer - Budget enforcer for per-agent spending limits (optional, defaults to empty)
 * @param loopDetector - Loop detector for detecting repeated identical requests (optional)
 * @returns The created http.Server instance
 */
export function startServer(
  config: ProxyConfig,
  aggregator: CostAggregator,
  budgetEnforcer?: BudgetEnforcer,
  loopDetector?: LoopDetector,
): http.Server {
  // Cast pricing to PricingTable — ProxyConfig.pricing and PricingTable are structurally equivalent
  const pricingTable = config.pricing as PricingTable;

  // Use provided enforcer or create a default (no limits) enforcer
  const enforcer = budgetEnforcer ?? new BudgetEnforcer(config.budgets, aggregator);

  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';

      // Health check endpoint — serve before proxy routing
      if (url === '/health' && method === 'GET') {
        handleHealth(req, res);
        return;
      }

      // Cost summary API endpoint
      if (url.startsWith('/api/costs') && method === 'GET') {
        handleCostApi(req, res, aggregator);
        return;
      }

      // Budget status API endpoint
      if (url.startsWith('/api/budgets')) {
        handleBudgetApi(req, res, enforcer);
        return;
      }

      // Agent unblock API endpoint: POST /api/agents/:agentId/unblock
      if (method === 'POST' && url.startsWith('/api/agents/') && url.endsWith('/unblock')) {
        // Extract agentId from URL: /api/agents/{agentId}/unblock
        const agentIdMatch = url.match(/^\/api\/agents\/(.+)\/unblock$/);
        const agentId = agentIdMatch ? agentIdMatch[1] : null;
        if (!agentId) {
          sendJsonError(res, 400, 'Invalid agent ID in URL', 'invalid_request');
          return;
        }
        const wasBlocked = enforcer.unblockAgent(agentId);
        if (wasBlocked) {
          const responseBody = JSON.stringify({ success: true, agent_id: agentId });
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(responseBody).toString(),
          });
          res.end(responseBody);
        } else {
          sendJsonError(res, 404, `Agent ${agentId} is not currently blocked`, 'agent_not_blocked');
        }
        return;
      }

      // Resolve agent identity before routing
      const agentIdentity = resolveAgentId(req, config.agents);

      // Check budget before forwarding
      const budgetResult = enforcer.checkBudget(agentIdentity.agentId);

      if (!budgetResult.allowed) {
        // Hard limit exceeded — block with 429
        const resetTime = budgetResult.resetTime ?? new Date().toISOString();
        const resetDate = new Date(resetTime);
        const secondsUntilReset = Math.max(
          0,
          Math.ceil((resetDate.getTime() - Date.now()) / 1000),
        );

        const errorBody = JSON.stringify({
          error: {
            type: 'budget_error',
            code: budgetResult.code,
            message:
              budgetResult.code === 'budget_exceeded_daily'
                ? 'Agent has exceeded its daily budget limit'
                : 'Agent has exceeded its monthly budget limit',
            details: {
              limit_type: budgetResult.code === 'budget_exceeded_daily' ? 'daily' : 'monthly',
              limit_amount: budgetResult.limitAmount,
              current_spend: budgetResult.currentSpend,
              reset_time: resetTime,
              agent_id: agentIdentity.agentId,
            },
          },
        });

        res.writeHead(429, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(errorBody).toString(),
          'retry-after': secondsUntilReset.toString(),
        });
        res.end(errorBody);

        // Also emit internal event for monitoring/alerting
        govynEvents.emit('event', {
          type: 'budget_exceeded',
          agentId: agentIdentity.agentId,
          code: budgetResult.code ?? '',
          limitAmount: budgetResult.limitAmount ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          resetTime,
        });

        return;
      }

      // Build budget warning info if applicable
      let budgetWarning:
        | { percentUsed: number; currentSpend: number; limit: number; resetsAt: string }
        | undefined;

      if (budgetResult.warning && budgetResult.limitAmount !== undefined) {
        const limitPeriod = budgetResult.code?.includes('daily') ? 'daily' : 'monthly';
        budgetWarning = {
          percentUsed: budgetResult.percentUsed ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          limit: budgetResult.limitAmount,
          resetsAt: budgetResult.resetTime ?? new Date().toISOString(),
        };

        // Emit internal budget_warning event
        govynEvents.emit('event', {
          type: 'budget_warning',
          agentId: agentIdentity.agentId,
          percentUsed: budgetResult.percentUsed ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          limit: budgetResult.limitAmount,
          resetsAt: budgetResult.resetTime ?? new Date().toISOString(),
          limitPeriod,
        });
      }

      // Match the request URL to a provider
      const routeMatch = matchRoute(url, config.providers);

      if (!routeMatch) {
        sendJsonError(res, 404, `No route matched for: ${url}`, 'not_found');
        return;
      }

      // Forward the request to the upstream provider, attributing cost to the resolved agent
      forwardRequest(
        req,
        res,
        routeMatch,
        agentIdentity.agentId,
        pricingTable,
        aggregator,
        budgetWarning,
        loopDetector,
        enforcer,
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[server] unhandled forwarding error:', message);
        if (!res.headersSent) {
          sendJsonError(res, 500, 'Internal proxy error', 'internal_error');
        } else if (!res.writableEnded) {
          res.end();
        }
      });
    },
  );

  server.listen(config.port, config.host, () => {
    console.log(`[govyn] Proxy server listening on ${config.host}:${config.port}`);
  });

  return server;
}
