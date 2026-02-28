/**
 * Alert API handler for the Govyn proxy.
 *
 * Handles all /api/alerts/* routes:
 * - GET /api/alerts/rules — list all alert rules
 * - POST /api/alerts/rules — create a new alert rule
 * - PUT /api/alerts/rules/:id — update an existing rule
 * - DELETE /api/alerts/rules/:id — delete a rule
 * - GET /api/alerts/history — list alert history with pagination
 * - POST /api/alerts/test — test webhook delivery
 */

import type http from 'node:http';
import type postgres from 'postgres';
import type { AlertManager } from './alert-manager.js';

const VALID_RULE_TYPES = new Set(['budget_threshold', 'policy_trigger']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function handleAlertApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sql: postgres.Sql,
  alertManager: AlertManager,
): void {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  // Parse URL
  const parsed = new URL(url, 'http://localhost');
  const pathname = parsed.pathname;

  // Route dispatch
  if (method === 'GET' && pathname === '/api/alerts/rules') {
    handleListRules(res, sql);
    return;
  }

  if (method === 'POST' && pathname === '/api/alerts/rules') {
    readBody(req, (body) => handleCreateRule(res, sql, alertManager, body));
    return;
  }

  if (method === 'PUT' && pathname.startsWith('/api/alerts/rules/')) {
    const id = pathname.replace('/api/alerts/rules/', '');
    readBody(req, (body) => handleUpdateRule(res, sql, alertManager, id, body));
    return;
  }

  if (method === 'DELETE' && pathname.startsWith('/api/alerts/rules/')) {
    const id = pathname.replace('/api/alerts/rules/', '');
    handleDeleteRule(req, res, sql, alertManager, id);
    return;
  }

  if (method === 'GET' && pathname === '/api/alerts/history') {
    handleListHistory(res, sql, parsed.searchParams);
    return;
  }

  if (method === 'POST' && pathname === '/api/alerts/test') {
    readBody(req, (body) => handleTestWebhook(res, body));
    return;
  }

  sendError(res, 404, 'Not found');
}

// ---- Route handlers ----

function handleListRules(
  res: http.ServerResponse,
  sql: postgres.Sql,
): void {
  (async () => {
    try {
      const rows = await sql`SELECT * FROM alert_rules ORDER BY created_at DESC`;
      const rules = rows.map(mapRuleRow);
      sendJson(res, 200, { rules });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] Database error:', msg);
      sendError(res, 500, 'Failed to fetch alert rules');
    }
  })();
}

function handleCreateRule(
  res: http.ServerResponse,
  sql: postgres.Sql,
  alertManager: AlertManager,
  body: string,
): void {
  (async () => {
    try {
      const parsed = parseJsonBody(body);
      if (!parsed) {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }

      // Validate required fields
      const { name, type, config, webhook_url, cooldown_minutes, enabled } = parsed;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        sendError(res, 400, 'Missing or invalid name');
        return;
      }

      if (!type || !VALID_RULE_TYPES.has(type)) {
        sendError(res, 400, `Invalid type: must be one of ${[...VALID_RULE_TYPES].join(', ')}`);
        return;
      }

      if (!webhook_url || typeof webhook_url !== 'string' ||
          (!webhook_url.startsWith('http://') && !webhook_url.startsWith('https://'))) {
        sendError(res, 400, 'Missing or invalid webhook_url: must start with http:// or https://');
        return;
      }

      if (!config || typeof config !== 'object') {
        sendError(res, 400, 'Missing or invalid config');
        return;
      }

      // Validate config shape per type
      const configError = validateConfig(type, config);
      if (configError) {
        sendError(res, 400, configError);
        return;
      }

      const cooldown = typeof cooldown_minutes === 'number' ? cooldown_minutes : 60;
      const isEnabled = typeof enabled === 'boolean' ? enabled : true;

      const rows = await sql`
        INSERT INTO alert_rules (name, type, enabled, config, webhook_url, cooldown_minutes)
        VALUES (${name.trim()}, ${type}, ${isEnabled}, ${JSON.stringify(config)}, ${webhook_url}, ${cooldown})
        RETURNING *
      `;

      await alertManager.reloadRules();

      sendJson(res, 201, { rule: mapRuleRow(rows[0]) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] Create rule error:', msg);
      sendError(res, 500, 'Failed to create alert rule');
    }
  })();
}

function handleUpdateRule(
  res: http.ServerResponse,
  sql: postgres.Sql,
  alertManager: AlertManager,
  id: string,
  body: string,
): void {
  (async () => {
    try {
      const parsed = parseJsonBody(body);
      if (!parsed) {
        sendError(res, 400, 'Invalid JSON body');
        return;
      }

      // Build dynamic SET clause
      const setClauses: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (parsed.name !== undefined) {
        setClauses.push(`name = $${paramIndex++}`);
        values.push(parsed.name);
      }
      if (parsed.enabled !== undefined) {
        setClauses.push(`enabled = $${paramIndex++}`);
        values.push(parsed.enabled);
      }
      if (parsed.config !== undefined) {
        setClauses.push(`config = $${paramIndex++}`);
        values.push(JSON.stringify(parsed.config));
      }
      if (parsed.webhook_url !== undefined) {
        setClauses.push(`webhook_url = $${paramIndex++}`);
        values.push(parsed.webhook_url);
      }
      if (parsed.cooldown_minutes !== undefined) {
        setClauses.push(`cooldown_minutes = $${paramIndex++}`);
        values.push(parsed.cooldown_minutes);
      }

      if (setClauses.length === 0) {
        sendError(res, 400, 'No fields to update');
        return;
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(id); // for WHERE clause

      const query = `UPDATE alert_rules SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
      const rows = await sql.unsafe(query, values as (string | number | boolean)[]);

      if (rows.length === 0) {
        sendError(res, 404, 'Alert rule not found');
        return;
      }

      await alertManager.reloadRules();

      sendJson(res, 200, { rule: mapRuleRow(rows[0]) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] Update rule error:', msg);
      sendError(res, 500, 'Failed to update alert rule');
    }
  })();
}

function handleDeleteRule(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  sql: postgres.Sql,
  alertManager: AlertManager,
  id: string,
): void {
  (async () => {
    try {
      const rows = await sql`DELETE FROM alert_rules WHERE id = ${id} RETURNING id`;

      if (rows.length === 0) {
        sendError(res, 404, 'Alert rule not found');
        return;
      }

      await alertManager.reloadRules();

      sendJson(res, 200, { success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] Delete rule error:', msg);
      sendError(res, 500, 'Failed to delete alert rule');
    }
  })();
}

function handleListHistory(
  res: http.ServerResponse,
  sql: postgres.Sql,
  params: URLSearchParams,
): void {
  (async () => {
    try {
      // Parse pagination
      const limitStr = params.get('limit');
      let limit = DEFAULT_LIMIT;
      if (limitStr !== null) {
        limit = parseInt(limitStr, 10);
        if (isNaN(limit) || limit < 1 || limit > MAX_LIMIT) {
          sendError(res, 400, `Invalid limit: must be between 1 and ${MAX_LIMIT}`);
          return;
        }
      }

      const offsetStr = params.get('offset');
      let offset = 0;
      if (offsetStr !== null) {
        offset = parseInt(offsetStr, 10);
        if (isNaN(offset) || offset < 0) {
          sendError(res, 400, 'Invalid offset: must be >= 0');
          return;
        }
      }

      // Optional rule_id filter
      const ruleId = params.get('rule_id');

      // Build dynamic WHERE
      const conditions: string[] = [];
      const values: (string | number)[] = [];
      let paramIndex = 1;

      if (ruleId) {
        conditions.push(`rule_id = $${paramIndex}`);
        values.push(ruleId);
        paramIndex += 1;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countQuery = `SELECT COUNT(*)::int AS total FROM alert_history ${whereClause}`;
      const countResult = await sql.unsafe(countQuery, values);
      const total: number = countResult[0]?.total ?? 0;

      // Fetch paginated results
      const dataQuery = `
        SELECT * FROM alert_history
        ${whereClause}
        ORDER BY fired_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      const dataValues = [...values, limit, offset];
      const rows = await sql.unsafe(dataQuery, dataValues);

      const alerts = rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        rule_id: row.rule_id,
        rule_name: row.rule_name,
        rule_type: row.rule_type,
        event_type: row.event_type,
        event_payload: row.event_payload,
        webhook_url: row.webhook_url,
        webhook_status: row.webhook_status ?? null,
        webhook_error: row.webhook_error ?? null,
        fired_at: row.fired_at instanceof Date ? row.fired_at.toISOString() : row.fired_at,
      }));

      sendJson(res, 200, { alerts, total, limit, offset });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] History error:', msg);
      sendError(res, 500, 'Failed to fetch alert history');
    }
  })();
}

function handleTestWebhook(
  res: http.ServerResponse,
  body: string,
): void {
  (async () => {
    try {
      const parsed = parseJsonBody(body);
      if (!parsed || !parsed.webhook_url) {
        sendError(res, 400, 'Missing webhook_url');
        return;
      }

      const testPayload = {
        alert: { rule_name: 'Test Alert' },
        event: { type: 'test' },
        fired_at: new Date().toISOString(),
        source: 'govyn',
      };

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(parsed.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Govyn-Alerts/1.0',
          },
          body: JSON.stringify(testPayload),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        sendJson(res, 200, { success: true, status: response.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        sendJson(res, 200, { success: false, error: msg });
      }
    } catch {
      sendError(res, 400, 'Invalid JSON body');
    }
  })();
}

// ---- Helpers ----

function readBody(req: http.IncomingMessage, callback: (body: string) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    callback(Buffer.concat(chunks).toString('utf8'));
  });
}

function parseJsonBody(body: string): Record<string, any> | null {
  if (!body || body.trim().length === 0) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function validateConfig(type: string, config: Record<string, unknown>): string | null {
  if (type === 'budget_threshold') {
    if (!config.agent_id || typeof config.agent_id !== 'string') {
      return 'config.agent_id is required (string)';
    }
    if (config.metric !== 'daily' && config.metric !== 'monthly') {
      return 'config.metric must be "daily" or "monthly"';
    }
    const pct = config.threshold_percent;
    if (typeof pct !== 'number' || pct < 1 || pct > 100) {
      return 'config.threshold_percent must be a number between 1 and 100';
    }
  } else if (type === 'policy_trigger') {
    if (!config.policy_name || typeof config.policy_name !== 'string') {
      return 'config.policy_name is required (string)';
    }
    if (!config.agent_id || typeof config.agent_id !== 'string') {
      return 'config.agent_id is required (string)';
    }
  }
  return null;
}

function mapRuleRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    webhook_url: row.webhook_url,
    cooldown_minutes: row.cooldown_minutes,
    last_fired_at: row.last_fired_at instanceof Date
      ? row.last_fired_at.toISOString()
      : row.last_fired_at ?? null,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  };
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
): void {
  const body = JSON.stringify({
    error: {
      message,
      code: statusCode === 400 ? 'invalid_request' : statusCode === 404 ? 'not_found' : 'internal_error',
    },
  });
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}
