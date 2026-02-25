/**
 * Integration tests for loop detection through the full proxy pipeline.
 *
 * Tests that repeated identical requests trigger loop detection, agents
 * are blocked during cooldown, different requests during cooldown are also
 * blocked, and manual unblock works.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import { LoopDetector } from '../../src/loop-detector.js';
import type { ProxyConfig, LoopDetectionConfig } from '../../src/types.js';

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

describe('loop detection integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  // Test 1: 3rd identical request triggers loop detection (threshold=3)
  it('3rd identical request triggers loop detection with 429', async () => {
    const aggregator = new CostAggregator();
    const loopConfig: LoopDetectionConfig = { threshold: 3, windowSeconds: 60, cooldownSeconds: 2 };
    const loopDetector = new LoopDetector(loopConfig, new Map());
    const enforcer = new BudgetEnforcer(new Map(), aggregator);

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
      budgets: new Map(),
    };

    const server = startServer(config, aggregator, enforcer, loopDetector);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const requestBody = JSON.stringify({ model: 'gpt-4o', messages: [] });
      const reqPath = '/v1/custom/custom/v1/chat/completions';

      // First 2 requests succeed
      for (let i = 0; i < 2; i++) {
        const res = await httpRequest({
          port,
          path: reqPath,
          method: 'POST',
          headers: { 'x-govyn-agent': 'loop-agent', 'content-type': 'application/json' },
          body: requestBody,
        });
        expect(res.statusCode).toBe(200);
      }

      // 3rd identical request triggers loop detection
      const blockedRes = await httpRequest({
        port,
        path: reqPath,
        method: 'POST',
        headers: { 'x-govyn-agent': 'loop-agent', 'content-type': 'application/json' },
        body: requestBody,
      });

      expect(blockedRes.statusCode).toBe(429);
      const body = blockedRes.json as { error: { type: string; code: string } };
      expect(body.error.type).toBe('loop_error');
      expect(body.error.code).toBe('loop_detected');
    } finally {
      server.close();
    }
  });

  // Test 2: After cooldown expires, agent can make requests again
  it('after cooldown expires, same request succeeds', async () => {
    const aggregator = new CostAggregator();
    // windowSeconds=2 matches cooldownSeconds=2 so old timestamps are pruned after cooldown
    const loopConfig: LoopDetectionConfig = { threshold: 3, windowSeconds: 2, cooldownSeconds: 2 };
    const loopDetector = new LoopDetector(loopConfig, new Map());
    const enforcer = new BudgetEnforcer(new Map(), aggregator);

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
      budgets: new Map(),
    };

    const server = startServer(config, aggregator, enforcer, loopDetector);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const requestBody = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'cooldown test' }] });
      const reqPath = '/v1/custom/custom/v1/chat/completions';

      // Trigger loop block
      for (let i = 0; i < 3; i++) {
        await httpRequest({
          port,
          path: reqPath,
          method: 'POST',
          headers: { 'x-govyn-agent': 'cooldown-agent', 'content-type': 'application/json' },
          body: requestBody,
        });
      }

      // Wait for 2.5s cooldown (cooldownSeconds=2)
      await new Promise((r) => setTimeout(r, 2500));

      // After cooldown, request should succeed
      const res = await httpRequest({
        port,
        path: reqPath,
        method: 'POST',
        headers: { 'x-govyn-agent': 'cooldown-agent', 'content-type': 'application/json' },
        body: requestBody,
      });
      expect(res.statusCode).toBe(200);
    } finally {
      server.close();
    }
  }, 10000); // Longer timeout for cooldown wait

  // Test 3: Non-identical request during cooldown is also blocked (agent-level block)
  it('non-identical request during cooldown is also blocked (agent-level)', async () => {
    const aggregator = new CostAggregator();
    const loopConfig: LoopDetectionConfig = { threshold: 3, windowSeconds: 60, cooldownSeconds: 300 };
    const loopDetector = new LoopDetector(loopConfig, new Map());
    const enforcer = new BudgetEnforcer(new Map(), aggregator);

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
      budgets: new Map(),
    };

    const server = startServer(config, aggregator, enforcer, loopDetector);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const requestBody = JSON.stringify({ model: 'gpt-4o', messages: [] });
      const reqPath = '/v1/custom/custom/v1/chat/completions';

      // Trigger loop block
      for (let i = 0; i < 3; i++) {
        await httpRequest({
          port,
          path: reqPath,
          method: 'POST',
          headers: { 'x-govyn-agent': 'blocked-agent', 'content-type': 'application/json' },
          body: requestBody,
        });
      }

      // Try a DIFFERENT request body — should still be blocked
      const differentBody = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'different' }] });
      const blockedRes = await httpRequest({
        port,
        path: reqPath,
        method: 'POST',
        headers: { 'x-govyn-agent': 'blocked-agent', 'content-type': 'application/json' },
        body: differentBody,
      });

      expect(blockedRes.statusCode).toBe(429);
      const body = blockedRes.json as { error: { code: string } };
      expect(body.error.code).toBe('loop_detected');
    } finally {
      server.close();
    }
  });

  // Test 4: Manual unblock via API
  it('POST /api/agents/:agentId/unblock clears loop block immediately', async () => {
    const aggregator = new CostAggregator();
    const loopConfig: LoopDetectionConfig = { threshold: 3, windowSeconds: 60, cooldownSeconds: 300 };
    const loopDetector = new LoopDetector(loopConfig, new Map());
    const enforcer = new BudgetEnforcer(new Map(), aggregator);

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
      budgets: new Map(),
    };

    const server = startServer(config, aggregator, enforcer, loopDetector);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Block agent via enforcer directly
      enforcer.blockAgent('unblock-test', 'loop_detected', 300);

      // Verify blocked
      const blockedRes = await httpRequest({
        port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'unblock-test' },
      });
      expect(blockedRes.statusCode).toBe(429);

      // Unblock via API
      const unblockRes = await httpRequest({
        port,
        path: '/api/agents/unblock-test/unblock',
        method: 'POST',
      });
      expect(unblockRes.statusCode).toBe(200);

      // Verify unblocked
      const freeRes = await httpRequest({
        port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'unblock-test' },
      });
      expect(freeRes.statusCode).toBe(200);
    } finally {
      server.close();
    }
  });
});
