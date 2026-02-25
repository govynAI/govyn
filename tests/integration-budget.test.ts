/**
 * End-to-end integration tests for budget enforcement + loop detection.
 *
 * Spins up a real HTTP server with a mock upstream to test the complete
 * request pipeline including loop detection and manual unblock API.
 *
 * Tests the following scenarios:
 * - Normal requests pass through
 * - Hard daily/monthly limits block with 429
 * - Soft limits forward with X-Govyn-Budget-Warning header
 * - Loop detection blocks after threshold identical requests
 * - Loop-blocked agents stay blocked across different requests (cooldown)
 * - POST /api/agents/:agentId/unblock clears loop block
 * - Budget reset: yesterday's spend doesn't count today (time-windowed queries)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { BudgetEnforcer } from '../src/budget-enforcer.js';
import { LoopDetector } from '../src/loop-detector.js';
import type { ProxyConfig, BudgetConfig, CostRecord, LoopDetectionConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

function makeHttpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<TestResponse> {
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

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
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

// -----------------------------------------------------------------------
// Mock upstream factory
// -----------------------------------------------------------------------

function createMockUpstream(): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
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
// Test infrastructure: startTestServer helper
// -----------------------------------------------------------------------

interface TestServer {
  port: number;
  server: http.Server;
  aggregator: CostAggregator;
  enforcer: BudgetEnforcer;
  loopDetector: LoopDetector;
  close: () => Promise<void>;
}

async function startTestServer(options: {
  upstreamPort: number;
  budgets?: Map<string, BudgetConfig>;
  loopConfig?: LoopDetectionConfig;
}): Promise<TestServer> {
  const { upstreamPort, budgets = new Map(), loopConfig } = options;

  const aggregator = new CostAggregator();
  const enforcer = new BudgetEnforcer(budgets, aggregator);

  const defaultLoopConfig: LoopDetectionConfig = loopConfig ?? {
    threshold: 10,
    windowSeconds: 60,
    cooldownSeconds: 300,
  };
  const loopDetector = new LoopDetector(defaultLoopConfig, new Map());

  const config: ProxyConfig = {
    port: 0,
    host: '127.0.0.1',
    providers: new Map([
      [
        'custom',
        {
          name: 'custom',
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          apiKeyEnv: null,
          providerType: 'custom',
        },
      ],
    ]),
    agents: new Map(),
    pricing: new Map(),
    budgets,
  };

  const server = startServer(config, aggregator, enforcer, loopDetector);
  await waitForListen(server);
  const port = (server.address() as { port: number }).port;

  return {
    port,
    server,
    aggregator,
    enforcer,
    loopDetector,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('budget enforcement + loop detection integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  // -----------------------------------------------------------------------
  // Test 1: Agent with no budget or loop config can make requests normally
  // -----------------------------------------------------------------------

  it('agent with no budget or loop config can make requests normally', async () => {
    const ts = await startTestServer({ upstreamPort: upstream.port });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'free-agent' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-govyn-budget-warning']).toBeUndefined();
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: Agent exceeding daily hard limit gets 429 with budget_exceeded_daily
  // -----------------------------------------------------------------------

  it('agent exceeding daily hard limit gets 429 with budget_exceeded_daily', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['limited-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      // Pre-populate spend over the daily limit
      ts.aggregator.recordCost(makeRecord({ agentId: 'limited-agent', totalCost: 11.0, inputCost: 4.0, outputCost: 7.0 }));

      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'limited-agent' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json as { error: { type: string; code: string; details: Record<string, unknown> } };
      expect(body.error.type).toBe('budget_error');
      expect(body.error.code).toBe('budget_exceeded_daily');
      expect(body.error.details['agent_id']).toBe('limited-agent');
      expect(body.error.details['limit_amount']).toBe(10.0);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: Agent exceeding monthly hard limit gets 429 with budget_exceeded_monthly
  // -----------------------------------------------------------------------

  it('agent exceeding monthly hard limit gets 429 with budget_exceeded_monthly', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['monthly-agent', { dailyLimit: null, monthlyLimit: 50.0, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      ts.aggregator.recordCost(makeRecord({ agentId: 'monthly-agent', totalCost: 55.0, inputCost: 20.0, outputCost: 35.0 }));

      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'monthly-agent' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json as { error: { code: string } };
      expect(body.error.code).toBe('budget_exceeded_monthly');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: 429 response includes Retry-After header
  // -----------------------------------------------------------------------

  it('budget 429 response includes Retry-After header', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['retry-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      ts.aggregator.recordCost(makeRecord({ agentId: 'retry-agent', totalCost: 11.0, inputCost: 4.0, outputCost: 7.0 }));

      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'retry-agent' },
      });

      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      const retryAfter = parseInt(res.headers['retry-after'] as string, 10);
      expect(retryAfter).toBeGreaterThan(0);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 5: Error JSON follows Govyn-native format with type, code, message, details
  // -----------------------------------------------------------------------

  it('budget error JSON follows Govyn-native format with type, code, message, details', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['format-agent', { dailyLimit: 5.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      ts.aggregator.recordCost(makeRecord({ agentId: 'format-agent', totalCost: 6.0, inputCost: 2.0, outputCost: 4.0 }));

      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'format-agent' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json as Record<string, unknown>;
      const error = body['error'] as Record<string, unknown>;
      expect(typeof error['type']).toBe('string');
      expect(typeof error['code']).toBe('string');
      expect(typeof error['message']).toBe('string');
      expect(typeof error['details']).toBe('object');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 6: Soft limit agent gets proxied response with X-Govyn-Budget-Warning header
  // -----------------------------------------------------------------------

  it('soft limit agent gets proxied response with X-Govyn-Budget-Warning header', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['soft-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      ts.aggregator.recordCost(makeRecord({ agentId: 'soft-agent', totalCost: 12.0, inputCost: 4.0, outputCost: 8.0 }));

      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'soft-agent' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-govyn-budget-warning']).toBeDefined();

      const warning = JSON.parse(res.headers['x-govyn-budget-warning'] as string) as {
        percent_used: number;
        current_spend: number;
        limit: number;
      };
      expect(warning.limit).toBe(10.0);
      expect(warning.current_spend).toBeCloseTo(12.0, 2);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 7: Loop detected after threshold identical requests returns 429 with loop_detected
  // -----------------------------------------------------------------------

  it('loop detected after threshold identical requests returns 429 with loop_detected', async () => {
    const loopConfig: LoopDetectionConfig = {
      threshold: 5,
      windowSeconds: 60,
      cooldownSeconds: 300,
    };
    const ts = await startTestServer({ upstreamPort: upstream.port, loopConfig });
    try {
      const requestBody = JSON.stringify({ model: 'gpt-4o', messages: [] });
      const path = '/v1/custom/custom/v1/chat/completions';

      // Make threshold - 1 requests (should not block)
      for (let i = 0; i < 4; i++) {
        const res = await makeHttpRequest({
          port: ts.port,
          path,
          method: 'POST',
          headers: { 'x-govyn-agent': 'loop-agent', 'content-type': 'application/json' },
          body: requestBody,
        });
        expect(res.statusCode).toBe(200);
      }

      // 5th request triggers loop detection
      const blockedRes = await makeHttpRequest({
        port: ts.port,
        path,
        method: 'POST',
        headers: { 'x-govyn-agent': 'loop-agent', 'content-type': 'application/json' },
        body: requestBody,
      });

      expect(blockedRes.statusCode).toBe(429);
      const body = blockedRes.json as { error: { type: string; code: string; details: Record<string, unknown> } };
      expect(body.error.type).toBe('loop_error');
      expect(body.error.code).toBe('loop_detected');
      expect(body.error.details['agent_id']).toBe('loop-agent');
      expect(body.error.details['cooldown_seconds']).toBe(300);
      expect(body.error.details['cooldown_expires_at']).toBeDefined();
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 8: Loop-blocked agent stays blocked on subsequent different requests (cooldown active)
  // -----------------------------------------------------------------------

  it('loop-blocked agent stays blocked on subsequent different requests during cooldown', async () => {
    const loopConfig: LoopDetectionConfig = {
      threshold: 3,
      windowSeconds: 60,
      cooldownSeconds: 300,
    };
    const ts = await startTestServer({ upstreamPort: upstream.port, loopConfig });
    try {
      const requestBody = JSON.stringify({ model: 'gpt-4o', messages: [] });
      const path = '/v1/custom/custom/v1/chat/completions';

      // Trigger loop block by making threshold identical requests
      for (let i = 0; i < 3; i++) {
        await makeHttpRequest({
          port: ts.port,
          path,
          method: 'POST',
          headers: { 'x-govyn-agent': 'blocked-agent' },
          body: requestBody,
        });
      }

      // The agent is now blocked. Try a DIFFERENT request (different body)
      const differentBody = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'different' }] });
      const blockedRes = await makeHttpRequest({
        port: ts.port,
        path,
        method: 'POST',
        headers: { 'x-govyn-agent': 'blocked-agent' },
        body: differentBody,
      });

      // Agent is still blocked via BudgetEnforcer.isBlocked() check in checkBudget()
      expect(blockedRes.statusCode).toBe(429);
      const body = blockedRes.json as { error: { code: string } };
      expect(body.error.code).toBe('loop_detected');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 9: POST /api/agents/:agentId/unblock clears loop block
  // -----------------------------------------------------------------------

  it('POST /api/agents/:agentId/unblock clears loop block', async () => {
    const loopConfig: LoopDetectionConfig = {
      threshold: 3,
      windowSeconds: 60,
      cooldownSeconds: 300,
    };
    const ts = await startTestServer({ upstreamPort: upstream.port, loopConfig });
    try {
      // Block the agent first
      ts.enforcer.blockAgent('unblock-agent', 'loop_detected', 300);

      // Verify the agent is blocked
      const blockedRes = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'unblock-agent' },
      });
      expect(blockedRes.statusCode).toBe(429);

      // Unblock via API
      const unblockRes = await makeHttpRequest({
        port: ts.port,
        path: '/api/agents/unblock-agent/unblock',
        method: 'POST',
      });
      expect(unblockRes.statusCode).toBe(200);
      const unblockBody = unblockRes.json as { success: boolean; agent_id: string };
      expect(unblockBody.success).toBe(true);
      expect(unblockBody.agent_id).toBe('unblock-agent');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 10: After unblock, agent can make requests again
  // -----------------------------------------------------------------------

  it('after unblock, agent can make requests normally', async () => {
    const loopConfig: LoopDetectionConfig = {
      threshold: 3,
      windowSeconds: 60,
      cooldownSeconds: 300,
    };
    const ts = await startTestServer({ upstreamPort: upstream.port, loopConfig });
    try {
      // Block the agent
      ts.enforcer.blockAgent('recovered-agent', 'loop_detected', 300);

      // Unblock via API
      await makeHttpRequest({
        port: ts.port,
        path: '/api/agents/recovered-agent/unblock',
        method: 'POST',
      });

      // After unblock, request should succeed
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'recovered-agent' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 11: Unblock of non-blocked agent returns 404
  // -----------------------------------------------------------------------

  it('unblock of non-blocked agent returns 404', async () => {
    const ts = await startTestServer({ upstreamPort: upstream.port });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/api/agents/not-blocked-agent/unblock',
        method: 'POST',
      });
      expect(res.statusCode).toBe(404);
      const body = res.json as { error: { code: string } };
      expect(body.error.code).toBe('agent_not_blocked');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 12: Budget reset verification — yesterday's spend doesn't count today
  // -----------------------------------------------------------------------

  it('budget reset: yesterday spend does not count toward today daily limit', async () => {
    const budgets = new Map<string, BudgetConfig>([
      ['reset-agent', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const ts = await startTestServer({ upstreamPort: upstream.port, budgets });
    try {
      // Insert a cost record from yesterday (25 hours ago — definitely outside today's window)
      const yesterday = Date.now() - 25 * 60 * 60 * 1000;
      ts.aggregator.recordCost(makeRecord({
        agentId: 'reset-agent',
        totalCost: 11.0, // Over $10 daily limit — but from yesterday
        inputCost: 4.0,
        outputCost: 7.0,
        timestamp: yesterday,
      }));

      // Today's request should be allowed (yesterday's spend doesn't count)
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'reset-agent' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-govyn-budget-warning']).toBeUndefined();
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 13: Loop detection with different bodies on same endpoint — no false positive
  // -----------------------------------------------------------------------

  it('loop detection does not trigger for different bodies on same endpoint', async () => {
    const loopConfig: LoopDetectionConfig = {
      threshold: 5,
      windowSeconds: 60,
      cooldownSeconds: 300,
    };
    const ts = await startTestServer({ upstreamPort: upstream.port, loopConfig });
    try {
      const path = '/v1/custom/custom/v1/chat/completions';

      // Make 10 requests with different bodies — should never trigger loop detection
      for (let i = 0; i < 10; i++) {
        const res = await makeHttpRequest({
          port: ts.port,
          path,
          method: 'POST',
          headers: { 'x-govyn-agent': 'varied-agent' },
          body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: `message ${i}` }] }),
        });
        expect(res.statusCode).toBe(200);
      }
    } finally {
      await ts.close();
    }
  });
});
