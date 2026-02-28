/**
 * Tests for alert API handler (src/alert-api.ts).
 *
 * Covers: CRUD operations on alert rules, alert history listing with
 * pagination and filtering, and test webhook endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import { handleAlertApi } from '../src/alert-api.js';
import type { AlertManager } from '../src/alert-manager.js';

// ---- Test helpers ----

/** Create a mock IncomingMessage */
function mockRequest(method: string, url: string, body?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any);
  req.method = method;
  req.url = url;

  // Simulate body data emission
  if (body !== undefined) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(body, 'utf8'));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return req;
}

/** Create a mock ServerResponse that captures writes */
function mockResponse(): http.ServerResponse & {
  _statusCode: number;
  _headers: Record<string, string>;
  _body: string;
  _ended: boolean;
} {
  const chunks: Buffer[] = [];
  const res = {
    _statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    _ended: false,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      res._statusCode = statusCode;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    setHeader(name: string, value: string) {
      res._headers[name] = value;
      return res;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    end(body?: string | Buffer) {
      if (body) {
        chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
      }
      res._body = Buffer.concat(chunks).toString('utf8');
      res._ended = true;
    },
    headersSent: false,
  } as any;

  return res;
}

/** Wait for response to end */
function waitForResponse(res: ReturnType<typeof mockResponse>): Promise<void> {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (res._ended) {
        resolve();
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/** Create a mock sql object */
function mockSql() {
  const sqlFn = vi.fn().mockResolvedValue([]) as any;
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  return sqlFn;
}

/** Create a mock AlertManager */
function mockAlertManager(): AlertManager {
  return {
    reloadRules: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    evaluateRule: vi.fn(),
    isInCooldown: vi.fn(),
    fireAlert: vi.fn(),
    handleEvent: vi.fn(),
  } as any;
}

// ---- Tests ----

describe('handleAlertApi', () => {
  let sql: ReturnType<typeof mockSql>;
  let alertManager: AlertManager;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    sql = mockSql();
    alertManager = mockAlertManager();
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('GET /api/alerts/rules', () => {
    it('returns list of all alert rules', async () => {
      const rules = [
        {
          id: 'rule-1',
          name: 'Budget Alert',
          type: 'budget_threshold',
          enabled: true,
          config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
          webhook_url: 'https://hooks.example.com/budget',
          cooldown_minutes: 60,
          last_fired_at: null,
          created_at: new Date('2026-02-28T10:00:00Z'),
          updated_at: new Date('2026-02-28T10:00:00Z'),
        },
      ];
      sql.mockResolvedValueOnce(rules);

      const req = mockRequest('GET', '/api/alerts/rules');
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.rules).toBeDefined();
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].name).toBe('Budget Alert');
    });
  });

  describe('POST /api/alerts/rules', () => {
    it('creates a new alert rule with valid body (201)', async () => {
      const created = [{
        id: 'new-rule-id',
        name: 'Test Rule',
        type: 'budget_threshold',
        enabled: true,
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        webhook_url: 'https://hooks.example.com/test',
        cooldown_minutes: 60,
        last_fired_at: null,
        created_at: new Date('2026-02-28T10:00:00Z'),
        updated_at: new Date('2026-02-28T10:00:00Z'),
      }];
      sql.mockResolvedValueOnce(created);

      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'budget_threshold',
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(201);
      const body = JSON.parse(res._body);
      expect(body.rule).toBeDefined();
      expect(body.rule.id).toBe('new-rule-id');
      expect((alertManager.reloadRules as any)).toHaveBeenCalled();
    });

    it('returns 400 for invalid rule type', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'invalid_type',
        config: {},
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });

    it('returns 400 for missing required fields', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        // missing type, config, webhook_url
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });

    it('returns 400 for missing webhook_url', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'budget_threshold',
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        // missing webhook_url
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });
  });

  describe('PUT /api/alerts/rules/:id', () => {
    it('updates an existing rule', async () => {
      const updated = [{
        id: 'rule-1',
        name: 'Updated Rule',
        type: 'budget_threshold',
        enabled: false,
        config: { agent_id: '*', metric: 'daily', threshold_percent: 90 },
        webhook_url: 'https://hooks.example.com/updated',
        cooldown_minutes: 30,
        last_fired_at: null,
        created_at: new Date('2026-02-28T10:00:00Z'),
        updated_at: new Date('2026-02-28T11:00:00Z'),
      }];
      sql.unsafe.mockResolvedValueOnce(updated);

      const req = mockRequest('PUT', '/api/alerts/rules/rule-1', JSON.stringify({
        name: 'Updated Rule',
        enabled: false,
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.rule).toBeDefined();
      expect(body.rule.name).toBe('Updated Rule');
      expect((alertManager.reloadRules as any)).toHaveBeenCalled();
    });

    it('returns 404 for non-existent rule', async () => {
      sql.unsafe.mockResolvedValueOnce([]);

      const req = mockRequest('PUT', '/api/alerts/rules/non-existent', JSON.stringify({
        name: 'Updated Rule',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(404);
    });
  });

  describe('DELETE /api/alerts/rules/:id', () => {
    it('deletes a rule', async () => {
      sql.mockResolvedValueOnce([{ id: 'rule-1' }]);

      const req = mockRequest('DELETE', '/api/alerts/rules/rule-1');
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(true);
      expect((alertManager.reloadRules as any)).toHaveBeenCalled();
    });

    it('returns 404 for non-existent rule', async () => {
      sql.mockResolvedValueOnce([]);

      const req = mockRequest('DELETE', '/api/alerts/rules/non-existent');
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(404);
    });
  });

  describe('GET /api/alerts/history', () => {
    it('returns paginated alert history', async () => {
      const countResult = [{ total: 1 }];
      const historyRows = [{
        id: 'hist-1',
        rule_id: 'rule-1',
        rule_name: 'Budget Alert',
        rule_type: 'budget_threshold',
        event_type: 'budget_warning',
        event_payload: { type: 'budget_warning' },
        webhook_url: 'https://hooks.example.com/budget',
        webhook_status: 200,
        webhook_error: null,
        fired_at: new Date('2026-02-28T10:00:00Z'),
      }];

      sql.unsafe
        .mockResolvedValueOnce(countResult)
        .mockResolvedValueOnce(historyRows);

      const req = mockRequest('GET', '/api/alerts/history');
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.alerts).toBeDefined();
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('filters by rule_id', async () => {
      sql.unsafe
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      const req = mockRequest('GET', '/api/alerts/history?rule_id=rule-1');
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);

      // Verify sql.unsafe was called with rule_id filter
      const calls = sql.unsafe.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // The WHERE clause should reference rule_id
      const countQuery = calls[0][0] as string;
      expect(countQuery).toContain('rule_id');
    });
  });

  describe('POST /api/alerts/test', () => {
    it('sends a test webhook and returns result', async () => {
      const req = mockRequest('POST', '/api/alerts/test', JSON.stringify({
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(true);
      expect(body.status).toBe(200);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://hooks.example.com/test');
    });

    it('returns failure when webhook delivery fails', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('Connection refused'));

      const req = mockRequest('POST', '/api/alerts/test', JSON.stringify({
        webhook_url: 'https://hooks.example.com/failing',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, sql, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });
});
