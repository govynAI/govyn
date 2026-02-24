/**
 * Tests for the request forwarding logic.
 *
 * Uses real local HTTP servers to verify correct request forwarding
 * without hitting real external APIs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { ProxyConfig, ProviderConfig } from '../src/types.js';

/**
 * Create a simple local HTTP test server that captures incoming requests
 * and responds with configurable responses.
 */
type UpstreamState = {
  capturedHeaders: http.IncomingHttpHeaders;
  capturedBody: string;
  capturedPath: string;
};

function createTestUpstream(state: UpstreamState): Promise<{
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
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
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

/**
 * Make an HTTP request to a local server and return the response.
 */
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

/**
 * Start the Govyn proxy server for testing.
 */
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
      agents: new Map(),
      pricing: new Map(),
    };
    const server = startServer(config, new CostAggregator());
    // startServer calls server.listen — wait for it
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

describe('forwardRequest (via proxy server)', () => {
  let upstreamState: UpstreamState;
  let upstream: Awaited<ReturnType<typeof createTestUpstream>>;
  let proxy: Awaited<ReturnType<typeof createTestProxy>>;

  beforeAll(async () => {
    upstreamState = {
      capturedHeaders: {},
      capturedBody: '',
      capturedPath: '',
    };
    upstream = await createTestUpstream(upstreamState);
  });

  afterAll(async () => {
    await upstream.close();
    if (proxy) await proxy.close();
  });

  it('sends Authorization: Bearer header for OpenAI provider', async () => {
    process.env['TEST_OPENAI_KEY'] = 'sk-test-openai-key-123';

    const openaiProvider: ProviderConfig = {
      name: 'openai',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKeyEnv: 'TEST_OPENAI_KEY',
      providerType: 'openai',
    };

    proxy = await createTestProxy(new Map([['openai', openaiProvider]]));

    const response = await makeRequest(proxy.port, {
      method: 'POST',
      path: '/v1/openai/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    expect(response.statusCode).toBe(200);
    expect(upstreamState.capturedHeaders['authorization']).toBe(
      'Bearer sk-test-openai-key-123',
    );
    expect(upstreamState.capturedHeaders['content-type']).toBe('application/json');
    expect(upstreamState.capturedPath).toBe('/v1/chat/completions');

    await proxy.close();
    delete process.env['TEST_OPENAI_KEY'];
  });

  it('sends x-api-key header for Anthropic provider', async () => {
    process.env['TEST_ANTHROPIC_KEY'] = 'sk-ant-test-key-456';

    const anthropicProvider: ProviderConfig = {
      name: 'anthropic',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiKeyEnv: 'TEST_ANTHROPIC_KEY',
      providerType: 'anthropic',
    };

    proxy = await createTestProxy(new Map([['anthropic', anthropicProvider]]));

    const response = await makeRequest(proxy.port, {
      method: 'POST',
      path: '/v1/anthropic/v1/messages',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', messages: [] }),
    });

    expect(response.statusCode).toBe(200);
    expect(upstreamState.capturedHeaders['x-api-key']).toBe('sk-ant-test-key-456');
    expect(upstreamState.capturedHeaders['anthropic-version']).toBe('2023-06-01');
    expect(upstreamState.capturedPath).toBe('/v1/messages');

    await proxy.close();
    delete process.env['TEST_ANTHROPIC_KEY'];
  });

  it('returns 502 when upstream is unreachable', async () => {
    const unreachableProvider: ProviderConfig = {
      name: 'unreachable',
      // Port 1 should be unreachable on localhost
      baseUrl: 'http://127.0.0.1:1',
      apiKeyEnv: null,
      providerType: 'custom',
    };

    proxy = await createTestProxy(
      new Map([['unreachable', unreachableProvider]]),
    );

    const response = await makeRequest(proxy.port, {
      method: 'GET',
      path: '/v1/custom/unreachable/v1/test',
    });

    expect(response.statusCode).toBe(502);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('upstream_connection_error');

    await proxy.close();
  });
});

describe('proxy server routing', () => {
  let proxy: Awaited<ReturnType<typeof createTestProxy>>;

  afterAll(async () => {
    if (proxy) await proxy.close();
  });

  it('returns 404 for unmatched routes', async () => {
    proxy = await createTestProxy(new Map());

    const response = await makeRequest(proxy.port, {
      method: 'GET',
      path: '/unknown/route',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');

    await proxy.close();
  });
});
