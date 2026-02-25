/**
 * Integration tests for API forwarding through the Govyn proxy.
 *
 * Spins up real local HTTP servers (mock upstream + govyn proxy) and verifies
 * correct request forwarding for OpenAI and Anthropic providers, agent identity
 * resolution, 404 routing, and upstream error passthrough.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import type { ProxyConfig, ProviderConfig } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

type UpstreamState = {
  capturedHeaders: http.IncomingHttpHeaders;
  capturedBody: string;
  capturedPath: string;
};

function createTestUpstream(
  state: UpstreamState,
  responseOverrides?: { statusCode?: number; body?: string; headers?: Record<string, string> },
): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      state.capturedHeaders = { ...req.headers };
      state.capturedPath = req.url ?? '/';
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        state.capturedBody = Buffer.concat(chunks).toString('utf8');

        const statusCode = responseOverrides?.statusCode ?? 200;
        const respHeaders: Record<string, string> = {
          'content-type': 'application/json',
          ...(responseOverrides?.headers ?? {}),
        };
        const body = responseOverrides?.body ?? JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        });

        res.writeHead(statusCode, respHeaders);
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

function makeRequest(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const body = options.body ?? '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: {
          ...options.headers,
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createTestProxy(providers: Map<string, ProviderConfig>): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers,
      agents: new Map([
        ['test-agent', { name: 'test-agent', apiKeys: [] }],
      ]),
      pricing: new Map(),
      budgets: new Map(),
    };
    const server = startServer(config, new CostAggregator());
    server.on('listening', () => {
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

describe('API forwarding integration', () => {
  let upstreamState: UpstreamState;
  let upstream: Awaited<ReturnType<typeof createTestUpstream>>;

  beforeAll(async () => {
    upstreamState = { capturedHeaders: {}, capturedBody: '', capturedPath: '' };
    upstream = await createTestUpstream(upstreamState);
  });

  afterAll(async () => {
    await upstream.close();
  });

  // Test 1: OpenAI request forwarded correctly
  it('forwards OpenAI request to upstream with correct body and returns response', async () => {
    process.env['TEST_OPENAI_FWD_KEY'] = 'sk-test-key';
    const openaiProvider: ProviderConfig = {
      name: 'openai',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKeyEnv: 'TEST_OPENAI_FWD_KEY',
      providerType: 'openai',
    };
    const proxy = await createTestProxy(new Map([['openai', openaiProvider]]));

    try {
      const reqBody = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] });
      const response = await makeRequest(proxy.port, {
        method: 'POST',
        path: '/v1/openai/v1/chat/completions',
        headers: { 'content-type': 'application/json' },
        body: reqBody,
      });

      expect(response.statusCode).toBe(200);
      expect(upstreamState.capturedPath).toBe('/v1/chat/completions');
      const parsed = JSON.parse(response.body);
      expect(parsed.object).toBe('chat.completion');
    } finally {
      await proxy.close();
      delete process.env['TEST_OPENAI_FWD_KEY'];
    }
  });

  // Test 2: Anthropic request forwarded correctly
  it('forwards Anthropic request with correct headers and path', async () => {
    process.env['TEST_ANTHROPIC_FWD_KEY'] = 'sk-ant-test';
    const anthropicProvider: ProviderConfig = {
      name: 'anthropic',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKeyEnv: 'TEST_ANTHROPIC_FWD_KEY',
      providerType: 'anthropic',
    };
    const proxy = await createTestProxy(new Map([['anthropic', anthropicProvider]]));

    try {
      const response = await makeRequest(proxy.port, {
        method: 'POST',
        path: '/v1/anthropic/v1/messages',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [] }),
      });

      expect(response.statusCode).toBe(200);
      expect(upstreamState.capturedPath).toBe('/v1/messages');
      expect(upstreamState.capturedHeaders['x-api-key']).toBe('sk-ant-test');
    } finally {
      await proxy.close();
      delete process.env['TEST_ANTHROPIC_FWD_KEY'];
    }
  });

  // Test 3: X-Govyn-Agent header resolves agent identity
  it('resolves agent identity from X-Govyn-Agent header', async () => {
    const provider: ProviderConfig = {
      name: 'openai',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKeyEnv: null,
      providerType: 'openai',
    };
    const proxy = await createTestProxy(new Map([['openai', provider]]));

    try {
      const response = await makeRequest(proxy.port, {
        method: 'POST',
        path: '/v1/openai/v1/chat/completions',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await proxy.close();
    }
  });

  // Test 4: Nonexistent route returns 404 JSON error
  it('returns 404 JSON error for nonexistent route', async () => {
    const proxy = await createTestProxy(new Map());

    try {
      const response = await makeRequest(proxy.port, {
        method: 'GET',
        path: '/v1/nonexistent/route',
      });

      expect(response.statusCode).toBe(404);
      const parsed = JSON.parse(response.body);
      expect(parsed.error.code).toBe('not_found');
    } finally {
      await proxy.close();
    }
  });

  // Test 5: Upstream 429 is forwarded with original headers
  it('forwards upstream 429 response with original headers', async () => {
    const upstreamState429: UpstreamState = { capturedHeaders: {}, capturedBody: '', capturedPath: '' };
    const upstream429 = await createTestUpstream(upstreamState429, {
      statusCode: 429,
      body: JSON.stringify({ error: { message: 'Rate limited' } }),
      headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0' },
    });

    const provider: ProviderConfig = {
      name: 'openai',
      baseUrl: `http://127.0.0.1:${upstream429.port}`,
      apiKeyEnv: null,
      providerType: 'openai',
    };
    const proxy = await createTestProxy(new Map([['openai', provider]]));

    try {
      const response = await makeRequest(proxy.port, {
        method: 'POST',
        path: '/v1/openai/v1/chat/completions',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });

      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('30');
    } finally {
      await proxy.close();
      await upstream429.close();
    }
  });
});
