/**
 * Integration tests for budget enforcement (hard + soft limits).
 *
 * Tests hard limit blocking with exact trigger point and soft limit
 * warning behavior via X-Govyn-Budget-Warning header.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import type { ProxyConfig, BudgetConfig, CostRecord } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
}

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    const { port, path, method = 'GET', headers = {}, body = '' } = options;
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString();
      reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
    } else {
      reqHeaders['content-length'] = '0';
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try { json = JSON.parse(bodyStr); } catch { json = null; }
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: bodyStr, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    agentId: 'test-agent',
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 1000,
    outputTokens: 500,
    inputCost: 0.0025,
    outputCost: 0.005,
    totalCost: 0.0075,
    priced: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('budget enforcement integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  // Test 1: Hard limit agent-a blocked at budget
  it('hard limit agent is blocked with 429 when daily budget exceeded', async () => {
    const aggregator = new CostAggregator();
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 5.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Pre-populate spend over daily limit
    aggregator.recordCost(makeRecord({ agentId: 'agent-a', totalCost: 5.5, inputCost: 2.0, outputCost: 3.5 }));

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['custom', {
        name: 'custom',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'custom',
      }]]),
      agents: new Map(),
      pricing: new Map(),
      budgets,
    };

    const server = startServer(config, aggregator, enforcer);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await httpRequest({
        port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'agent-a' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json as { error: { code: string } };
      expect(body.error.code).toBe('budget_exceeded_daily');
    } finally {
      server.close();
    }
  });

  // Test 2: Soft limit agent-b gets warning at 80% threshold
  it('soft limit agent gets X-Govyn-Budget-Warning header at 80% threshold', async () => {
    const aggregator = new CostAggregator();
    const budgets = new Map<string, BudgetConfig>([
      ['agent-b', { dailyLimit: 5.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $4.50 = 90% of $5 limit (above 80% warning threshold)
    aggregator.recordCost(makeRecord({ agentId: 'agent-b', totalCost: 4.5, inputCost: 1.5, outputCost: 3.0 }));

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['custom', {
        name: 'custom',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'custom',
      }]]),
      agents: new Map(),
      pricing: new Map(),
      budgets,
    };

    const server = startServer(config, aggregator, enforcer);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await httpRequest({
        port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'agent-b' },
      });

      // Soft limit: request succeeds
      expect(res.statusCode).toBe(200);

      // Warning header should be present
      expect(res.headers['x-govyn-budget-warning']).toBeDefined();
      const warning = JSON.parse(res.headers['x-govyn-budget-warning'] as string);
      expect(warning.limit).toBe(5.0);
      expect(warning.current_spend).toBeCloseTo(4.5, 2);
    } finally {
      server.close();
    }
  });

  // Test 3: Soft limit agent is NOT blocked even when over limit
  it('soft limit agent is NOT blocked even when over limit', async () => {
    const aggregator = new CostAggregator();
    const budgets = new Map<string, BudgetConfig>([
      ['agent-b', { dailyLimit: 5.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $7.00 — over $5 soft limit
    aggregator.recordCost(makeRecord({ agentId: 'agent-b', totalCost: 7.0, inputCost: 2.0, outputCost: 5.0 }));

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['custom', {
        name: 'custom',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'custom',
      }]]),
      agents: new Map(),
      pricing: new Map(),
      budgets,
    };

    const server = startServer(config, aggregator, enforcer);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await httpRequest({
        port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'agent-b' },
      });

      // Should still succeed (soft limit)
      expect(res.statusCode).toBe(200);
    } finally {
      server.close();
    }
  });
});
