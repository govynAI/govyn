/**
 * Integration tests for action logging through the proxy pipeline.
 *
 * Verifies JSONL log entries are written with correct fields, metadata vs
 * full-payload mode behavior, and runtime mode toggle via API.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { ActionLogger } from '../../src/action-logger.js';
import { loadPricing } from '../../src/pricing.js';
import type { ProxyConfig, LoggingConfig, LogEntry } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
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

function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const response = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
        const body = JSON.stringify(response);
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

function readLogEntries(logDir: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(logDir, file), 'utf8').trim();
    if (!content) continue;
    for (const line of content.split('\n')) {
      entries.push(JSON.parse(line) as LogEntry);
    }
  }
  return entries;
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('action logging integration (new)', () => {
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
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-intlog-new-'));
    aggregator = new CostAggregator();

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
    actionLogger = new ActionLogger(loggingConfig);

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'openai',
      }]]),
      agents: new Map([['test-agent', { name: 'test-agent', apiKeys: [] }]]),
      pricing: loadPricing(),
      budgets: new Map(),
    };

    proxyServer = startServer(config, aggregator, undefined, undefined, actionLogger);
    await waitForListen(proxyServer);
    proxyPort = (proxyServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    actionLogger.close();
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  // Test 1: 3 requests produce 3 log entries with correct fields
  it('3 requests produce 3 JSONL log entries with correct fields', async () => {
    for (let i = 0; i < 3; i++) {
      await httpRequest({
        port: proxyPort,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });
    }

    // Wait for flush (1.1s to account for 1s flush interval)
    await new Promise((r) => setTimeout(r, 1200));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(3);

    for (const entry of entries) {
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.agent_id).toBe('test-agent');
      expect(entry.provider).toBe('openai');
      expect(entry.status).toBe(200);
      expect(entry.latency_ms).toBeGreaterThanOrEqual(0);
      expect(entry.has_payload).toBe(false);
    }
  });

  // Test 2: Metadata mode has has_payload=false
  it('metadata mode entries have has_payload=false', async () => {
    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });

    await new Promise((r) => setTimeout(r, 100));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries[0]!.has_payload).toBe(false);
    expect(entries[0]!.payload_id).toBeNull();
  });

  // Test 3: Full-payload mode creates payload file after toggle
  it('full-payload mode creates payload file after mode toggle via API', async () => {
    // Toggle to full-payload
    await httpRequest({
      port: proxyPort,
      path: '/api/logging/mode',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent_id: 'test-agent', mode: 'full-payload' }),
    });

    await httpRequest({
      port: proxyPort,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });

    await new Promise((r) => setTimeout(r, 200));
    actionLogger.flush();

    const entries = readLogEntries(logDir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.has_payload).toBe(true);
    expect(entries[0]!.payload_id).not.toBeNull();

    const payloadPath = path.join(logDir, 'payloads', `${entries[0]!.payload_id}.json`);
    expect(fs.existsSync(payloadPath)).toBe(true);
  });
});
