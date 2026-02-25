/**
 * End-to-end integration tests for the cost tracking pipeline.
 *
 * Spins up:
 * 1. A mock upstream server returning OpenAI-format responses with usage fields
 * 2. A proxy server pointed at the mock upstream, with agents config and pricing table
 *
 * Verifies that requests are attributed to agents, tokens are counted, costs are
 * calculated, and the results are queryable via GET /api/costs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { loadPricing } from '../src/pricing.js';
import type { ProxyConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Test infrastructure helpers
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

// -----------------------------------------------------------------------
// Mock upstream server setup
// -----------------------------------------------------------------------

/**
 * Creates a mock upstream that returns OpenAI-format responses with usage.
 * Supports ?model= query param to control what model name is returned.
 */
function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Parse model from query string if provided
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const model = urlObj.searchParams.get('model') ?? 'gpt-4o';

      // Read request body (even if we don't use it — needed to not stall)
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        // Return OpenAI-format response with usage
        const response = {
          id: 'chatcmpl-test-123',
          object: 'chat.completion',
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello, world!' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        };

        const body = JSON.stringify(response);
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        });
        res.end(body);
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

    // Build pricing table with known prices (gpt-4o and gpt-4o-mini)
    const pricingTable = loadPricing();

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([
        [
          'openai',
          {
            name: 'openai',
            baseUrl: `http://127.0.0.1:${upstream.port}`,
            apiKeyEnv: null,
            providerType: 'openai',
          },
        ],
      ]),
      agents: new Map([
        ['test-agent', { name: 'test-agent', apiKeys: ['govyn-key-test-agent'] }],
        ['sales-bot', { name: 'sales-bot', apiKeys: ['govyn-key-sales-bot'] }],
      ]),
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

  // -----------------------------------------------------------------------
  // Test 1: Request with X-Govyn-Agent header is attributed correctly
  // -----------------------------------------------------------------------

  it('request with X-Govyn-Agent header is attributed to the named agent', async () => {
    // Send a proxied request with agent header
    const proxyRes = await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'x-govyn-agent': 'test-agent',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(proxyRes.statusCode).toBe(200);

    // Small delay to allow async cost recording to complete
    await new Promise((r) => setTimeout(r, 10));

    // Check the cost API
    const costRes = await httpRequest({
      port: proxyPort,
      path: '/api/costs',
    });
    expect(costRes.statusCode).toBe(200);

    const data = costRes.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string; requestCount: number; totalCost: number }>;

    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('test-agent');
    expect(agents[0]!.requestCount).toBe(1);
    // gpt-4o: 100 input tokens * $2.50/M + 50 output tokens * $10.00/M
    // = $0.00025 + $0.0005 = $0.00075
    expect(agents[0]!.totalCost).toBeCloseTo(0.00075, 6);
  });

  // -----------------------------------------------------------------------
  // Test 2: Request without agent header is attributed to 'unknown'
  // -----------------------------------------------------------------------

  it('request without agent header is attributed to unknown agent', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 10));

    const costRes = await httpRequest({ port: proxyPort, path: '/api/costs' });
    const data = costRes.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string }>;

    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('unknown');
  });

  // -----------------------------------------------------------------------
  // Test 3: Two different agents have separate cost entries
  // -----------------------------------------------------------------------

  it('two requests with different agents produce separate cost entries', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'sales-bot' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 10));

    // Filter to test-agent only
    const testAgentRes = await httpRequest({
      port: proxyPort,
      path: '/api/costs?agent=test-agent',
    });
    const testAgentData = testAgentRes.json as Record<string, unknown>;
    const testAgentSummaries = testAgentData['agents'] as Array<{ agentId: string }>;
    expect(testAgentSummaries.length).toBe(1);
    expect(testAgentSummaries[0]!.agentId).toBe('test-agent');

    // All agents
    const allRes = await httpRequest({ port: proxyPort, path: '/api/costs' });
    const allData = allRes.json as Record<string, unknown>;
    const allAgents = allData['agents'] as Array<{ agentId: string }>;
    expect(allAgents.length).toBe(2);
    const agentIds = allAgents.map((a) => a.agentId).sort();
    expect(agentIds).toEqual(['sales-bot', 'test-agent']);
  });

  // -----------------------------------------------------------------------
  // Test 4: Proxy response is correct (not corrupted by token extraction)
  // -----------------------------------------------------------------------

  it('proxied response body is correct and not corrupted', async () => {
    const res = await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json as Record<string, unknown>;
    // Verify the response contains the expected OpenAI-format fields
    expect(body['object']).toBe('chat.completion');
    expect(body['choices']).toBeDefined();
    expect(body['usage']).toBeDefined();
    const usage = body['usage'] as Record<string, number>;
    expect(usage['prompt_tokens']).toBe(100);
    expect(usage['completion_tokens']).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Test 5: Unknown model produces zero cost and appears in unpriced_models
  // -----------------------------------------------------------------------

  it('unknown model produces zero cost and appears in unpriced_models', async () => {
    // The mock upstream returns whatever model name we specify via ?model=
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions?model=unknown-model-xyz',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent' },
      body: JSON.stringify({ model: 'unknown-model-xyz', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 10));

    const costRes = await httpRequest({ port: proxyPort, path: '/api/costs' });
    const data = costRes.json as Record<string, unknown>;

    // Unpriced model should appear in the list
    const unpricedModels = data['unpriced_models'] as string[];
    expect(unpricedModels).toContain('unknown-model-xyz');

    // Cost for the agent should be 0 (unpriced)
    const agents = data['agents'] as Array<{ agentId: string; totalCost: number }>;
    const agentEntry = agents.find((a) => a.agentId === 'test-agent');
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.totalCost).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Test 6: Token counts are correct in the cost summary
  // -----------------------------------------------------------------------

  it('token counts are accurately recorded in the cost summary', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 10));

    const costRes = await httpRequest({ port: proxyPort, path: '/api/costs' });
    const data = costRes.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{
      agentId: string;
      totalInputTokens: number;
      totalOutputTokens: number;
    }>;

    const agentEntry = agents.find((a) => a.agentId === 'test-agent');
    expect(agentEntry).toBeDefined();
    // Mock upstream returns 100 prompt + 50 completion
    expect(agentEntry!.totalInputTokens).toBe(100);
    expect(agentEntry!.totalOutputTokens).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Test 7: Multiple requests accumulate correctly
  // -----------------------------------------------------------------------

  it('multiple requests from the same agent accumulate in cost summary', async () => {
    // Make 3 requests
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

    const costRes = await httpRequest({ port: proxyPort, path: '/api/costs' });
    const data = costRes.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string; requestCount: number; totalCost: number }>;

    const agentEntry = agents.find((a) => a.agentId === 'test-agent');
    expect(agentEntry).toBeDefined();
    expect(agentEntry!.requestCount).toBe(3);
    // 3 * $0.00075 = $0.00225
    expect(agentEntry!.totalCost).toBeCloseTo(0.00225, 6);
  });
});
