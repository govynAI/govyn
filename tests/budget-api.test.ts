/**
 * Integration tests for the budget status API and budget enforcement middleware.
 *
 * Uses real HTTP servers with pre-populated CostAggregator records
 * and configured budgets to test the full request path.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { BudgetEnforcer } from '../src/budget-enforcer.js';
import { govynEvents } from '../src/events.js';
import type { ProxyConfig, CostRecord, BudgetConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    agentId: 'research-agent',
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

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

function makeRequest(
  port: number,
  path: string,
  method: string = 'GET',
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json,
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
}

// -----------------------------------------------------------------------
// Mock upstream server for proxy tests
// -----------------------------------------------------------------------

function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Upstream response' }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// -----------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------

describe('budget status API (/api/budgets)', () => {
  let server: http.Server;
  let serverPort: number;
  let aggregator: CostAggregator;
  let budgetEnforcer: BudgetEnforcer;

  const researchBudget: BudgetConfig = {
    dailyLimit: 10.0,
    monthlyLimit: 100.0,
    limitType: 'hard',
    softWarningPercent: 80,
  };

  const salesBudget: BudgetConfig = {
    dailyLimit: 5.0,
    monthlyLimit: 50.0,
    limitType: 'soft',
    softWarningPercent: 80,
  };

  beforeAll(async () => {
    aggregator = new CostAggregator();

    const budgets = new Map<string, BudgetConfig>([
      ['research-agent', researchBudget],
      ['sales-bot', salesBudget],
    ]);
    budgetEnforcer = new BudgetEnforcer(budgets, aggregator);

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map(),
      agents: new Map(),
      pricing: new Map(),
      budgets,
    };

    server = startServer(config, aggregator, budgetEnforcer);
    await waitForListen(server);
    serverPort = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    aggregator.clear();
  });

  // Test 1: GET /api/budgets returns array of all configured agent statuses
  it('GET /api/budgets returns array of all configured agent statuses', async () => {
    const res = await makeRequest(serverPort, '/api/budgets');
    expect(res.statusCode).toBe(200);

    const statuses = res.json as Array<{ agentId: string }>;
    expect(Array.isArray(statuses)).toBe(true);
    expect(statuses.length).toBe(2);

    const agentIds = statuses.map((s) => s.agentId).sort();
    expect(agentIds).toEqual(['research-agent', 'sales-bot']);
  });

  // Test 2: GET /api/budgets/research-agent returns single agent status
  it('GET /api/budgets/research-agent returns single agent status', async () => {
    aggregator.recordCost(makeRecord({ agentId: 'research-agent', totalCost: 3.0, inputCost: 1.0, outputCost: 2.0 }));

    const res = await makeRequest(serverPort, '/api/budgets/research-agent');
    expect(res.statusCode).toBe(200);

    const status = res.json as {
      agentId: string;
      daily: { limit: number; spent: number; remaining: number };
      monthly: { limit: number; spent: number };
      limitType: string;
      blocked: boolean;
    };

    expect(status.agentId).toBe('research-agent');
    expect(status.daily.limit).toBe(10.0);
    expect(status.daily.spent).toBeCloseTo(3.0, 5);
    expect(status.daily.remaining).toBeCloseTo(7.0, 5);
    expect(status.monthly.limit).toBe(100.0);
    expect(status.limitType).toBe('hard');
    expect(status.blocked).toBe(false);
  });

  // Test 3: GET /api/budgets/unknown-agent returns 404
  it('GET /api/budgets/unknown-agent returns 404', async () => {
    const res = await makeRequest(serverPort, '/api/budgets/unknown-agent');
    expect(res.statusCode).toBe(404);

    const body = res.json as { error: { code: string } };
    expect(body.error.code).toBe('agent_budget_not_found');
  });

  // Test 4: POST /api/budgets returns 405
  it('POST /api/budgets returns 405', async () => {
    const res = await makeRequest(serverPort, '/api/budgets', 'POST');
    expect(res.statusCode).toBe(405);

    const body = res.json as { error: { code: string } };
    expect(body.error.code).toBe('method_not_allowed');
  });

  // Test 5: Budget status includes correct daily and monthly spend, limits, remaining
  it('budget status includes correct daily/monthly spend, limits, remaining', async () => {
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot', totalCost: 2.0, inputCost: 0.5, outputCost: 1.5 }));
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot', totalCost: 1.0, inputCost: 0.3, outputCost: 0.7 }));

    const res = await makeRequest(serverPort, '/api/budgets/sales-bot');
    expect(res.statusCode).toBe(200);

    const status = res.json as {
      daily: { limit: number; spent: number; remaining: number; percentUsed: number };
      monthly: { limit: number; spent: number; remaining: number };
    };

    expect(status.daily.limit).toBe(5.0);
    expect(status.daily.spent).toBeCloseTo(3.0, 5);
    expect(status.daily.remaining).toBeCloseTo(2.0, 5);
    expect(status.daily.percentUsed).toBeCloseTo(60, 1);
    expect(status.monthly.limit).toBe(50.0);
    expect(status.monthly.spent).toBeCloseTo(3.0, 5);
  });
});

// -----------------------------------------------------------------------
// Budget enforcement middleware integration tests
// -----------------------------------------------------------------------

describe('budget enforcement middleware', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;
  let server: http.Server;
  let _serverPort: number;
  let aggregator: CostAggregator;

  beforeAll(async () => {
    upstream = await createMockUpstream();
    aggregator = new CostAggregator();
  });

  afterAll(async () => {
    server?.close();
    await upstream.close();
  });

  beforeEach(() => {
    aggregator.clear();
  });

  // Helper to start a fresh server with given budgets
  async function startTestServer(budgets: Map<string, BudgetConfig>): Promise<{ port: number; enforcer: BudgetEnforcer }> {
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }

    const enforcer = new BudgetEnforcer(budgets, aggregator);
    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([
        [
          'custom',
          {
            name: 'custom',
            baseUrl: `http://127.0.0.1:${upstream.port}`,
            apiKeyEnv: null,
            providerType: 'custom',
          },
        ],
      ]),
      agents: new Map(),
      pricing: new Map(),
      budgets,
    };
    server = startServer(config, aggregator, enforcer);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;
    return { port, enforcer };
  }

  // Test 6: Request blocked by hard daily limit returns 429 with correct error JSON and Retry-After header
  it('request blocked by hard daily limit returns 429 with correct error JSON and Retry-After header', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['test-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const { port } = await startTestServer(budgets);

    // Pre-populate spend over the daily limit
    aggregator.recordCost(makeRecord({ agentId: 'test-agent', totalCost: 11.0, inputCost: 4.0, outputCost: 7.0 }));

    const _res = await makeRequest(port, '/v1/custom/custom/v1/test');
    // Without agent header, agent is "unknown" — which has no budget. Set header:
    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'test-agent' },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (chunk: Buffer) => chunks.push(chunk));
          r.on('end', () => resolve({ statusCode: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(429);

    const body = JSON.parse(response.body) as { error: { type: string; code: string; details: Record<string, unknown> } };
    expect(body.error.type).toBe('budget_error');
    expect(body.error.code).toBe('budget_exceeded_daily');
    expect(body.error.details['limit_amount']).toBe(10.0);
    expect(body.error.details['agent_id']).toBe('test-agent');
    expect(body.error.details['limit_type']).toBe('daily');

    // Retry-After header should be set
    expect(response.headers['retry-after']).toBeDefined();
    const retryAfter = parseInt(response.headers['retry-after'] as string, 10);
    expect(retryAfter).toBeGreaterThan(0);
  });

  // Test 7: Request blocked by hard monthly limit returns 429 with budget_exceeded_monthly code
  it('request blocked by hard monthly limit returns 429 with budget_exceeded_monthly code', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['monthly-agent', { dailyLimit: null, monthlyLimit: 50.0, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const { port } = await startTestServer(budgets);

    // Pre-populate spend over the monthly limit
    aggregator.recordCost(makeRecord({ agentId: 'monthly-agent', totalCost: 55.0, inputCost: 20.0, outputCost: 35.0 }));

    const response = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'monthly-agent' },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (chunk: Buffer) => chunks.push(chunk));
          r.on('end', () => resolve({ statusCode: r.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(429);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('budget_exceeded_monthly');
  });

  // Test 8: Soft limit request is forwarded with X-Govyn-Budget-Warning header
  it('soft limit request is forwarded with X-Govyn-Budget-Warning header when over limit', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['soft-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const { port } = await startTestServer(budgets);

    // Spend $12 — over the soft daily limit
    aggregator.recordCost(makeRecord({ agentId: 'soft-agent', totalCost: 12.0, inputCost: 4.0, outputCost: 8.0 }));

    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'soft-agent' },
        },
        (r) => {
          const chunks: Buffer[] = [];
          r.on('data', (chunk: Buffer) => chunks.push(chunk));
          r.on('end', () => resolve({ statusCode: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    // Request should be forwarded (not blocked)
    expect(response.statusCode).toBe(200);

    // X-Govyn-Budget-Warning header should be present
    expect(response.headers['x-govyn-budget-warning']).toBeDefined();

    const warning = JSON.parse(response.headers['x-govyn-budget-warning'] as string) as {
      percent_used: number;
      current_spend: number;
      limit: number;
      resets_at: string;
    };
    expect(warning.limit).toBe(10.0);
    expect(warning.current_spend).toBeCloseTo(12.0, 5);
    expect(warning.resets_at).toBeDefined();
  });

  // Test 9: Soft warning at threshold has warning header with correct JSON
  it('soft warning at threshold has warning header with correct JSON', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['threshold-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const { port } = await startTestServer(budgets);

    // Spend $8.50 = 85% of $10 limit (above 80% threshold)
    aggregator.recordCost(makeRecord({ agentId: 'threshold-agent', totalCost: 8.5, inputCost: 3.0, outputCost: 5.5 }));

    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'threshold-agent' },
        },
        (r) => {
          r.resume();
          r.on('end', () => resolve({ statusCode: r.statusCode ?? 0, headers: r.headers }));
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-govyn-budget-warning']).toBeDefined();

    const warning = JSON.parse(response.headers['x-govyn-budget-warning'] as string) as {
      percent_used: number;
    };
    expect(warning.percent_used).toBeGreaterThan(80);
  });

  // Test 10: Agent with no budget config is proxied normally
  it('agent with no budget config is proxied normally (no blocking, no warnings)', async () => {
    const budgets = new Map<string, BudgetConfig>(); // Empty — no budgets configured
    const { port } = await startTestServer(budgets);

    const response = await new Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'no-budget-agent' },
        },
        (r) => {
          r.resume();
          r.on('end', () => resolve({ statusCode: r.statusCode ?? 0, headers: r.headers }));
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-govyn-budget-warning']).toBeUndefined();
  });

  // Test 11: Soft limit triggers internal event emission via govynEvents
  it('soft limit triggers internal budget_warning event via govynEvents', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['event-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const { port } = await startTestServer(budgets);

    // Spend $9 = 90% of $10 (above 80% threshold)
    aggregator.recordCost(makeRecord({ agentId: 'event-agent', totalCost: 9.0, inputCost: 3.0, outputCost: 6.0 }));

    // Subscribe to events before making the request
    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      govynEvents.once('event', (event: Record<string, unknown>) => {
        resolve(event);
      });
    });

    // Make the request
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/v1/custom/custom/v1/test',
          method: 'GET',
          headers: { 'x-govyn-agent': 'event-agent' },
        },
        (r) => {
          r.resume();
          r.on('end', resolve);
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    });

    // Wait for the event
    const event = await eventPromise;
    expect(event['type']).toBe('budget_warning');
    expect(event['agentId']).toBe('event-agent');
    expect(typeof event['percentUsed']).toBe('number');
    expect(typeof event['currentSpend']).toBe('number');
    expect(typeof event['limit']).toBe('number');
    expect(event['limit']).toBe(10.0);
    expect(event['resetsAt']).toBeDefined();
  });
});
