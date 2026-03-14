/**
 * Tests for alert API handler (src/alert-api.ts).
 *
 * Covers: CRUD operations on alert rules, alert history listing with
 * pagination and filtering, and test webhook endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
const { deliverWebhookJsonMock, resolveWebhookTargetMock } = vi.hoisted(() => ({
  deliverWebhookJsonMock: vi.fn(),
  resolveWebhookTargetMock: vi.fn(),
}));
vi.mock('../src/security.js', () => ({
  deliverWebhookJson: deliverWebhookJsonMock,
  resolveWebhookTarget: resolveWebhookTargetMock,
}));
import { handleAlertApi } from '../src/alert-api.js';
import type { AlertManager } from '../src/alert-manager.js';

function mockRequest(method: string, url: string, body?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(null as never);
  req.method = method;
  req.url = url;

  process.nextTick(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(body, 'utf8'));
    }
    req.emit('end');
  });

  return req;
}

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

function mockAlertManager(): AlertManager {
  return {
    listRules: vi.fn().mockResolvedValue([]),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    listHistory: vi.fn().mockResolvedValue({ alerts: [], total: 0, limit: 50, offset: 0 }),
    reloadRules: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    evaluateRule: vi.fn(),
    isInCooldown: vi.fn(),
    fireAlert: vi.fn(),
    handleEvent: vi.fn(),
  } as any;
}

describe('handleAlertApi', () => {
  let alertManager: AlertManager;

  beforeEach(() => {
    alertManager = mockAlertManager();
    resolveWebhookTargetMock.mockResolvedValue({
      ok: true,
      target: {
        normalizedUrl: 'https://hooks.example.com/test',
      },
    });
    deliverWebhookJsonMock.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/alerts/rules', () => {
    it('returns list of all alert rules', async () => {
      (alertManager.listRules as any).mockResolvedValueOnce([
        {
          id: 'rule-1',
          name: 'Budget Alert',
          type: 'budget_threshold',
          enabled: true,
          config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
          webhookUrl: 'https://hooks.example.com/budget',
          cooldownMinutes: 60,
          lastFiredAt: null,
          createdAt: new Date('2026-02-28T10:00:00Z'),
          updatedAt: new Date('2026-02-28T10:00:00Z'),
        },
      ]);

      const req = mockRequest('GET', '/api/alerts/rules');
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.rules).toHaveLength(1);
      expect(body.rules[0].name).toBe('Budget Alert');
    });
  });

  describe('POST /api/alerts/rules', () => {
    it('creates a new alert rule with valid body (201)', async () => {
      (alertManager.createRule as any).mockResolvedValueOnce({
        id: 'new-rule-id',
        name: 'Test Rule',
        type: 'budget_threshold',
        enabled: true,
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        webhookUrl: 'https://hooks.example.com/test',
        cooldownMinutes: 60,
        lastFiredAt: null,
        createdAt: new Date('2026-02-28T10:00:00Z'),
        updatedAt: new Date('2026-02-28T10:00:00Z'),
      });

      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'budget_threshold',
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(201);
      const body = JSON.parse(res._body);
      expect(body.rule.id).toBe('new-rule-id');
      expect((alertManager.createRule as any)).toHaveBeenCalled();
    });

    it('returns 400 for invalid rule type', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'invalid_type',
        config: {},
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });

    it('returns 400 for missing required fields', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({ name: 'Test Rule' }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });

    it('returns 400 for missing webhook_url', async () => {
      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Test Rule',
        type: 'budget_threshold',
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
    });

    it('returns 400 for private or loopback webhook targets', async () => {
      resolveWebhookTargetMock.mockResolvedValueOnce({
        ok: false,
        error: 'Invalid webhook_url: private, loopback, or local-network destinations are not allowed',
      });

      const req = mockRequest('POST', '/api/alerts/rules', JSON.stringify({
        name: 'Unsafe Rule',
        type: 'budget_threshold',
        config: { agent_id: '*', metric: 'daily', threshold_percent: 80 },
        webhook_url: 'http://127.0.0.1:9000/hook',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
      expect(deliverWebhookJsonMock).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/alerts/rules/:id', () => {
    it('updates an existing rule', async () => {
      (alertManager.updateRule as any).mockResolvedValueOnce({
        id: 'rule-1',
        name: 'Updated Rule',
        type: 'budget_threshold',
        enabled: false,
        config: { agent_id: '*', metric: 'daily', threshold_percent: 90 },
        webhookUrl: 'https://hooks.example.com/updated',
        cooldownMinutes: 30,
        lastFiredAt: null,
        createdAt: new Date('2026-02-28T10:00:00Z'),
        updatedAt: new Date('2026-02-28T11:00:00Z'),
      });

      const req = mockRequest('PUT', '/api/alerts/rules/rule-1', JSON.stringify({
        name: 'Updated Rule',
        enabled: false,
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.rule.name).toBe('Updated Rule');
      expect((alertManager.updateRule as any)).toHaveBeenCalledWith({
        id: 'rule-1',
        name: 'Updated Rule',
        enabled: false,
        config: undefined,
        webhookUrl: undefined,
        cooldownMinutes: undefined,
      });
    });

    it('returns 404 for non-existent rule', async () => {
      (alertManager.updateRule as any).mockResolvedValueOnce(null);

      const req = mockRequest('PUT', '/api/alerts/rules/non-existent', JSON.stringify({
        name: 'Updated Rule',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(404);
    });
  });

  describe('DELETE /api/alerts/rules/:id', () => {
    it('deletes a rule', async () => {
      (alertManager.deleteRule as any).mockResolvedValueOnce(true);

      const req = mockRequest('DELETE', '/api/alerts/rules/rule-1');
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(true);
      expect((alertManager.deleteRule as any)).toHaveBeenCalledWith('rule-1');
    });

    it('returns 404 for non-existent rule', async () => {
      (alertManager.deleteRule as any).mockResolvedValueOnce(false);

      const req = mockRequest('DELETE', '/api/alerts/rules/non-existent');
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(404);
    });
  });

  describe('GET /api/alerts/history', () => {
    it('returns paginated alert history', async () => {
      (alertManager.listHistory as any).mockResolvedValueOnce({
        alerts: [
          {
            id: 'hist-1',
            rule_id: 'rule-1',
            rule_name: 'Budget Alert',
            rule_type: 'budget_threshold',
            event_type: 'budget_warning',
            event_payload: { type: 'budget_warning' },
            webhook_url: 'https://hooks.example.com/budget',
            webhook_status: 200,
            webhook_error: null,
            fired_at: '2026-02-28T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });

      const req = mockRequest('GET', '/api/alerts/history');
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('filters by rule_id', async () => {
      (alertManager.listHistory as any).mockResolvedValueOnce({
        alerts: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      const req = mockRequest('GET', '/api/alerts/history?rule_id=rule-1');
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      expect((alertManager.listHistory as any)).toHaveBeenCalledWith(50, 0, 'rule-1');
    });
  });

  describe('POST /api/alerts/test', () => {
    it('sends a test webhook and returns result', async () => {
      const req = mockRequest('POST', '/api/alerts/test', JSON.stringify({
        webhook_url: 'https://hooks.example.com/test',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(true);
      expect(body.status).toBe(200);
      expect(resolveWebhookTargetMock).toHaveBeenCalledWith('https://hooks.example.com/test');
      expect(deliverWebhookJsonMock).toHaveBeenCalledOnce();
    });

    it('returns failure when webhook delivery fails', async () => {
      deliverWebhookJsonMock.mockRejectedValueOnce(new Error('Connection refused'));

      const req = mockRequest('POST', '/api/alerts/test', JSON.stringify({
        webhook_url: 'https://hooks.example.com/failing',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('rejects private test webhook targets', async () => {
      resolveWebhookTargetMock.mockResolvedValueOnce({
        ok: false,
        error: 'Invalid webhook_url: private, loopback, or local-network destinations are not allowed',
      });

      const req = mockRequest('POST', '/api/alerts/test', JSON.stringify({
        webhook_url: 'http://localhost:9000/hook',
      }));
      const res = mockResponse();

      handleAlertApi(req, res, alertManager);
      await waitForResponse(res);

      expect(res._statusCode).toBe(400);
      expect(deliverWebhookJsonMock).not.toHaveBeenCalled();
    });
  });
});
