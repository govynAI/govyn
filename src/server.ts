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
import * as crypto from 'node:crypto';
import type { ProxyConfig, LoggingMode, LogEntry } from './types.js';
import { matchRoute } from './router.js';
import { forwardRequest } from './proxy.js';
import { handleHealth } from './health.js';
import { resolveAgentId } from './agents.js';
import { handleCostApi } from './cost-api.js';
import { handleBudgetApi } from './budget-api.js';
import { handleLogApi } from './log-api.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import { govynEvents } from './events.js';
import type { PricingTable } from './pricing.js';
import type { ActionLogger } from './action-logger.js';
import type { PolicyEngine } from './policy-engine.js';
import type { PolicyRequestContext, PolicyEvaluationResult, ModelRouteResult } from './policy-types.js';

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
 * Extract the model name from a JSON request body.
 * Returns undefined if body is missing, not JSON, or has no model field.
 */
function extractModelFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.model === 'string') return parsed.model;
  } catch {
    // Not JSON — no model to extract
  }
  return undefined;
}

/**
 * Extract routing context from a JSON request body for model routing evaluation.
 * Parses messages to extract system prompt, user prompt, tool presence,
 * conversation turns, and estimated token count.
 */
function extractRoutingContext(body: string | undefined): {
  inputTokensEstimate: number;
  systemPrompt?: string;
  userPrompt?: string;
  toolCallsPresent: boolean;
  conversationTurns: number;
} {
  const defaults = {
    inputTokensEstimate: 0,
    systemPrompt: undefined as string | undefined,
    userPrompt: undefined as string | undefined,
    toolCallsPresent: false,
    conversationTurns: 0,
  };
  if (!body) return defaults;

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return defaults;

    // Estimate tokens: count total characters in string content / 4
    let totalChars = 0;

    // Extract system prompt (Anthropic: top-level `system`; OpenAI: messages[].role === "system")
    let systemPrompt: string | undefined;
    if (typeof parsed.system === 'string') {
      systemPrompt = parsed.system;
      totalChars += parsed.system.length;
    }

    // Extract from messages array
    let userPrompt: string | undefined;
    let conversationTurns = 0;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    conversationTurns = messages.length;

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';
      totalChars += content.length;

      if (msg.role === 'system' && !systemPrompt) {
        systemPrompt = content;
      }
      if (msg.role === 'user') {
        userPrompt = content; // last user message wins
      }
    }

    // Check for tool/function definitions
    const toolCallsPresent =
      (Array.isArray(parsed.tools) && parsed.tools.length > 0) ||
      (Array.isArray(parsed.functions) && parsed.functions.length > 0);

    // Add tool definitions to char count for token estimate
    if (toolCallsPresent) {
      totalChars += JSON.stringify(parsed.tools ?? parsed.functions).length;
    }

    const inputTokensEstimate = Math.ceil(totalChars / 4);

    return {
      inputTokensEstimate,
      systemPrompt,
      userPrompt,
      toolCallsPresent,
      conversationTurns,
    };
  } catch {
    return defaults;
  }
}

/**
 * Create and start the Govyn HTTP proxy server.
 *
 * @param config - Proxy configuration (port, host, providers, agents, pricing, budgets)
 * @param aggregator - In-memory cost aggregator for tracking request costs
 * @param budgetEnforcer - Budget enforcer for per-agent spending limits (optional, defaults to empty)
 * @param loopDetector - Loop detector for detecting repeated identical requests (optional)
 * @param actionLogger - Action logger for structured request logging (optional)
 * @param policyEngine - Policy engine for evaluating request policies (optional)
 * @returns The created http.Server instance
 */
export function startServer(
  config: ProxyConfig,
  aggregator: CostAggregator,
  budgetEnforcer?: BudgetEnforcer,
  loopDetector?: LoopDetector,
  actionLogger?: ActionLogger,
  policyEngine?: PolicyEngine,
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

      // Logging mode toggle API: POST /api/logging/mode
      if (method === 'POST' && url === '/api/logging/mode') {
        if (!actionLogger) {
          sendJsonError(res, 503, 'Action logging is not enabled', 'logging_disabled');
          return;
        }

        // Read JSON body
        const bodyChunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
        req.on('end', () => {
          try {
            const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
            const parsed = JSON.parse(bodyStr) as { agent_id?: string; mode?: string };

            if (!parsed.agent_id || typeof parsed.agent_id !== 'string') {
              sendJsonError(res, 400, 'Missing or invalid agent_id', 'invalid_request');
              return;
            }
            if (parsed.mode !== 'metadata' && parsed.mode !== 'full-payload') {
              sendJsonError(res, 400, 'Invalid mode: must be "metadata" or "full-payload"', 'invalid_request');
              return;
            }

            actionLogger.setMode(parsed.agent_id, parsed.mode as LoggingMode);

            const responseBody = JSON.stringify({
              success: true,
              agent_id: parsed.agent_id,
              mode: parsed.mode,
            });
            res.writeHead(200, {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(responseBody).toString(),
            });
            res.end(responseBody);
          } catch {
            sendJsonError(res, 400, 'Invalid JSON body', 'invalid_request');
          }
        });
        return;
      }

      // Log query/purge API endpoints: GET /api/logs, GET /api/logs/:id, GET /api/logs/:id/payload, DELETE /api/logs?before=DATE
      if (url.startsWith('/api/logs')) {
        if (!actionLogger) {
          sendJsonError(res, 503, 'Action logging is not enabled', 'logging_disabled');
          return;
        }
        handleLogApi(req, res, actionLogger);
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

        // Log budget-blocked requests so they appear in action logs
        if (actionLogger) {
          const logEntry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            agent_id: agentIdentity.agentId,
            provider: (matchRoute(url, config.providers)?.providerType ?? 'openai'),
            target: url ?? '/',
            model: null,
            input_tokens: null,
            output_tokens: null,
            cost: null,
            priced: false,
            latency_ms: 0,
            status: 429,
            has_payload: false,
            payload_id: null,
            storage_region: 'auto',
          };
          actionLogger.log(logEntry);
        }

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

      // Buffer the request body for policy evaluation (content_filter needs body access).
      // The buffered body is then passed to forwardRequest to avoid re-reading the stream.
      const bodyChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
      req.on('end', () => {
        const bodyBuffer = Buffer.concat(bodyChunks);
        const bodyString = bodyBuffer.length > 0 ? bodyBuffer.toString('utf8') : undefined;

        // Evaluate policies (between route matching and forwarding)
        let requestedModel = extractModelFromBody(bodyString);
        let actualModel = requestedModel;
        let finalBodyBuffer = bodyBuffer;
        let policyResult: PolicyEvaluationResult | undefined;

        if (policyEngine && policyEngine.getPolicies().length > 0) {
          const routingCtx = extractRoutingContext(bodyString);
          const policyContext: PolicyRequestContext = {
            agentId: agentIdentity.agentId,
            provider: routeMatch.providerType,
            path: routeMatch.upstreamPath,
            method: method,
            body: bodyString,
            headers: req.headers as Record<string, string>,
            model: extractModelFromBody(bodyString),
            inputTokensEstimate: routingCtx.inputTokensEstimate,
            systemPrompt: routingCtx.systemPrompt,
            userPrompt: routingCtx.userPrompt,
            toolCallsPresent: routingCtx.toolCallsPresent,
            conversationTurns: routingCtx.conversationTurns,
          };

          policyResult = policyEngine.evaluate(policyContext);

          if (!policyResult.allowed && policyResult.denied) {
            // Policy denied — determine response code based on policy type
            const denied = policyResult.denied;
            const isRateLimit = denied.policyType === 'rate_limit';
            const statusCode = isRateLimit ? 429 : 403;
            const errorType = isRateLimit ? 'govyn_rate_limited' : 'govyn_policy_violation';

            const errorBody = JSON.stringify({
              error: {
                type: errorType,
                message: denied.message ?? denied.reason ?? `Request blocked by policy '${denied.policyName}'`,
                policy: denied.policyName,
                agent: agentIdentity.agentId,
                retry_after_seconds: denied.retryAfterSeconds ?? null,
              },
            });

            const responseHeaders: Record<string, string> = {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(errorBody).toString(),
            };
            if (isRateLimit && denied.retryAfterSeconds) {
              responseHeaders['retry-after'] = denied.retryAfterSeconds.toString();
            }

            res.writeHead(statusCode, responseHeaders);
            res.end(errorBody);

            // Emit policy_denied event
            govynEvents.emit('event', {
              type: 'policy_denied',
              agentId: agentIdentity.agentId,
              provider: routeMatch.providerType,
              path: routeMatch.upstreamPath,
              policyName: denied.policyName,
              policyType: denied.policyType,
              reason: denied.reason ?? '',
              evaluationTimeMs: policyResult.evaluationTimeMs,
              allowed: false,
            });

            // Log policy-denied request in action logs
            if (actionLogger) {
              const logEntry: LogEntry = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                agent_id: agentIdentity.agentId,
                provider: routeMatch.providerType,
                target: routeMatch.upstreamPath,
                model: null,
                input_tokens: null,
                output_tokens: null,
                cost: null,
                priced: false,
                latency_ms: 0,
                status: statusCode,
                has_payload: false,
                payload_id: null,
                storage_region: 'auto',
                policy_result: {
                  allowed: false,
                  evaluated_count: policyResult.evaluatedCount,
                  matched_count: policyResult.matchedCount,
                  denied_by: denied.policyName,
                  evaluation_time_ms: policyResult.evaluationTimeMs,
                },
              };
              actionLogger.log(logEntry);
            }

            return;
          }

          // Policy allowed — emit enforced event
          govynEvents.emit('event', {
            type: 'policy_enforced',
            agentId: agentIdentity.agentId,
            provider: routeMatch.providerType,
            path: routeMatch.upstreamPath,
            policyCount: policyResult.matchedCount,
            evaluationTimeMs: policyResult.evaluationTimeMs,
            allowed: true,
          });

          // Check for model_route results with routeTo
          const routeResult = policyResult.results.find(
            (r) => r.policyType === 'model_route' && (r as ModelRouteResult).routeTo,
          ) as ModelRouteResult | undefined;

          if (routeResult?.routeTo) {
            // Rewrite the model field in the JSON body
            actualModel = routeResult.routeTo;
            try {
              const parsed = JSON.parse(bodyString ?? '{}');
              parsed.model = actualModel;
              const rewritten = JSON.stringify(parsed);
              finalBodyBuffer = Buffer.from(rewritten, 'utf8');
            } catch {
              // If body parse fails, skip rewriting (passthrough)
            }

            // Emit model_routed event for observability
            govynEvents.emit('event', {
              type: 'model_routed',
              agentId: agentIdentity.agentId,
              provider: routeMatch.providerType,
              requestedModel: requestedModel ?? 'unknown',
              actualModel,
              policyName: routeResult.policyName,
              matchedRuleIndex: routeResult.matchedRuleIndex,
            });
          }
        }

        // Forward the request to the upstream provider, attributing cost to the resolved agent.
        // Pass finalBodyBuffer (rewritten or original) to avoid re-reading the consumed stream.
        // Pass requestedModel so cost tracking records original model before routing.
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
          actionLogger,
          finalBodyBuffer,
          requestedModel !== actualModel ? requestedModel : undefined,
          policyResult,  // pass the evaluation result for action log enrichment
        ).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('[server] unhandled forwarding error:', message);
          if (!res.headersSent) {
            sendJsonError(res, 500, 'Internal proxy error', 'internal_error');
          } else if (!res.writableEnded) {
            res.end();
          }
        });
      });
    },
  );

  server.listen(config.port, config.host, () => {
    console.log(`[govyn] Proxy server listening on ${config.host}:${config.port}`);
  });

  return server;
}
