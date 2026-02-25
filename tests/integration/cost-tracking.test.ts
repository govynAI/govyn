/**
 * Integration tests for the cost tracking pipeline.
 *
 * Spins up mock upstream + govyn proxy, sends multiple requests, and
 * verifies that costs accumulate correctly and are queryable via the API.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { loadPricing } from '../../src/pricing.js';
import type { ProxyConfig } from '../../src/types.js';

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
        const response = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
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

describe('cost tracking integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;
  let proxyServer: http.Server;
  let proxyPort: number;
  let aggregator: CostAggregator;

  beforeAll(async () => {
    upstream = await createMockUpstream();
    aggregator = new CostAggregator();
    const pricingTable = loadPricing();
    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'openai',
      }]]),
      agents: new Map([['test-agent', { name: 'test-agent', apiKeys: [] }]]),
      pricing: pricingTable,
      budgets: new Map(),
    };
    proxyServer = startServer(config, aggregator);
    await waitForListen(proxyServer);
    proxyPort = (proxyServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    proxyServer.close();
    await upstream.close();
  });

  beforeEach(() => {
    aggregator.clear();
  });

  // Test 1: 5 requests accumulate correctly
  it('5 requests through proxy accumulate correct total cost', async () => {
    for (let i = 0; i < 5; i++) {
      await httpRequest({
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });
    }

    await new Promise((r) => setTimeout(r, 20));

    const costRes = await httpRequest({ port: proxyPort, path: '/api/costs?agent=test-agent&period=all' });
    expect(costRes.statusCode).toBe(200);
    const data = costRes.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string; totalCost: number; requestCount: number }>;

    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('test-agent');
    expect(agents[0]!.requestCount).toBe(5);

    // gpt-4o: 100 * $2.50/M + 50 * $10.00/M = $0.00025 + $0.0005 = $0.00075 per request
    // 5 * $0.00075 = $0.00375
    expect(agents[0]!.totalCost).toBeCloseTo(0.00375, 4);
  });

  // Test 2: Day period query matches (all requests in current day)
  it('day period query returns same total as all for same-day requests', async () => {
    for (let i = 0; i < 3; i++) {
      await httpRequest({
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });
    }

    await new Promise((r) => setTimeout(r, 20));

    const allRes = await httpRequest({ port: proxyPort, path: '/api/costs?agent=test-agent&period=all' });
    const dayRes = await httpRequest({ port: proxyPort, path: '/api/costs?agent=test-agent&period=day' });

    const allAgents = (allRes.json as Record<string, unknown>)['agents'] as Array<{ totalCost: number }>;
    const dayAgents = (dayRes.json as Record<string, unknown>)['agents'] as Array<{ totalCost: number }>;

    expect(dayAgents[0]!.totalCost).toBeCloseTo(allAgents[0]!.totalCost, 6);
  });
});
