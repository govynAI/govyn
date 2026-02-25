/**
 * Integration tests for the log purge endpoint (DELETE /api/logs?before=DATE).
 *
 * Tests:
 * - Purge all log entries older than a given date
 * - Verify log file is empty after purge
 * - Missing 'before' parameter returns 400
 * - Invalid date format returns 400
 * - Purge with full-payload mode also deletes payload files
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
import type { ProxyConfig, LoggingConfig, LogEntry } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-purge-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeLoggingConfig(dir: string, overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    enabled: true,
    directory: dir,
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
    ...overrides,
  };
}

/** Create a mock upstream that returns a canned OpenAI response */
function createMockUpstream(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const body = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop', index: 0 }],
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body).toString(),
      });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

/** Send an HTTP request and return the response */
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

/** Wait for N milliseconds */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Read all log entries from JSONL files in the log directory */
function readLogEntries(logDir: string): LogEntry[] {
  const resolvedDir = path.resolve(logDir);
  if (!fs.existsSync(resolvedDir)) return [];
  const files = fs.readdirSync(resolvedDir).filter((f) => f.endsWith('.jsonl'));
  const entries: LogEntry[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(resolvedDir, file), 'utf8');
    const lines = content.trim().split('\n').filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed
      }
    }
  }
  return entries;
}

// -----------------------------------------------------------------------
// Test suite: DELETE /api/logs?before=DATE
// -----------------------------------------------------------------------

describe('Log Purge: DELETE /api/logs?before=DATE', () => {
  let tmpDir: string;
  let mockUpstream: { server: http.Server; port: number };
  let proxyServer: http.Server;
  let proxyPort: number;
  let actionLogger: ActionLogger;

  afterEach(async () => {
    if (actionLogger) actionLogger.close();
    if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    if (mockUpstream) await new Promise<void>((resolve) => mockUpstream.server.close(() => resolve()));
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  async function setupProxy(loggingOverrides: Partial<LoggingConfig> = {}) {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    mockUpstream = await createMockUpstream();

    const loggingConfig = makeLoggingConfig(logDir, loggingOverrides);
    actionLogger = new ActionLogger(loggingConfig);

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
    const addr = proxyServer.address() as { port: number };
    proxyPort = addr.port;
  }

  it('purges log entries and returns correct count', async () => {
    await setupProxy();

    // Send 5 requests through the proxy
    for (let i = 0; i < 5; i++) {
      await httpRequest({
        hostname: '127.0.0.1',
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-govyn-agent': `test-agent-${i}`,
        },
      }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));
    }

    // Wait for flush (1.1s)
    await wait(1200);

    // Verify entries exist
    const logDir = path.join(tmpDir, 'logs');
    const entriesBefore = readLogEntries(logDir);
    expect(entriesBefore.length).toBe(5);

    // Purge all entries
    const futureDate = new Date(Date.now() + 60000).toISOString();
    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `/api/logs?before=${encodeURIComponent(futureDate)}`,
      method: 'DELETE',
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.deleted_logs).toBe(5);

    // Verify log file is empty
    const entriesAfter = readLogEntries(logDir);
    expect(entriesAfter.length).toBe(0);
  });

  it('returns 400 when before parameter is missing', async () => {
    await setupProxy();

    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/api/logs',
      method: 'DELETE',
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe('missing_parameter');
    expect(result.body.error.message).toContain("'before'");
  });

  it('returns 400 for invalid date format', async () => {
    await setupProxy();

    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/api/logs?before=not-a-date',
      method: 'DELETE',
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error.code).toBe('invalid_date');
  });

  it('purges payload files for full-payload entries', async () => {
    await setupProxy({ defaultMode: 'full-payload' });

    // Send a request that will have its payload stored
    await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-govyn-agent': 'payload-test-agent',
      },
    }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));

    // Wait for flush
    await wait(1200);

    const logDir = path.join(tmpDir, 'logs');
    const payloadsDir = path.join(logDir, 'payloads');

    // Verify payload file was created
    const payloadFilesBefore = fs.existsSync(payloadsDir)
      ? fs.readdirSync(payloadsDir).filter((f) => f.endsWith('.json'))
      : [];
    expect(payloadFilesBefore.length).toBeGreaterThanOrEqual(1);

    // Purge all entries
    const futureDate = new Date(Date.now() + 60000).toISOString();
    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `/api/logs?before=${encodeURIComponent(futureDate)}`,
      method: 'DELETE',
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.deleted_logs).toBeGreaterThanOrEqual(1);
    expect(result.body.deleted_payloads).toBeGreaterThanOrEqual(1);

    // Verify payload files were deleted
    const payloadFilesAfter = fs.existsSync(payloadsDir)
      ? fs.readdirSync(payloadsDir).filter((f) => f.endsWith('.json'))
      : [];
    expect(payloadFilesAfter.length).toBe(0);
  });

  it('returns 0 deleted when no entries match the date', async () => {
    await setupProxy();

    // Send a request
    await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-govyn-agent': 'test-agent',
      },
    }, JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));

    await wait(1200);

    // Purge with a date in the past (before the entries were created)
    const pastDate = new Date('2020-01-01T00:00:00Z').toISOString();
    const result = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `/api/logs?before=${encodeURIComponent(pastDate)}`,
      method: 'DELETE',
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.deleted_logs).toBe(0);

    // Entries should still exist
    const logDir = path.join(tmpDir, 'logs');
    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);
  });
});
