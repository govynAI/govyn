/**
 * Approval list API handler for the Govyn proxy.
 *
 * Handles GET /api/approvals — returns a paginated, filtered list of
 * approval requests from the database. Complements the existing
 * per-request approve/deny/poll endpoints in server.ts.
 */

import type http from 'node:http';
import type postgres from 'postgres';

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
  sql: postgres.Sql,
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
  fetchApprovals(sql, statusFilters, limit, offset, agentId)
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

async function fetchApprovals(
  sql: postgres.Sql,
  statusFilters: string[],
  limit: number,
  offset: number,
  agentId: string | null,
): Promise<{
  approvals: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}> {
  // Build WHERE conditions dynamically using postgres tagged template
  // We need to compose fragments conditionally
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIndex = 1;

  if (statusFilters.length > 0) {
    const placeholders = statusFilters.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`status IN (${placeholders})`);
    values.push(...statusFilters);
    paramIndex += statusFilters.length;
  }

  if (agentId) {
    conditions.push(`agent_id = $${paramIndex}`);
    values.push(agentId);
    paramIndex += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total matching rows
  const countQuery = `SELECT COUNT(*)::int AS total FROM approval_requests ${whereClause}`;
  const countResult = await sql.unsafe(countQuery, values as (string | number)[]);
  const total: number = countResult[0]?.total ?? 0;

  // Fetch paginated results
  // Order: pending first (oldest first for urgency), then resolved (most recent decision first)
  const dataQuery = `
    SELECT
      id, agent_id, provider, model, target_path, policy_name,
      estimated_cost, request_summary, status, decided_by,
      decision_notes, decided_at, expires_at, created_at
    FROM approval_requests
    ${whereClause}
    ORDER BY
      CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
      CASE WHEN status = 'pending' THEN created_at END ASC,
      decided_at DESC NULLS LAST
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `;
  const dataValues: (string | number)[] = [...values, limit, offset];
  const rows = await sql.unsafe(dataQuery, dataValues);

  const approvals = rows.map((row: Record<string, unknown>) => ({
    id: row.id,
    agent_id: row.agent_id,
    provider: row.provider,
    model: row.model ?? null,
    target_path: row.target_path,
    policy_name: row.policy_name,
    estimated_cost: row.estimated_cost != null ? parseFloat(String(row.estimated_cost)) : null,
    request_summary: row.request_summary ?? null,
    status: row.status,
    decided_by: row.decided_by ?? null,
    decision_notes: row.decision_notes ?? null,
    decided_at: row.decided_at instanceof Date ? row.decided_at.toISOString() : row.decided_at ?? null,
    expires_at: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));

  return { approvals, total, limit, offset };
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
