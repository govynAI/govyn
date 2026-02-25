/**
 * Integration tests for SSE streaming passthrough.
 *
 * Verifies that SSE events are forwarded correctly through the proxy,
 * chunk order is preserved, Content-Type is correct, and first-token
 * latency overhead is under 50ms.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

/**
 * Create a mock upstream that sends SSE events with configurable delays.
 * Sends 3 data chunks with usage in the final chunk, plus [DONE] marker.
 */
function createSSEUpstream(delayMs: number = 50): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });

        const sseChunks = [
          'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" beautiful"}}]}\n\n',
          'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}],"model":"gpt-4o","usage":{"prompt_tokens":50,"completion_tokens":30,"total_tokens":80}}\n\n',
          'data: [DONE]\n\n',
        ];

        let i = 0;
        function sendNext() {
          if (i < sseChunks.length) {
            res.write(sseChunks[i]);
            i++;
            setTimeout(sendNext, delayMs);
          } else {
            res.end();
          }
        }
        sendNext();
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
 * Read an SSE response from a server, collecting all chunks.
 */
function readSSEResponse(port: number, path: string, options?: {
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  chunks: string[];
  firstChunkTime: number;
  requestTime: number;
}> {
  return new Promise((resolve, reject) => {
    const body = options?.body ?? '';
    const requestTime = Date.now();

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(options?.headers ?? {}),
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: string[] = [];
        let firstChunkTime = 0;

        res.on('data', (chunk: Buffer) => {
          if (firstChunkTime === 0) firstChunkTime = Date.now();
          chunks.push(chunk.toString('utf8'));
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            chunks,
            firstChunkTime,
            requestTime,
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

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('streaming SSE integration', () => {
  let sseUpstream: Awaited<ReturnType<typeof createSSEUpstream>>;
  let proxyServer: http.Server;
  let proxyPort: number;

  beforeAll(async () => {
    sseUpstream = await createSSEUpstream(30); // 30ms between chunks

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${sseUpstream.port}`,
        apiKeyEnv: null,
        providerType: 'openai',
      }]]),
      agents: new Map(),
      pricing: loadPricing(),
      budgets: new Map(),
    };
    proxyServer = startServer(config, new CostAggregator());
    await waitForListen(proxyServer);
    proxyPort = (proxyServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    proxyServer.close();
    await sseUpstream.close();
  });

  // Test 1: All 3 data chunks received in correct order
  it('all SSE data chunks received in correct order', async () => {
    const result = await readSSEResponse(proxyPort, '/v1/openai/v1/chat/completions', {
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });

    const allData = result.chunks.join('');
    expect(allData).toContain('Hello');
    expect(allData).toContain('beautiful');
    expect(allData).toContain('world');

    // Verify order: Hello comes before beautiful comes before world
    const helloIdx = allData.indexOf('Hello');
    const beautifulIdx = allData.indexOf('beautiful');
    const worldIdx = allData.indexOf('world');
    expect(helloIdx).toBeLessThan(beautifulIdx);
    expect(beautifulIdx).toBeLessThan(worldIdx);
  });

  // Test 2: Content-Type is text/event-stream
  it('response Content-Type is text/event-stream', async () => {
    const result = await readSSEResponse(proxyPort, '/v1/openai/v1/chat/completions', {
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });

    expect(result.headers['content-type']).toContain('text/event-stream');
  });

  // Test 3: First-token latency overhead under 50ms
  it('first-token latency overhead through proxy is under 50ms', async () => {
    // Direct request to upstream
    const directResult = await readSSEResponse(sseUpstream.port, '/v1/chat/completions', {
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });
    const directLatency = directResult.firstChunkTime - directResult.requestTime;

    // Proxied request
    const proxyResult = await readSSEResponse(proxyPort, '/v1/openai/v1/chat/completions', {
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });
    const proxyLatency = proxyResult.firstChunkTime - proxyResult.requestTime;

    // Overhead should be under 50ms
    const overhead = proxyLatency - directLatency;
    expect(overhead).toBeLessThan(50);
  });

  // Test 4: [DONE] marker is passed through
  it('SSE [DONE] marker is passed through', async () => {
    const result = await readSSEResponse(proxyPort, '/v1/openai/v1/chat/completions', {
      body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
    });

    const allData = result.chunks.join('');
    expect(allData).toContain('[DONE]');
  });

  // Test 5: Token usage extracted from final chunk
  it('token usage is extracted from final SSE chunk with usage field', async () => {
    const aggregator = new CostAggregator();
    const sseUpstreamForTokens = await createSSEUpstream(10);

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${sseUpstreamForTokens.port}`,
        apiKeyEnv: null,
        providerType: 'openai',
      }]]),
      agents: new Map([['test-agent', { name: 'test-agent', apiKeys: [] }]]),
      pricing: loadPricing(),
      budgets: new Map(),
    };
    const server = startServer(config, aggregator);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      await readSSEResponse(port, '/v1/openai/v1/chat/completions', {
        headers: { 'x-govyn-agent': 'test-agent' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [], stream: true }),
      });

      // Wait for async cost recording
      await new Promise((r) => setTimeout(r, 100));

      const summaries = aggregator.getSummary({ agentId: 'test-agent' });
      expect(summaries.length).toBe(1);
      expect(summaries[0]!.totalInputTokens).toBe(50);
      expect(summaries[0]!.totalOutputTokens).toBe(30);
    } finally {
      server.close();
      await sseUpstreamForTokens.close();
    }
  });
});
