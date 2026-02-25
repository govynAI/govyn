/**
 * Tests for upstream error forwarding (src/proxy.ts).
 *
 * Verifies that upstream 429 and other error responses are forwarded
 * verbatim with all headers preserved — per ADR-016 (no retry, pass through).
 *
 * Uses real local HTTP server pairs consistent with the pattern from 01-01.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { ProxyConfig } from '../src/types.js';

// Ports for this test suite
const UPSTREAM_PORT = 14301;
const PROXY_PORT = 14302;

/** Upstream server that returns configurable error responses. */
let upstreamServer: http.Server;

/** The proxy server under test. */
let proxyServer: http.Server;

/** Wait for a server to begin listening. */
function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
}

/** Make a GET request and collect status, headers, and body. */
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Route responses: keyed by URL path
const routeHandlers: Record<string, (res: http.ServerResponse) => void> = {
  '/v1/chat/completions-429': (res) => {
    res.writeHead(429, {
      'content-type': 'application/json',
      'retry-after': '30',
      'x-ratelimit-limit-requests': '100',
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-limit-tokens': '40000',
      'x-ratelimit-remaining-tokens': '0',
      'x-ratelimit-reset-requests': '2026-02-24T20:00:00Z',
      'x-ratelimit-reset-tokens': '2026-02-24T20:00:00Z',
    });
    res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }));
  },
  '/v1/chat/completions-500': (res) => {
    res.writeHead(500, {
      'content-type': 'application/json',
      'x-request-id': 'upstream-req-abc123',
    });
    res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error' } }));
  },
  '/v1/chat/completions-503': (res) => {
    res.writeHead(503, {
      'content-type': 'application/json',
      'retry-after': '60',
    });
    res.end(JSON.stringify({ error: { message: 'Service temporarily unavailable', type: 'service_unavailable' } }));
  },
};

beforeAll(async () => {
  // Create the configurable upstream error server
  upstreamServer = http.createServer((req, res) => {
    const path = req.url ?? '/';
    const handler = routeHandlers[path];
    if (handler) {
      handler(res);
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    }
  });
  upstreamServer.listen(UPSTREAM_PORT, '127.0.0.1');
  await waitForListen(upstreamServer);

  // Create the proxy server routing to the upstream error server
  const config: ProxyConfig = {
    port: PROXY_PORT,
    host: '127.0.0.1',
    providers: new Map([
      [
        'custom',
        {
          name: 'custom',
          baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}`,
          apiKeyEnv: null,
          providerType: 'custom',
        },
      ],
    ]),
    agents: new Map(),
    pricing: new Map(),
    budgets: new Map(),
  };
  proxyServer = startServer(config, new CostAggregator());
  await waitForListen(proxyServer);
});

afterAll(() => {
  upstreamServer.close();
  proxyServer.close();
});

describe('upstream 429 error forwarding', () => {
  it('forwards 429 status code verbatim', async () => {
    const { status } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    expect(status).toBe(429);
  });

  it('forwards Retry-After header from 429 response', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    expect(headers['retry-after']).toBe('30');
  });

  it('forwards x-ratelimit-remaining-requests header', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    expect(headers['x-ratelimit-remaining-requests']).toBe('0');
  });

  it('forwards x-ratelimit-limit-requests header', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    expect(headers['x-ratelimit-limit-requests']).toBe('100');
  });

  it('forwards x-ratelimit-reset-requests header', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    expect(headers['x-ratelimit-reset-requests']).toBe('2026-02-24T20:00:00Z');
  });

  it('forwards 429 response body verbatim (not wrapped in Govyn error format)', async () => {
    const { body } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-429`,
    );
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    // Should be the upstream body, NOT wrapped in Govyn's { error: { code } } format
    expect(parsed.error?.type).toBe('rate_limit_error');
    expect(parsed.error?.message).toBe('Rate limit exceeded');
    // Verify no Govyn-specific 'code' field wrapping
    expect((parsed.error as Record<string, unknown>)?.['code']).toBeUndefined();
  });
});

describe('upstream 500 error forwarding', () => {
  it('forwards 500 status code verbatim', async () => {
    const { status } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-500`,
    );
    expect(status).toBe(500);
  });

  it('forwards upstream custom headers on 500 response', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-500`,
    );
    expect(headers['x-request-id']).toBe('upstream-req-abc123');
  });

  it('forwards 500 response body verbatim', async () => {
    const { body } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-500`,
    );
    const parsed = JSON.parse(body) as { error?: { type?: string } };
    expect(parsed.error?.type).toBe('server_error');
  });
});

describe('upstream 503 error forwarding', () => {
  it('forwards 503 status code verbatim', async () => {
    const { status } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-503`,
    );
    expect(status).toBe(503);
  });

  it('forwards Retry-After header on 503 response', async () => {
    const { headers } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-503`,
    );
    expect(headers['retry-after']).toBe('60');
  });

  it('forwards 503 response body verbatim', async () => {
    const { body } = await httpGet(
      `http://127.0.0.1:${PROXY_PORT}/v1/custom/custom/v1/chat/completions-503`,
    );
    const parsed = JSON.parse(body) as { error?: { type?: string } };
    expect(parsed.error?.type).toBe('service_unavailable');
  });
});

describe('proxy own errors still return 502', () => {
  it('returns 502 when upstream is unreachable', async () => {
    // Use a port where nothing is listening
    const config: ProxyConfig = {
      port: 14303,
      host: '127.0.0.1',
      providers: new Map([
        [
          'custom',
          {
            name: 'custom',
            baseUrl: 'http://127.0.0.1:19999', // Nothing listening here
            apiKeyEnv: null,
            providerType: 'custom',
          },
        ],
      ]),
      agents: new Map(),
      pricing: new Map(),
      budgets: new Map(),
    };
    const unreachableProxy = startServer(config, new CostAggregator());
    await new Promise<void>((resolve) => {
      if (unreachableProxy.listening) { resolve(); return; }
      unreachableProxy.once('listening', resolve);
    });

    try {
      const { status, body } = await httpGet(
        'http://127.0.0.1:14303/v1/custom/custom/test',
      );
      expect(status).toBe(502);

      const parsed = JSON.parse(body) as { error?: { code?: string } };
      expect(parsed.error?.code).toBe('upstream_connection_error');
    } finally {
      unreachableProxy.close();
    }
  });
});
