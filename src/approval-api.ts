/**
 * Approval list API handler for the Govyn proxy.
 *
 * Handles GET /api/approvals — returns a paginated, filtered list of
 * approval requests from the database. Complements the existing
 * per-request approve/deny/poll endpoints in server.ts.
 */

import type http from 'node:http';
import type { ApprovalManager } from './approval.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'denied', 'denied_timeout']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Handle GET /api/approvals with status filtering and pagination.
 *
 * Query parameters:
 * - status: 'pending' | 'approved' | 'denied' | 'denied_timeout' | 'all' (default 'all'), supports comma-separated
 * - limit: 1-200 (default 50)
 * - offset: >= 0 (default 0)
 * - agent_id: optional exact match filter
 */
export function handleApprovalApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  approvalManager: ApprovalManager,
): void {
  const parsed = new URL(req.url!, 'http://localhost');
  const params = parsed.searchParams;

  // Parse and validate status filter
  const statusParam = params.get('status') ?? 'all';
  let statusFilters: string[] = [];

  if (statusParam !== 'all') {
    const parts = statusParam.split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (!VALID_STATUSES.has(part)) {
        sendError(res, 400, `Invalid status value: "${part}". Valid values: pending, approved, denied, denied_timeout, all`);
        return;
      }
    }
    statusFilters = parts;
  }

  // Parse and validate limit
  const limitStr = params.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitStr !== null) {
    limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
      sendError(res, 400, `Invalid limit: must be between 1 and ${MAX_LIMIT}`);
      return;
    }
  }

  // Parse and validate offset
  const offsetStr = params.get('offset');
  let offset = 0;
  if (offsetStr !== null) {
    offset = parseInt(offsetStr, 10);
    if (isNaN(offset) || offset < 0) {
      sendError(res, 400, 'Invalid offset: must be >= 0');
      return;
    }
  }

  // Optional agent_id filter
  const agentId = params.get('agent_id');

  // Build and execute query
  approvalManager.listApprovals(statusFilters, limit, offset, agentId)
    .then((result) => {
      const body = JSON.stringify(result);
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      });
      res.end(body);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[approval-api] Database error:', message);
      sendError(res, 500, 'Failed to fetch approvals');
    });
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
): void {
  const body = JSON.stringify({ error: { message, code: statusCode === 400 ? 'invalid_request' : 'internal_error' } });
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}
