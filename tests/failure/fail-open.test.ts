/**
 * Failure mode tests for fail-open behavior (ADR-002).
 *
 * Tests:
 * 1. Log directory unavailable — proxy continues forwarding
 * 2. Cost aggregator handles many records without crashing
 * 3. Budget enforcer with no config — all requests pass through
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-failopen-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const CANNED_RESPONSE = JSON.stringify({
  id: 'chatcmpl-failtest',
  object: 'chat.completion',
  model: 'gpt-4o',
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop', index: 0 }],
});

function createMockUpstream(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(CANNED_RESPONSE).toString(),
      });
      res.end(CANNED_RESPONSE);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function httpRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let parsed: any;
        try {
          parsed = JSON.parse(bodyStr);
        } catch {
          parsed = bodyStr;
        }
        resolve({ statusCode: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// -----------------------------------------------------------------------
// Test suite: Fail-open behavior
// -----------------------------------------------------------------------

describe('Fail-open: log directory unavailable', () => {
  let mockUpstream: { server: http.Server; port: number };
  let proxyServer: http.Server;
  let tmpDir: string;
  let stderrSpy: ReturnType<typeof import('vitest').vi.spyOn>;

  afterEach(async () => {
    if (stderrSpy) stderrSpy.mockRestore();
    if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    if (mockUpstream) await new Promise<void>((resolve) => mockUpstream.server.close(() => resolve()));
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('proxy forwards requests even when log directory write fails', async () => {
    tmpDir = makeTempDir();
    mockUpstream = await createMockUpstream();

    // Create a log directory that exists but will fail on write
    // We create the ActionLogger with a directory, then make the log file unwritable
    const logDir = path.join(tmpDir, 'logs');
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

    // Sabotage the log directory: remove it so flush fails
    // The logger was already created (directories exist), but we remove them
    // to simulate filesystem failure during operation
    const currentFile = actionLogger.getCurrentFilePath();
    fs.rmSync(path.dirname(currentFile), { recursive: true, force: true });

    // Capture stderr to verify warning is emitted
    const { vi } = await import('vitest');
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

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
      budgets: new Map(),
      logging: loggingConfig,
    };

    const aggregator = new CostAggregator();
    const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
    const loopDetector = new LoopDetector(
      { threshold: 1000, windowSeconds: 60, cooldownSeconds: 300 },
      config.agents,
    );

    proxyServer = startServer(config, aggregator, budgetEnforcer, loopDetector, actionLogger);
    await new Promise<void>((resolve) => proxyServer.on('listening', resolve));
    const proxyPort = (proxyServer.address() as { port: number }).port;

    // Send a request through the proxy
    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-govyn-agent': 'failopen-agent',
      },
    }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));

    // The request should be forwarded successfully (proxy doesn't crash)
    expect(result.statusCode).toBe(200);
    expect(result.body.id).toBe('chatcmpl-failtest');
    expect(result.body.model).toBe('gpt-4o');

    // Wait for the flush interval to trigger (the flush will fail, emitting warning)
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Check that a warning was logged to stderr about the logging failure
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const hasWarning = stderrCalls.some((msg) => msg.includes('[govyn]') && msg.includes('Failed'));
    expect(hasWarning).toBe(true);

    actionLogger.close();
  });
});

describe('Fail-open: cost aggregator overflow', () => {
  it('handles 10,000 cost records without crashing', () => {
    const aggregator = new CostAggregator();

    // Record 10,000 cost entries
    for (let i = 0; i < 10000; i++) {
      aggregator.recordCost({
        agentId: `agent-${i % 100}`,
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        inputCost: 0.00025,
        outputCost: 0.0005,
        totalCost: 0.00075,
        priced: true,
        timestamp: Date.now(),
      });
    }

    // Query costs — should succeed without crashing
    const summary = aggregator.getSummary('all');
    expect(summary.length).toBeGreaterThan(0);

    // Total records across all agents should be 10,000
    const totalRecords = summary.reduce((acc, s) => acc + s.requestCount, 0);
    expect(totalRecords).toBe(10000);
  });
});

describe('Fail-open: budget enforcer with no config', () => {
  let mockUpstream: { server: http.Server; port: number };
  let proxyServer: http.Server;

  afterEach(async () => {
    if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    if (mockUpstream) await new Promise<void>((resolve) => mockUpstream.server.close(() => resolve()));
  });

  it('all requests pass through with empty budgets map', async () => {
    mockUpstream = await createMockUpstream();

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
      budgets: new Map(), // Empty budgets
    };

    const aggregator = new CostAggregator();
    // Empty budgets — no limits at all
    const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
    const loopDetector = new LoopDetector(
      { threshold: 1000, windowSeconds: 60, cooldownSeconds: 300 },
      config.agents,
    );

    proxyServer = startServer(config, aggregator, budgetEnforcer, loopDetector);
    await new Promise<void>((resolve) => proxyServer.on('listening', resolve));
    const proxyPort = (proxyServer.address() as { port: number }).port;

    // Send 5 requests — all should pass (no false blocks)
    for (let i = 0; i < 5; i++) {
      const result = await httpRequest({
        hostname: '127.0.0.1',
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-govyn-agent': `no-budget-agent-${i}`,
        },
      }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));

      expect(result.statusCode).toBe(200);
      expect(result.body.id).toBe('chatcmpl-failtest');
    }
  });
});
