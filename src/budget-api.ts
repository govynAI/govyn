/**
 * Budget status API handler for the Govyn proxy server.
 *
 * Routes:
 *   GET /api/budgets          — returns all agent budget statuses
 *   GET /api/budgets/:agentId — returns single agent budget status
 *
 * Non-GET methods return 405. Unknown agents return 404.
 * Error responses use the Govyn-native { error: { type, code, message, details } } format.
 */

import type * as http from 'node:http';
import { BudgetEnforcer } from './budget-enforcer.js';

/**
 * Send a JSON response.
 */
function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const bodyStr = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(bodyStr).toString(),
  });
  res.end(bodyStr);
}

/**
 * Handle GET /api/budgets and GET /api/budgets/:agentId requests.
 *
 * @param req - The incoming HTTP request
 * @param res - The outgoing HTTP response
 * @param budgetEnforcer - The BudgetEnforcer instance to query
 */
export function handleBudgetApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  budgetEnforcer: BudgetEnforcer,
): void {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';

  // Only allow GET
  if (method !== 'GET') {
    sendJson(res, 405, {
      error: {
        type: 'method_not_allowed',
        code: 'method_not_allowed',
        message: 'Only GET requests are supported for /api/budgets',
        details: { allowed_methods: ['GET'] },
      },
    });
    return;
  }

  // Parse path: /api/budgets or /api/budgets/:agentId
  // Strip query string if present
  const pathname = url.split('?')[0] ?? url;
  const match = pathname.match(/^\/api\/budgets(?:\/(.+))?$/);

  if (!match) {
    sendJson(res, 404, {
      error: {
        type: 'not_found',
        code: 'not_found',
        message: `No route matched for: ${url}`,
        details: {},
      },
    });
    return;
  }

  const agentId = match[1];

  if (agentId) {
    // GET /api/budgets/:agentId — single agent status
    // Check if agent has a budget config
    const allStatuses = budgetEnforcer.getAllStatuses();
    const hasConfig = allStatuses.some((s) => s.agentId === agentId);

    if (!hasConfig) {
      sendJson(res, 404, {
        error: {
          type: 'not_found',
          code: 'agent_budget_not_found',
          message: `No budget configuration found for agent: ${agentId}`,
          details: { agentId },
        },
      });
      return;
    }

    const status = budgetEnforcer.getStatus(agentId);
    sendJson(res, 200, status);
  } else {
    // GET /api/budgets — all agent statuses
    const statuses = budgetEnforcer.getAllStatuses();
    sendJson(res, 200, statuses);
  }
}
