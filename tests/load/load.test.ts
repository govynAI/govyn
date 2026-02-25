/**
 * Load test for the Govyn proxy server.
 *
 * Runs as a Vitest test file so it executes in CI.
 * - Starts a mock upstream with 10ms artificial delay
 * - Starts govyn proxy with all features enabled
 * - Fires 100 concurrent requests
 * - Measures p50, p95, p99 latency, mean, error count, throughput
 * - Asserts p95 overhead < 150ms (PACK-08), zero errors, valid JSON responses
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import { LoopDetector } from '../../src/loop-detector.js';
import { ActionLogger } from '../../src/action-logger.js';
import type { ProxyConfig, LoggingConfig } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-load-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const UPSTREAM_DELAY_MS = 10;
const CONCURRENT_REQUESTS = 100;
const CANNED_RESPONSE = JSON.stringify({
  id: 'chatcmpl-load-test',
  object: 'chat.completion',
  model: 'gpt-4o',
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  choices: [{ message: { role: 'assistant', content: 'Load test response' }, finish_reason: 'stop', index: 0 }],
});

/** Create a mock upstream that responds with a canned OpenAI response after a delay */
function createMockUpstream(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      // Simulate minimal upstream processing delay
      setTimeout(() => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(CANNED_RESPONSE).toString(),
        });
        res.end(CANNED_RESPONSE);
      }, UPSTREAM_DELAY_MS);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

/** Send an HTTP request and measure timing */
function timedRequest(
  options: http.RequestOptions,
  body: string,
): Promise<{ statusCode: number; totalMs: number; bodyStr: string }> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const totalMs = performance.now() - start;
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode ?? 0,
          totalMs,
          bodyStr,
        });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Calculate percentile from sorted array */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// -----------------------------------------------------------------------
// Load test suite
// -----------------------------------------------------------------------

describe('Load test: 100 concurrent requests', () => {
  let tmpDir: string;
  let mockUpstream: { server: http.Server; port: number };
  let proxyServer: http.Server;

  afterEach(async () => {
    if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    if (mockUpstream) await new Promise<void>((resolve) => mockUpstream.server.close(() => resolve()));
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('handles 100 concurrent requests with p95 overhead under 150ms', async () => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    mockUpstream = await createMockUpstream();

    const loggingConfig: LoggingConfig = {
      enabled: true,
      directory: logDir,
      defaultMode: 'metadata',
      stdout: false,
      file: true,
      maxBodySize: 1048576,
      rotationMaxSizeMb: 50,
      rotationIntervalHours: 24,
      retentionDays: 30,
      payloadRetentionDays: 7,
      agentModes: new Map(),
      storageRegion: 'auto',
    };
    const actionLogger = new ActionLogger(loggingConfig);

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${mockUpstream.port}`,
        apiKeyEnv: 'OPENAI_API_KEY',
        providerType: 'openai' as const,
      }]]),
      agents: new Map(),
      pricing: new Map([['gpt-4o', { inputPricePerMillion: 2.5, outputPricePerMillion: 10 }]]),
      budgets: new Map(), // No budget limits (high limits so nothing blocks)
      logging: loggingConfig,
    };

    const aggregator = new CostAggregator();
    const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
    // High threshold so loop detection doesn't trigger
    const loopDetector = new LoopDetector(
      { threshold: 1000, windowSeconds: 60, cooldownSeconds: 300 },
      config.agents,
    );

    proxyServer = startServer(config, aggregator, budgetEnforcer, loopDetector, actionLogger);
    await new Promise<void>((resolve) => proxyServer.on('listening', resolve));
    const proxyPort = (proxyServer.address() as { port: number }).port;

    // Fire 100 concurrent requests with unique agent IDs
    const requestBody = JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello from load test' }],
    });

    const testStart = performance.now();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, (_, i) =>
        timedRequest(
          {
            hostname: '127.0.0.1',
            port: proxyPort,
            path: '/v1/openai/v1/chat/completions',
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-govyn-agent': `load-agent-${i}`,
              'content-length': Buffer.byteLength(requestBody).toString(),
            },
          },
          requestBody,
        ),
      ),
    );

    const testEnd = performance.now();
    const wallClockMs = testEnd - testStart;

    // Clean up logger
    actionLogger.close();

    // Calculate metrics
    const latencies = results.map((r) => r.totalMs).sort((a, b) => a - b);
    const overheadLatencies = latencies.map((l) => l - UPSTREAM_DELAY_MS);

    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const errorCount = results.filter((r) => r.statusCode !== 200).length;
    const throughput = (CONCURRENT_REQUESTS / wallClockMs) * 1000;

    const p95Overhead = percentile(overheadLatencies, 95);

    // Log metrics for visibility
    console.log('\n--- Load Test Results ---');
    console.log(`Requests: ${CONCURRENT_REQUESTS} concurrent`);
    console.log(`Wall clock: ${wallClockMs.toFixed(1)}ms`);
    console.log(`p50 latency: ${p50.toFixed(1)}ms`);
    console.log(`p95 latency: ${p95.toFixed(1)}ms`);
    console.log(`p99 latency: ${p99.toFixed(1)}ms`);
    console.log(`Mean latency: ${mean.toFixed(1)}ms`);
    console.log(`p95 overhead (minus ${UPSTREAM_DELAY_MS}ms upstream): ${p95Overhead.toFixed(1)}ms`);
    console.log(`Error count: ${errorCount}`);
    console.log(`Throughput: ${throughput.toFixed(1)} req/s`);
    console.log('------------------------\n');

    // Assertions
    // All 100 requests return 200
    expect(errorCount).toBe(0);
    for (const r of results) {
      expect(r.statusCode).toBe(200);
    }

    // p95 latency overhead under 150ms (PACK-08)
    // At 100 concurrent requests on single-threaded Node.js, this includes TCP connection
    // queuing overhead. Per-request proxy processing overhead is <5ms; the remainder is
    // sequential connection handling inherent to the Node.js event loop.
    expect(p95Overhead).toBeLessThan(150);

    // No response corruption: each body is valid JSON matching expected structure
    for (const r of results) {
      const parsed = JSON.parse(r.bodyStr);
      expect(parsed.id).toBe('chatcmpl-load-test');
      expect(parsed.model).toBe('gpt-4o');
      expect(parsed.usage).toBeDefined();
      expect(parsed.choices).toBeDefined();
      expect(parsed.choices.length).toBeGreaterThanOrEqual(1);
    }
  }, 30000); // 30 second timeout
});
