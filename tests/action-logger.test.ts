/**
 * Unit tests for the ActionLogger class (src/action-logger.ts).
 *
 * Verifies structured JSONL logging, payload file storage, mode management,
 * buffered flush, dual stdout+file output, and config defaults.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { ActionLogger } from '../src/action-logger.js';
import type { LogEntry, LoggingConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Create a temporary directory for test isolation */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-test-'));
}

/** Remove a temporary directory and all its contents */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a default LoggingConfig pointing at the given directory */
function makeConfig(dir: string, overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    enabled: true,
    directory: dir,
    defaultMode: 'metadata',
    stdout: true,
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

/** Build a sample LogEntry */
function makeSampleEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: crypto.randomUUID(),
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
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Test suite: Constructor and directory creation
// -----------------------------------------------------------------------

describe('ActionLogger: constructor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('creates log directory and payloads subdirectory', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir);
    const logger = new ActionLogger(config);

    expect(fs.existsSync(logDir)).toBe(true);
    expect(fs.existsSync(path.join(logDir, 'payloads'))).toBe(true);

    logger.close();
  });

  it('sets current file path with date-based name', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir);
    const logger = new ActionLogger(config);

    const filePath = logger.getCurrentFilePath();
    const dateStr = new Date().toISOString().slice(0, 10);
    expect(filePath).toContain(`govyn-${dateStr}.jsonl`);

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: log() method
// -----------------------------------------------------------------------

describe('ActionLogger: log()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('writes entry to stdout when stdout=true', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: true, file: false });
    const logger = new ActionLogger(config);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const entry = makeSampleEntry();
    logger.log(entry);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = stdoutSpy.mock.calls[0]![0] as string;
    expect(written).toContain(entry.id);
    expect(written.endsWith('\n')).toBe(true);

    // Verify it's valid JSON
    const parsed = JSON.parse(written.trim());
    expect(parsed.id).toBe(entry.id);

    stdoutSpy.mockRestore();
    logger.close();
  });

  it('does NOT write to stdout when stdout=false', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: false });
    const logger = new ActionLogger(config);

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const entry = makeSampleEntry();
    logger.log(entry);

    expect(stdoutSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
    logger.close();
  });

  it('buffers entry for file when file=true', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: true });
    const logger = new ActionLogger(config);

    const entry = makeSampleEntry();
    logger.log(entry);

    // Before flush, no file content yet (buffered)
    const filePath = logger.getCurrentFilePath();
    const exists = fs.existsSync(filePath);
    // File may not exist yet since it hasn't been flushed
    if (exists) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Content should be empty since we haven't flushed
      expect(content).toBe('');
    }

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: flush() method
// -----------------------------------------------------------------------

describe('ActionLogger: flush()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('writes buffered entries to JSONL file as valid JSON lines', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: true });
    const logger = new ActionLogger(config);

    const entry1 = makeSampleEntry({ id: 'entry-1' });
    const entry2 = makeSampleEntry({ id: 'entry-2' });
    logger.log(entry1);
    logger.log(entry2);

    logger.flush();

    const filePath = logger.getCurrentFilePath();
    const content = fs.readFileSync(filePath, 'utf8').trim();
    const lines = content.split('\n');

    expect(lines.length).toBe(2);

    const parsed1 = JSON.parse(lines[0]!);
    const parsed2 = JSON.parse(lines[1]!);
    expect(parsed1.id).toBe('entry-1');
    expect(parsed2.id).toBe('entry-2');

    logger.close();
  });

  it('clears buffer after flush', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: true });
    const logger = new ActionLogger(config);

    const entry = makeSampleEntry();
    logger.log(entry);
    logger.flush();

    // Second flush should not add more lines
    logger.flush();

    const filePath = logger.getCurrentFilePath();
    const content = fs.readFileSync(filePath, 'utf8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBe(1);

    logger.close();
  });

  it('does nothing when buffer is empty', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: true });
    const logger = new ActionLogger(config);

    // Flush with no entries should not create a file
    logger.flush();

    const filePath = logger.getCurrentFilePath();
    expect(fs.existsSync(filePath)).toBe(false);

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: storePayload()
// -----------------------------------------------------------------------

describe('ActionLogger: storePayload()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('creates payload JSON file in payloads directory', async () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir);
    const logger = new ActionLogger(config);

    const payloadId = 'test-payload-001';
    const reqBody = Buffer.from('{"prompt":"hello"}');
    const resBody = Buffer.from('{"response":"world"}');

    logger.storePayload(payloadId, reqBody, resBody, false);

    // Wait for async write to complete
    await new Promise((r) => setTimeout(r, 50));

    const payloadPath = path.join(logDir, 'payloads', `${payloadId}.json`);
    expect(fs.existsSync(payloadPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    expect(payload.request_body).toBe(reqBody.toString('base64'));
    expect(payload.response_body).toBe(resBody.toString('base64'));
    expect(payload.truncated).toBe(false);
    expect(payload.stored_at).toBeDefined();

    logger.close();
  });

  it('truncates bodies exceeding maxBodySize', async () => {
    const logDir = path.join(tmpDir, 'logs');
    const maxSize = 50;
    const config = makeConfig(logDir, { maxBodySize: maxSize });
    const logger = new ActionLogger(config);

    const payloadId = 'test-payload-truncated';
    const largeBody = Buffer.alloc(100, 'A');

    logger.storePayload(payloadId, largeBody, null, false);

    await new Promise((r) => setTimeout(r, 50));

    const payloadPath = path.join(logDir, 'payloads', `${payloadId}.json`);
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

    // The stored body should be truncated to maxSize
    const storedReqBody = Buffer.from(payload.request_body, 'base64');
    expect(storedReqBody.length).toBe(maxSize);
    expect(payload.truncated).toBe(true);
    expect(payload.response_body).toBeNull();

    logger.close();
  });

  it('handles null request and response bodies', async () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir);
    const logger = new ActionLogger(config);

    const payloadId = 'test-payload-null';
    logger.storePayload(payloadId, null, null, false);

    await new Promise((r) => setTimeout(r, 50));

    const payloadPath = path.join(logDir, 'payloads', `${payloadId}.json`);
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    expect(payload.request_body).toBeNull();
    expect(payload.response_body).toBeNull();
    expect(payload.truncated).toBe(false);

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: getMode() and setMode()
// -----------------------------------------------------------------------

describe('ActionLogger: getMode() and setMode()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('returns default mode when no agent override', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { defaultMode: 'metadata' });
    const logger = new ActionLogger(config);

    expect(logger.getMode('any-agent')).toBe('metadata');

    logger.close();
  });

  it('returns agent-specific mode when override set', () => {
    const logDir = path.join(tmpDir, 'logs');
    const agentModes = new Map<string, 'metadata' | 'full-payload'>([
      ['debug-agent', 'full-payload'],
    ]);
    const config = makeConfig(logDir, { defaultMode: 'metadata', agentModes });
    const logger = new ActionLogger(config);

    expect(logger.getMode('debug-agent')).toBe('full-payload');
    expect(logger.getMode('other-agent')).toBe('metadata');

    logger.close();
  });

  it('setMode() changes mode at runtime', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { defaultMode: 'metadata' });
    const logger = new ActionLogger(config);

    expect(logger.getMode('my-agent')).toBe('metadata');

    logger.setMode('my-agent', 'full-payload');
    expect(logger.getMode('my-agent')).toBe('full-payload');

    logger.setMode('my-agent', 'metadata');
    expect(logger.getMode('my-agent')).toBe('metadata');

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: close()
// -----------------------------------------------------------------------

describe('ActionLogger: close()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('flushes remaining buffer on close', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir, { stdout: false, file: true });
    const logger = new ActionLogger(config);

    const entry = makeSampleEntry({ id: 'close-test' });
    logger.log(entry);

    // Close should flush
    logger.close();

    const filePath = logger.getCurrentFilePath();
    const content = fs.readFileSync(filePath, 'utf8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe('close-test');
  });
});

// -----------------------------------------------------------------------
// Test suite: Config defaults
// -----------------------------------------------------------------------

describe('ActionLogger: config defaults', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('config values are accessible and correct', () => {
    const logDir = path.join(tmpDir, 'logs');
    const config = makeConfig(logDir);
    const logger = new ActionLogger(config);

    expect(logger.config.enabled).toBe(true);
    expect(logger.config.directory).toBe(logDir);
    expect(logger.config.defaultMode).toBe('metadata');
    expect(logger.config.stdout).toBe(true);
    expect(logger.config.file).toBe(true);
    expect(logger.config.maxBodySize).toBe(1048576);
    expect(logger.config.rotationMaxSizeMb).toBe(50);
    expect(logger.config.rotationIntervalHours).toBe(24);
    expect(logger.config.retentionDays).toBe(30);
    expect(logger.config.payloadRetentionDays).toBe(7);
    expect(logger.config.agentModes.size).toBe(0);

    logger.close();
  });
});

// -----------------------------------------------------------------------
// Test suite: generateId()
// -----------------------------------------------------------------------

describe('ActionLogger: generateId()', () => {
  it('generates unique UUID strings', () => {
    const id1 = ActionLogger.generateId();
    const id2 = ActionLogger.generateId();

    expect(typeof id1).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id1).not.toBe(id2);
    // UUID v4 format
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
