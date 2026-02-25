/**
 * Unit tests for GDPR storage region configuration.
 *
 * Tests:
 * - Config parsing with storage_region: eu -> storageRegion: 'eu'
 * - Config parsing with storage_region: us -> storageRegion: 'us'
 * - Config parsing with no storage_region -> default 'auto'
 * - Config parsing with invalid storage_region -> error
 * - ActionLogger includes storage_region in every log entry
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { ActionLogger } from '../../src/action-logger.js';
import type { LogEntry, LoggingConfig } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-gdpr-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeYaml(dir: string, yaml: string): string {
  const filePath = path.join(dir, 'govyn.config.yaml');
  fs.writeFileSync(filePath, yaml, 'utf8');
  return filePath;
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
// Test suite: GDPR storage_region config parsing
// -----------------------------------------------------------------------

describe('GDPR config: storage_region parsing', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('parses storage_region: eu correctly', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: eu
`);
    const config = loadConfig(configPath);
    expect(config.logging).toBeDefined();
    expect(config.logging!.storageRegion).toBe('eu');
  });

  it('parses storage_region: us correctly', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: us
`);
    const config = loadConfig(configPath);
    expect(config.logging).toBeDefined();
    expect(config.logging!.storageRegion).toBe('us');
  });

  it('parses storage_region: auto correctly', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: auto
`);
    const config = loadConfig(configPath);
    expect(config.logging).toBeDefined();
    expect(config.logging!.storageRegion).toBe('auto');
  });

  it('defaults to auto when no storage_region is specified', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  enabled: true
`);
    const config = loadConfig(configPath);
    expect(config.logging).toBeDefined();
    expect(config.logging!.storageRegion).toBe('auto');
  });

  it('throws error for invalid storage_region value', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: mars
`);
    expect(() => loadConfig(configPath)).toThrow(/storage_region must be 'eu', 'us', or 'auto'/);
  });

  it('handles case-insensitive storage_region', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: EU
`);
    const config = loadConfig(configPath);
    expect(config.logging!.storageRegion).toBe('eu');
  });
});

// -----------------------------------------------------------------------
// Test suite: ActionLogger includes storage_region in log entries
// -----------------------------------------------------------------------

describe('GDPR config: ActionLogger storage_region in log entries', () => {
  let tmpDir: string;
  let logger: ActionLogger;

  afterEach(() => {
    if (logger) logger.close();
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('sets storage_region from config on every log entry', () => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeLoggingConfig(logDir, { storageRegion: 'eu' }));

    const entry = makeSampleEntry({ storage_region: undefined as any });
    logger.log(entry);

    // After log(), the entry should have storage_region set from config
    expect(entry.storage_region).toBe('eu');
  });

  it('preserves existing storage_region on entry if already set', () => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeLoggingConfig(logDir, { storageRegion: 'eu' }));

    const entry = makeSampleEntry({ storage_region: 'us' });
    logger.log(entry);

    // Existing value should be preserved
    expect(entry.storage_region).toBe('us');
  });

  it('writes storage_region to JSONL file', () => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeLoggingConfig(logDir, { storageRegion: 'eu', stdout: false }));

    // Pass entry without storage_region so logger fills it from config
    const entry = makeSampleEntry({ storage_region: undefined as any });
    logger.log(entry);
    logger.flush();

    const filePath = logger.getCurrentFilePath();
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.storage_region).toBe('eu');
  });

  it('default config produces storage_region: auto in log entries', () => {
    tmpDir = makeTempDir();
    const logDir = path.join(tmpDir, 'logs');
    logger = new ActionLogger(makeLoggingConfig(logDir));

    const entry = makeSampleEntry({ storage_region: undefined as any });
    logger.log(entry);

    expect(entry.storage_region).toBe('auto');
  });
});
