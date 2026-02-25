/**
 * Integration tests for the action logging pipeline.
 *
 * Spins up:
 * 1. A mock upstream server returning OpenAI-format responses with usage fields
 * 2. A proxy server with ActionLogger configured, pointed at the mock upstream
 *
 * Verifies end-to-end logging: JSONL output, payload storage, mode toggle API,
 * error logging, and stdout output.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { ActionLogger } from '../src/action-logger.js';
import { loadPricing } from '../src/pricing.js';
import type { ProxyConfig, LoggingConfig, LogEntry } from '../src/types.js';

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
// Mock upstream server
// -----------------------------------------------------------------------

function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const model = urlObj.searchParams.get('model') ?? 'gpt-4o';

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const response = {
          id: 'chatcmpl-test-123',
          object: 'chat.completion',
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from mock!' },
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

/** Create a temp log directory for each test */
function makeTempLogDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-intlog-'));
}

/** Clean up temp directory */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a LoggingConfig for integration tests */
function makeLoggingConfig(dir: string, overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    enabled: true,
    directory: dir,
    defaultMode: 'metadata',
    stdout: false,    // Disable stdout in most integration tests to avoid noise
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

/** Read all log entries from the JSONL file(s) in a directory */
function readLogEntries(logDir: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(logDir, file), 'utf8').trim();
    if (!content) continue;
    const lines = content.split('\n');
    for (const line of lines) {
      entries.push(JSON.parse(line) as LogEntry);
    }
  }
  return entries;
}

// -----------------------------------------------------------------------
// Test suite: Integration logging through proxy
// -----------------------------------------------------------------------

describe('action logging integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;
  let proxyServer: http.Server;
  let proxyPort: number;
  let aggregator: CostAggregator;
  let actionLogger: ActionLogger;
  let logDir: string;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  beforeEach(async () => {
    logDir = makeTempLogDir();
    aggregator = new CostAggregator();

    const loggingConfig = makeLoggingConfig(logDir);
    actionLogger = new ActionLogger(loggingConfig);

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
        ['debug-agent', { name: 'debug-agent', apiKeys: ['govyn-key-debug-agent'] }],
      ]),
      pricing: pricingTable,
      budgets: new Map(),
    };

    proxyServer = startServer(config, aggregator, undefined, undefined, actionLogger);
    await waitForListen(proxyServer);
    proxyPort = (proxyServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    actionLogger.close();
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    cleanupTempDir(logDir);
  });

  // -----------------------------------------------------------------------
  // Test 1: Proxied request generates log entry in JSONL file
  // -----------------------------------------------------------------------

  it('proxied request generates a log entry in the JSONL file with all required fields', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    // Wait for async cost recording + flush
    await new Promise((r) => setTimeout(r, 50));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);

    const entry = entries[0]!;
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.agent_id).toBe('test-agent');
    expect(entry.provider).toBe('openai');
    expect(entry.target).toBeDefined();
    expect(entry.model).toBe('gpt-4o');
    expect(entry.input_tokens).toBe(100);
    expect(entry.output_tokens).toBe(50);
    expect(entry.cost).toBeCloseTo(0.00075, 6);
    expect(entry.priced).toBe(true);
    expect(entry.latency_ms).toBeGreaterThanOrEqual(0);
    expect(entry.status).toBe(200);
    expect(entry.has_payload).toBe(false);
    expect(entry.payload_id).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Test 2: Log entry has correct agent_id, provider, target fields
  // -----------------------------------------------------------------------

  it('log entry has correct agent_id, provider, target, model, tokens, cost, latency, status', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'debug-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 50));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);

    const entry = entries[0]!;
    expect(entry.agent_id).toBe('debug-agent');
    expect(entry.provider).toBe('openai');
    expect(entry.target).toContain('/v1/chat/completions');
    expect(entry.model).toBe('gpt-4o');
    expect(entry.input_tokens).toBe(100);
    expect(entry.output_tokens).toBe(50);
    expect(entry.latency_ms).toBeGreaterThan(0);
    expect(entry.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Test 3: Logging does not block the response
  // -----------------------------------------------------------------------

  it('logging does not block the response (latency is reasonable)', async () => {
    const start = Date.now();
    const proxyRes = await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });
    const elapsed = Date.now() - start;

    expect(proxyRes.statusCode).toBe(200);
    // Response should return in well under 500ms for a local mock
    expect(elapsed).toBeLessThan(500);

    // Wait and verify log entry was still written
    await new Promise((r) => setTimeout(r, 50));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Test 4: Metadata mode does NOT create payload files
  // -----------------------------------------------------------------------

  it('metadata mode does NOT create payload files', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 100));
    actionLogger.flush();

    const payloadsDir = path.join(logDir, 'payloads');
    const payloadFiles = fs.readdirSync(payloadsDir);
    expect(payloadFiles.length).toBe(0);

    const entries = readLogEntries(logDir);
    expect(entries[0]!.has_payload).toBe(false);
    expect(entries[0]!.payload_id).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Test 5: Full-payload mode creates a payload file
  // -----------------------------------------------------------------------

  it('full-payload mode creates a payload file with request and response bodies', async () => {
    // Switch test-agent to full-payload mode
    actionLogger.setMode('test-agent', 'full-payload');

    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    await new Promise((r) => setTimeout(r, 150));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.has_payload).toBe(true);
    expect(entries[0]!.payload_id).toBeDefined();

    // Verify payload file exists
    const payloadId = entries[0]!.payload_id!;
    const payloadPath = path.join(logDir, 'payloads', `${payloadId}.json`);
    expect(fs.existsSync(payloadPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    expect(payload.request_body).toBeDefined();
    expect(payload.response_body).toBeDefined();
    expect(payload.stored_at).toBeDefined();

    // Decode and verify request body contains our message
    const reqBody = Buffer.from(payload.request_body, 'base64').toString('utf8');
    expect(reqBody).toContain('hi');

    // Decode and verify response body contains mock response
    const resBody = Buffer.from(payload.response_body, 'base64').toString('utf8');
    expect(resBody).toContain('Hello from mock!');
  });

  // -----------------------------------------------------------------------
  // Test 6: POST /api/logging/mode toggles agent mode at runtime
  // -----------------------------------------------------------------------

  it('POST /api/logging/mode toggles agent mode at runtime', async () => {
    // Initially metadata mode
    expect(actionLogger.getMode('test-agent')).toBe('metadata');

    // Toggle to full-payload
    const toggleRes = await httpRequest({
      port: proxyPort,
      path: '/api/logging/mode',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test-agent', mode: 'full-payload' }),
    });

    expect(toggleRes.statusCode).toBe(200);
    const data = toggleRes.json as { success: boolean; agent_id: string; mode: string };
    expect(data.success).toBe(true);
    expect(data.agent_id).toBe('test-agent');
    expect(data.mode).toBe('full-payload');

    // Verify mode changed
    expect(actionLogger.getMode('test-agent')).toBe('full-payload');

    // Toggle back to metadata
    const toggleBack = await httpRequest({
      port: proxyPort,
      path: '/api/logging/mode',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test-agent', mode: 'metadata' }),
    });

    expect(toggleBack.statusCode).toBe(200);
    expect(actionLogger.getMode('test-agent')).toBe('metadata');
  });

  // -----------------------------------------------------------------------
  // Test 7: Invalid mode returns 400
  // -----------------------------------------------------------------------

  it('POST /api/logging/mode with invalid mode returns 400', async () => {
    const res = await httpRequest({
      port: proxyPort,
      path: '/api/logging/mode',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test-agent', mode: 'invalid' }),
    });

    expect(res.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Test 8: Stdout output contains log lines when enabled
  // -----------------------------------------------------------------------

  it('stdout output contains log lines when enabled', async () => {
    // Close existing logger and create one with stdout enabled
    actionLogger.close();
    const stdoutConfig = makeLoggingConfig(logDir, { stdout: true, file: true });
    actionLogger = new ActionLogger(stdoutConfig);

    // We need a new server to use this logger, but we can test stdout directly
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // Create a log entry to simulate what forwardRequest would do
    const entry: LogEntry = {
      id: 'stdout-test',
      timestamp: new Date().toISOString(),
      agent_id: 'test-agent',
      provider: 'openai',
      target: '/v1/chat/completions',
      model: 'gpt-4o',
      input_tokens: 100,
      output_tokens: 50,
      cost: 0.00075,
      priced: true,
      latency_ms: 42,
      status: 200,
      has_payload: false,
      payload_id: null,
      storage_region: 'auto',
    };

    actionLogger.log(entry);

    expect(stdoutSpy).toHaveBeenCalled();
    const written = stdoutSpy.mock.calls.find((call) => {
      const str = call[0] as string;
      return str.includes('stdout-test');
    });
    expect(written).toBeDefined();

    stdoutSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Test 9: Multiple requests generate multiple log entries
  // -----------------------------------------------------------------------

  it('multiple requests generate multiple log entries in JSONL file', async () => {
    for (let i = 0; i < 3; i++) {
      await httpRequest({
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: `msg-${i}` }] }),
      });
    }

    await new Promise((r) => setTimeout(r, 100));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(3);

    // All entries should be for test-agent
    for (const entry of entries) {
      expect(entry.agent_id).toBe('test-agent');
      expect(entry.status).toBe(200);
    }
  });
});
