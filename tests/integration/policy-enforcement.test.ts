/**
 * Integration tests for policy enforcement (budget + loop interaction).
 *
 * Tests the full proxy pipeline with agent budget and loop detection
 * configured together, verifying that budget blocking and loop detection
 * trigger the correct 429 responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import { LoopDetector } from '../../src/loop-detector.js';
import { loadPricing } from '../../src/pricing.js';
import type { ProxyConfig, BudgetConfig, LoopDetectionConfig } from '../../src/types.js';

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

/**
 * Create a mock upstream that returns OpenAI-format responses with known token usage.
 * Each response costs $0.20 with custom pricing.
 */
function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        // Return response with 100K input + 50K output tokens
        // With custom pricing $1/M input + $2/M output:
        // cost = (100000/1M)*1 + (50000/1M)*2 = 0.1 + 0.1 = $0.20 per request
        const response = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'test-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100000, completion_tokens: 50000, total_tokens: 150000 },
        };
        const body = JSON.stringify(response);
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() });
        res.end(body);
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

describe('policy enforcement integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  it('budget blocking after spending $1.00 with $0.20-per-request costs', async () => {
    const aggregator = new CostAggregator();

    // Custom pricing: $1/M input, $2/M output => $0.20 per request
    const pricingTable = loadPricing({
      'test-model': { input: 1.0, output: 2.0 },
    });

    const budgets = new Map<string, BudgetConfig>([
      ['policy-agent', { dailyLimit: 1.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    const loopConfig: LoopDetectionConfig = { threshold: 20, windowSeconds: 60, cooldownSeconds: 300 };
    const loopDetector = new LoopDetector(loopConfig, new Map());

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'openai',
      }]]),
      agents: new Map(),
      pricing: pricingTable,
      budgets,
    };

    const proxyServer = startServer(config, aggregator, enforcer, loopDetector);
    await waitForListen(proxyServer);
    const proxyPort = (proxyServer.address() as { port: number }).port;

    try {
      // Send 5 requests at $0.20 each = $1.00 total
      for (let i = 0; i < 5; i++) {
        const res = await httpRequest({
          port: proxyPort,
          path: '/v1/openai/v1/chat/completions',
          method: 'POST',
          headers: { 'x-govyn-agent': 'policy-agent', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: `msg ${i}` }] }),
        });
        expect(res.statusCode).toBe(200);
        await new Promise((r) => setTimeout(r, 10)); // Allow cost recording
      }

      // 6th request should be blocked — $1.00 spent >= $1.00 daily limit
      const blockedRes = await httpRequest({
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'policy-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'blocked' }] }),
      });

      expect(blockedRes.statusCode).toBe(429);
      const body = blockedRes.json as { error: { type: string; code: string; details: Record<string, unknown> } };
      expect(body.error.type).toBe('budget_error');
      expect(body.error.code).toBe('budget_exceeded_daily');
      expect(body.error.details['agent_id']).toBe('policy-agent');
    } finally {
      proxyServer.close();
    }
  });
});
