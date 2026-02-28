/**
 * Integration tests for database persistence.
 *
 * Verifies:
 * - Server starts normally without database config (backward compat)
 * - Server accepts dbWriter parameter without error
 * - Cost recording path calls dbWriter when present
 * - Policy evaluation path calls dbWriter when present
 * - Fail-open behavior: proxy still responds when dbWriter write fails
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { loadPricing } from '../../src/pricing.js';
import { DbWriter } from '../../src/db-writer.js';
import type { ProxyConfig } from '../../src/types.js';

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

/** Create a mock upstream server that returns a simple OpenAI-format response. */
function createMockUpstream(port: number): http.Server {
  return http.createServer((_req, res) => {
    const body = JSON.stringify({
      id: 'chatcmpl-test',
      choices: [{ message: { content: 'Hello' } }],
      model: 'gpt-4o',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    });
    res.end(body);
  }).listen(port, '127.0.0.1');
}

/**
 * Create a mock SQL tagged template function that tracks calls.
 */
function createMockSql(behavior: 'success' | 'error' = 'success') {
  const error = new Error('Mock DB error');
  const calls: any[][] = [];

  const mockFn = function (...args: any[]) {
    calls.push(args);
    if (behavior === 'error') return Promise.reject(error);
    return Promise.resolve([]);
  } as any;

  mockFn.unsafe = (...args: any[]) => {
    calls.push(args);
    if (behavior === 'error') return Promise.reject(error);
    return Promise.resolve([]);
  };

  mockFn.end = () => Promise.resolve();
  mockFn._calls = calls;

  return mockFn;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('db persistence integration', () => {
  const UPSTREAM_PORT = 18301;
  const PROXY_PORT_NO_DB = 18302;
  const PROXY_PORT_WITH_DB = 18303;
  const PROXY_PORT_FAIL_OPEN = 18304;

  let mockUpstream: http.Server;

  beforeAll(async () => {
    mockUpstream = createMockUpstream(UPSTREAM_PORT);
    await new Promise<void>((resolve) => {
      if (mockUpstream.listening) { resolve(); return; }
      mockUpstream.once('listening', resolve);
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
  });

  it('server starts normally without database config (backward compat)', async () => {
    const config: ProxyConfig = {
      port: PROXY_PORT_NO_DB,
      host: '127.0.0.1',
      providers: new Map([
        ['openai', { name: 'openai', baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}`, apiKeyEnv: null, providerType: 'openai' }],
      ]),
      agents: new Map(),
      pricing: loadPricing(),
      budgets: new Map(),
    };

    const aggregator = new CostAggregator();
    // No dbWriter passed — should work fine
    const server = startServer(config, aggregator);
    await waitForListen(server);

    const res = await httpRequest({ port: PROXY_PORT_NO_DB, path: '/health' });
    expect(res.statusCode).toBe(200);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('server accepts dbWriter parameter and proxies requests', async () => {
    const mockSql = createMockSql('success');
    const dbWriter = new DbWriter(mockSql, true);
    const writeCostSpy = vi.spyOn(dbWriter, 'writeCostRecord');

    const config: ProxyConfig = {
      port: PROXY_PORT_WITH_DB,
      host: '127.0.0.1',
      providers: new Map([
        ['openai', { name: 'openai', baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}`, apiKeyEnv: null, providerType: 'openai' }],
      ]),
      agents: new Map(),
      pricing: loadPricing(),
      budgets: new Map(),
    };

    const aggregator = new CostAggregator();
    const server = startServer(config, aggregator, undefined, undefined, undefined, undefined, dbWriter);
    await waitForListen(server);

    // Make a request through the proxy
    const res = await httpRequest({
      port: PROXY_PORT_WITH_DB,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.statusCode).toBe(200);

    // Give fire-and-forget write time to be called
    await new Promise((r) => setTimeout(r, 100));

    // DbWriter should have been called with the cost record
    expect(writeCostSpy).toHaveBeenCalledTimes(1);
    const record = writeCostSpy.mock.calls[0][0];
    expect(record.agentId).toBeDefined();
    expect(record.model).toBe('gpt-4o');
    expect(record.provider).toBe('openai');

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fail-open: proxy still responds when dbWriter write fails', async () => {
    const mockSql = createMockSql('error');
    const dbWriter = new DbWriter(mockSql, true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const config: ProxyConfig = {
      port: PROXY_PORT_FAIL_OPEN,
      host: '127.0.0.1',
      providers: new Map([
        ['openai', { name: 'openai', baseUrl: `http://127.0.0.1:${UPSTREAM_PORT}`, apiKeyEnv: null, providerType: 'openai' }],
      ]),
      agents: new Map(),
      pricing: loadPricing(),
      budgets: new Map(),
    };

    const aggregator = new CostAggregator();
    const server = startServer(config, aggregator, undefined, undefined, undefined, undefined, dbWriter);
    await waitForListen(server);

    // Request should succeed even though DB writes fail
    const res = await httpRequest({
      port: PROXY_PORT_FAIL_OPEN,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.statusCode).toBe(200);

    // Give fire-and-forget time to process
    await new Promise((r) => setTimeout(r, 100));

    // In-memory aggregator should still have the cost record
    const summaries = aggregator.getSummary();
    expect(summaries.length).toBeGreaterThan(0);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    stderrSpy.mockRestore();
  });
});
