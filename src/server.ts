/**
 * HTTP server for the Govyn proxy.
 *
 * Uses Node.js http.createServer() — NOT Express (per BUILD_ROADMAP and ADR-013).
 * Each incoming request is matched via matchRoute and forwarded via forwardRequest.
 * GET /health is served directly via handleHealth.
 * GET /api/costs is served via handleCostApi.
 * Unmatched routes return 404 JSON. Errors return appropriate status codes.
 */

import * as http from 'node:http';
import type { ProxyConfig } from './types.js';
import { matchRoute } from './router.js';
import { forwardRequest } from './proxy.js';
import { handleHealth } from './health.js';
import { resolveAgentId } from './agents.js';
import { handleCostApi } from './cost-api.js';
import { CostAggregator } from './cost-aggregator.js';
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
 * @param config - Proxy configuration (port, host, providers, agents, pricing)
 * @param aggregator - In-memory cost aggregator for tracking request costs
 * @returns The created http.Server instance
 */
export function startServer(config: ProxyConfig, aggregator: CostAggregator): http.Server {
  // Cast pricing to PricingTable — ProxyConfig.pricing and PricingTable are structurally equivalent
  const pricingTable = config.pricing as PricingTable;

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

      // Resolve agent identity before routing
      const agentIdentity = resolveAgentId(req, config.agents);

      // Match the request URL to a provider
      const routeMatch = matchRoute(url, config.providers);

      if (!routeMatch) {
        sendJsonError(res, 404, `No route matched for: ${url}`, 'not_found');
        return;
      }

      // Forward the request to the upstream provider, attributing cost to the resolved agent
      forwardRequest(req, res, routeMatch, agentIdentity.agentId, pricingTable, aggregator).catch(
        (err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('[server] unhandled forwarding error:', message);
          if (!res.headersSent) {
            sendJsonError(res, 500, 'Internal proxy error', 'internal_error');
          } else if (!res.writableEnded) {
            res.end();
          }
        },
      );
    },
  );

  server.listen(config.port, config.host, () => {
    console.log(`[govyn] Proxy server listening on ${config.host}:${config.port}`);
  });

  return server;
}
