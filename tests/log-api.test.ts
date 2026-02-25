/**
 * Unit tests for the log query API (src/log-api.ts).
 *
 * Verifies filtering by agent, status, time range, model, provider;
 * cursor-based pagination; individual entry retrieval; payload retrieval;
 * and error handling for missing entries and 405 method responses.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';
import { handleLogApi } from '../src/log-api.js';
import { ActionLogger } from '../src/action-logger.js';
import type { LogEntry, LoggingConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Create a temporary directory for test isolation */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-logapi-test-'));
}

/** Remove a temporary directory and all its contents */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a LoggingConfig pointing at the given directory */
function makeConfig(dir: string): LoggingConfig {
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
  };
}

/** Build sample log entries */
function makeSampleEntries(): LogEntry[] {
  return [
    {
      id: 'entry-001',
      timestamp: '2026-06-15T10:00:00.000Z',
      agent_id: 'agent-alpha',
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
    },
    {
      id: 'entry-002',
      timestamp: '2026-06-15T10:05:00.000Z',
      agent_id: 'agent-beta',
      provider: 'anthropic',
      target: '/v1/messages',
      model: 'claude-sonnet-4-20250514',
      input_tokens: 200,
      output_tokens: 100,
      cost: 0.0024,
      priced: true,
      latency_ms: 85,
      status: 200,
      has_payload: true,
      payload_id: 'payload-002',
      storage_region: 'auto',
    },
    {
      id: 'entry-003',
      timestamp: '2026-06-15T10:10:00.000Z',
      agent_id: 'agent-alpha',
      provider: 'openai',
      target: '/v1/chat/completions',
      model: 'gpt-4o',
      input_tokens: 150,
      output_tokens: 75,
      cost: 0.001125,
      priced: true,
      latency_ms: 55,
      status: 429,
      has_payload: false,
      payload_id: null,
      storage_region: 'auto',
    },
    {
      id: 'entry-004',
      timestamp: '2026-06-15T10:15:00.000Z',
      agent_id: 'agent-gamma',
      provider: 'anthropic',
      target: '/v1/messages',
      model: 'claude-sonnet-4-20250514',
      input_tokens: 300,
      output_tokens: 150,
      cost: 0.0036,
      priced: true,
      latency_ms: 120,
      status: 200,
      has_payload: true,
      payload_id: 'payload-004',
      storage_region: 'auto',
    },
    {
      id: 'entry-005',
      timestamp: '2026-06-15T10:20:00.000Z',
      agent_id: 'agent-alpha',
      provider: 'openai',
      target: '/v1/chat/completions',
      model: 'gpt-4o-mini',
      input_tokens: 50,
      output_tokens: 25,
      cost: 0.0001,
      priced: true,
      latency_ms: 30,
      status: 200,
      has_payload: false,
      payload_id: null,
      storage_region: 'auto',
    },
  ];
}

/**
 * Create a mock HTTP request for testing handleLogApi.
 */
function createMockReq(url: string, method = 'GET'): http.IncomingMessage {
  const req = new http.IncomingMessage(null as any);
  req.url = url;
  req.method = method;
  return req;
}

/**
 * Create a mock HTTP response that captures the written output.
 * Returns an object with the response mock and a promise that resolves when the response ends.
 */
function createMockRes(): {
  res: http.ServerResponse;
  getResult: () => Promise<{ statusCode: number; body: any; headers: Record<string, string> }>;
} {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let endResolve: (value: any) => void;
  const endPromise = new Promise<{ statusCode: number; body: any; headers: Record<string, string> }>(
    (resolve) => {
      endResolve = resolve;
    },
  );

  const res = {
    writeHead(code: number, hdrs: Record<string, string>) {
      statusCode = code;
      headers = hdrs;
    },
    end(data?: string | Buffer) {
      if (data) {
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
      const bodyStr = Buffer.concat(chunks).toString('utf8');
      let body: any;
      try {
        body = JSON.parse(bodyStr);
      } catch {
        body = bodyStr;
      }
      endResolve!({ statusCode, body, headers });
    },
    write(data: string | Buffer) {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      return true;
    },
  } as unknown as http.ServerResponse;

  return { res, getResult: () => endPromise };
}

// -----------------------------------------------------------------------
// Test suite: GET /api/logs — list with filters
// -----------------------------------------------------------------------

describe('Log API: GET /api/logs', () => {
  let tmpDir: string;
  let logger: ActionLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeConfig(logDir));

    // Write sample entries to a JSONL file
    const entries = makeSampleEntries();
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(logger.getCurrentFilePath(), lines, 'utf8');
  });

  afterEach(() => {
    logger.close();
    cleanupTempDir(tmpDir);
  });

  it('returns all entries with no filters', async () => {
    const req = createMockReq('/api/logs');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(5);
    expect(result.body.has_more).toBe(false);
    expect(result.body.cursor).toBeNull();
  });

  it('filters by agent_id', async () => {
    const req = createMockReq('/api/logs?agent=agent-alpha');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(3);
    for (const entry of result.body.entries) {
      expect(entry.agent_id).toBe('agent-alpha');
    }
  });

  it('filters by status code', async () => {
    const req = createMockReq('/api/logs?status=429');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(1);
    expect(result.body.entries[0].status).toBe(429);
    expect(result.body.entries[0].id).toBe('entry-003');
  });

  it('filters by time range', async () => {
    const req = createMockReq('/api/logs?start=2026-06-15T10:05:00.000Z&end=2026-06-15T10:15:00.000Z');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(3);
    // entries 002, 003, 004 are within the time range
    const ids = result.body.entries.map((e: LogEntry) => e.id);
    expect(ids).toContain('entry-002');
    expect(ids).toContain('entry-003');
    expect(ids).toContain('entry-004');
  });

  it('filters by model', async () => {
    const req = createMockReq('/api/logs?model=gpt-4o-mini');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(1);
    expect(result.body.entries[0].model).toBe('gpt-4o-mini');
  });

  it('filters by provider', async () => {
    const req = createMockReq('/api/logs?provider=anthropic');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(2);
    for (const entry of result.body.entries) {
      expect(entry.provider).toBe('anthropic');
    }
  });

  it('returns paginated results with limit=2 and cursor', async () => {
    const req = createMockReq('/api/logs?limit=2');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(2);
    expect(result.body.has_more).toBe(true);
    expect(result.body.cursor).toBeTruthy();
  });

  it('cursor-based pagination fetches next page correctly', async () => {
    // First page
    const req1 = createMockReq('/api/logs?limit=2');
    const { res: res1, getResult: getResult1 } = createMockRes();

    handleLogApi(req1, res1, logger);
    const result1 = await getResult1();

    expect(result1.body.entries.length).toBe(2);
    expect(result1.body.has_more).toBe(true);
    const cursor = result1.body.cursor;

    // Second page using cursor
    const req2 = createMockReq(`/api/logs?limit=2&cursor=${cursor}`);
    const { res: res2, getResult: getResult2 } = createMockRes();

    handleLogApi(req2, res2, logger);
    const result2 = await getResult2();

    expect(result2.body.entries.length).toBe(2);
    expect(result2.body.has_more).toBe(true);

    // Third page
    const cursor2 = result2.body.cursor;
    const req3 = createMockReq(`/api/logs?limit=2&cursor=${cursor2}`);
    const { res: res3, getResult: getResult3 } = createMockRes();

    handleLogApi(req3, res3, logger);
    const result3 = await getResult3();

    expect(result3.body.entries.length).toBe(1);
    expect(result3.body.has_more).toBe(false);

    // All 5 entries should be present across the pages
    const allIds = [
      ...result1.body.entries.map((e: LogEntry) => e.id),
      ...result2.body.entries.map((e: LogEntry) => e.id),
      ...result3.body.entries.map((e: LogEntry) => e.id),
    ];
    expect(allIds.length).toBe(5);
    expect(new Set(allIds).size).toBe(5);
  });

  it('combines multiple filters correctly (agent + status)', async () => {
    const req = createMockReq('/api/logs?agent=agent-alpha&status=200');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    // agent-alpha has entries 001 (200), 003 (429), 005 (200) — only 001 and 005 match
    expect(result.body.entries.length).toBe(2);
    for (const entry of result.body.entries) {
      expect(entry.agent_id).toBe('agent-alpha');
      expect(entry.status).toBe(200);
    }
  });

  it('returns empty results for non-matching filter', async () => {
    const req = createMockReq('/api/logs?agent=non-existent-agent');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.entries.length).toBe(0);
    expect(result.body.has_more).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Test suite: GET /api/logs/:id
// -----------------------------------------------------------------------

describe('Log API: GET /api/logs/:id', () => {
  let tmpDir: string;
  let logger: ActionLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeConfig(logDir));

    const entries = makeSampleEntries();
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(logger.getCurrentFilePath(), lines, 'utf8');
  });

  afterEach(() => {
    logger.close();
    cleanupTempDir(tmpDir);
  });

  it('returns a specific entry by ID', async () => {
    const req = createMockReq('/api/logs/entry-003');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.id).toBe('entry-003');
    expect(result.body.agent_id).toBe('agent-alpha');
    expect(result.body.status).toBe(429);
  });

  it('returns 404 for unknown ID', async () => {
    const req = createMockReq('/api/logs/unknown-id');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe('log_entry_not_found');
  });
});

// -----------------------------------------------------------------------
// Test suite: GET /api/logs/:id/payload
// -----------------------------------------------------------------------

describe('Log API: GET /api/logs/:id/payload', () => {
  let tmpDir: string;
  let logger: ActionLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeConfig(logDir));

    const entries = makeSampleEntries();
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(logger.getCurrentFilePath(), lines, 'utf8');

    // Create a payload file for entry-002
    const payloadDir = path.join(logDir, 'payloads');
    const payloadContent = {
      request_body: Buffer.from('{"prompt":"hello"}').toString('base64'),
      response_body: Buffer.from('{"response":"world"}').toString('base64'),
      truncated: false,
      stored_at: '2026-06-15T10:05:00.000Z',
    };
    fs.writeFileSync(
      path.join(payloadDir, 'payload-002.json'),
      JSON.stringify(payloadContent),
      'utf8',
    );
  });

  afterEach(() => {
    logger.close();
    cleanupTempDir(tmpDir);
  });

  it('returns stored payload content', async () => {
    const req = createMockReq('/api/logs/entry-002/payload');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(200);
    expect(result.body.request_body).toBe(Buffer.from('{"prompt":"hello"}').toString('base64'));
    expect(result.body.response_body).toBe(Buffer.from('{"response":"world"}').toString('base64'));
    expect(result.body.truncated).toBe(false);
  });

  it('returns 404 when has_payload is false', async () => {
    const req = createMockReq('/api/logs/entry-001/payload');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe('no_payload');
    expect(result.body.error.message).toBe('No payload stored for this log entry');
  });

  it('returns 404 when payload file was cleaned up (missing from disk)', async () => {
    // entry-004 has has_payload=true and payload_id=payload-004
    // but we did NOT create the file — simulates retention cleanup
    const req = createMockReq('/api/logs/entry-004/payload');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe('payload_expired');
  });

  it('returns 404 for unknown log entry ID', async () => {
    const req = createMockReq('/api/logs/non-existent/payload');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(404);
    expect(result.body.error.code).toBe('log_entry_not_found');
  });
});

// -----------------------------------------------------------------------
// Test suite: Method not allowed
// -----------------------------------------------------------------------

describe('Log API: Method not allowed', () => {
  let tmpDir: string;
  let logger: ActionLogger;

  beforeEach(() => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeConfig(logDir));
  });

  afterEach(() => {
    logger.close();
    cleanupTempDir(tmpDir);
  });

  it('returns 405 for POST method', async () => {
    const req = createMockReq('/api/logs', 'POST');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(405);
    expect(result.body.error.code).toBe('method_not_allowed');
  });

  it('returns 405 for PUT method', async () => {
    const req = createMockReq('/api/logs', 'PUT');
    const { res, getResult } = createMockRes();

    handleLogApi(req, res, logger);

    const result = await getResult();
    expect(result.statusCode).toBe(405);
  });
});
