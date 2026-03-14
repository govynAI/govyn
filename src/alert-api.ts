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
import type { AlertManager } from './alert-manager.js';
import { deliverWebhookJson, resolveWebhookTarget } from './security.js';

const VALID_RULE_TYPES = new Set(['budget_threshold', 'policy_trigger']);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function handleAlertApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  alertManager: AlertManager,
): void {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  // Parse URL
  const parsed = new URL(url, 'http://localhost');
  const pathname = parsed.pathname;

  // Route dispatch
  if (method === 'GET' && pathname === '/api/alerts/rules') {
    handleListRules(res, alertManager);
    return;
  }

  if (method === 'POST' && pathname === '/api/alerts/rules') {
    readBody(req, (body) => handleCreateRule(res, alertManager, body));
    return;
  }

  if (method === 'PUT' && pathname.startsWith('/api/alerts/rules/')) {
    const id = pathname.replace('/api/alerts/rules/', '');
    readBody(req, (body) => handleUpdateRule(res, alertManager, id, body));
    return;
  }

  if (method === 'DELETE' && pathname.startsWith('/api/alerts/rules/')) {
    const id = pathname.replace('/api/alerts/rules/', '');
    handleDeleteRule(req, res, alertManager, id);
    return;
  }

  if (method === 'GET' && pathname === '/api/alerts/history') {
    handleListHistory(res, alertManager, parsed.searchParams);
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
  alertManager: AlertManager,
): void {
  (async () => {
    try {
      const rules = (await alertManager.listRules()).map(mapRule);
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

      if (!webhook_url || typeof webhook_url !== 'string') {
        sendError(res, 400, 'Missing or invalid webhook_url');
        return;
      }

      const webhookTarget = await resolveWebhookTarget(webhook_url);
      if (!webhookTarget.ok) {
        sendError(res, 400, webhookTarget.error);
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

      const rule = await alertManager.createRule({
        name: name.trim(),
        type,
        enabled: isEnabled,
        config,
        webhookUrl: webhookTarget.target.normalizedUrl,
        cooldownMinutes: cooldown,
      });

      sendJson(res, 201, { rule: mapRule(rule) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[alert-api] Create rule error:', msg);
      sendError(res, 500, 'Failed to create alert rule');
    }
  })();
}

function handleUpdateRule(
  res: http.ServerResponse,
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

      let normalizedWebhookUrl: string | undefined;

      if (parsed.name !== undefined) {
        if (typeof parsed.name !== 'string' || parsed.name.trim().length === 0) {
          sendError(res, 400, 'Missing or invalid name');
          return;
        }
      }
      if (parsed.enabled !== undefined) {
        if (typeof parsed.enabled !== 'boolean') {
          sendError(res, 400, 'enabled must be a boolean');
          return;
        }
      }
      if (parsed.config !== undefined) {
        if (!parsed.config || typeof parsed.config !== 'object') {
          sendError(res, 400, 'Missing or invalid config');
          return;
        }
      }
      if (parsed.webhook_url !== undefined) {
        if (typeof parsed.webhook_url !== 'string') {
          sendError(res, 400, 'Missing or invalid webhook_url');
          return;
        }
        const webhookTarget = await resolveWebhookTarget(parsed.webhook_url);
        if (!webhookTarget.ok) {
          sendError(res, 400, webhookTarget.error);
          return;
        }
        normalizedWebhookUrl = webhookTarget.target.normalizedUrl;
      }
      if (parsed.cooldown_minutes !== undefined) {
        if (!Number.isInteger(parsed.cooldown_minutes) || parsed.cooldown_minutes < 0) {
          sendError(res, 400, 'cooldown_minutes must be a non-negative integer');
          return;
        }
      }

      if (
        parsed.name === undefined
        && parsed.enabled === undefined
        && parsed.config === undefined
        && parsed.webhook_url === undefined
        && parsed.cooldown_minutes === undefined
      ) {
        sendError(res, 400, 'No fields to update');
        return;
      }

      const updatedRule = await alertManager.updateRule({
        id,
        name: parsed.name?.trim(),
        enabled: parsed.enabled,
        config: parsed.config,
        webhookUrl: normalizedWebhookUrl,
        cooldownMinutes: parsed.cooldown_minutes,
      });

      if (!updatedRule) {
        sendError(res, 404, 'Alert rule not found');
        return;
      }

      sendJson(res, 200, { rule: mapRule(updatedRule) });
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
  alertManager: AlertManager,
  id: string,
): void {
  (async () => {
    try {
      const deleted = await alertManager.deleteRule(id);
      if (!deleted) {
        sendError(res, 404, 'Alert rule not found');
        return;
      }

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
  alertManager: AlertManager,
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

      const ruleId = params.get('rule_id');
      const result = await alertManager.listHistory(limit, offset, ruleId);
      sendJson(res, 200, result);
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
      if (!parsed || typeof parsed.webhook_url !== 'string') {
        sendError(res, 400, 'Missing webhook_url');
        return;
      }

      const webhookTarget = await resolveWebhookTarget(parsed.webhook_url);
      if (!webhookTarget.ok) {
        sendError(res, 400, webhookTarget.error);
        return;
      }

      const testPayload = {
        alert: { rule_name: 'Test Alert' },
        event: { type: 'test' },
        fired_at: new Date().toISOString(),
        source: 'govyn',
      };

      try {
        const response = await deliverWebhookJson(webhookTarget.target, testPayload);
        sendJson(res, 200, { success: true, status: response.status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[alert-api] Test webhook delivery failed:', msg);
        sendJson(res, 200, { success: false, error: 'Webhook delivery failed' });
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

function mapRule(row: {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  config: unknown;
  webhookUrl: string;
  cooldownMinutes: number;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    webhook_url: row.webhookUrl,
    cooldown_minutes: row.cooldownMinutes,
    last_fired_at: row.lastFiredAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
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
