/**
 * Unit tests for the LogRotator class (src/log-rotator.ts).
 *
 * Verifies size-based and time-based rotation triggers, gzip compression,
 * retention cleanup for log files and payload files, and interval management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as zlib from 'node:zlib';
import { LogRotator } from '../src/log-rotator.js';
import type { LoggingConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Create a temporary directory for test isolation */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-rotator-test-'));
}

/** Remove a temporary directory and all its contents */
function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Build a LoggingConfig pointing at the given directory */
function makeConfig(dir: string, overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    enabled: true,
    directory: dir,
    defaultMode: 'metadata',
    stdout: false,
    file: true,
    maxBodySize: 1048576,
    rotationMaxSizeMb: 1,        // 1 MB for easy testing
    rotationIntervalHours: 24,
    retentionDays: 30,
    payloadRetentionDays: 7,
    agentModes: new Map(),
    storageRegion: 'auto',
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Test suite: checkRotation()
// -----------------------------------------------------------------------

describe('LogRotator: checkRotation()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('returns shouldRotate=false for a small, new file', () => {
    const config = makeConfig(tmpDir, { rotationMaxSizeMb: 1, rotationIntervalHours: 24 });
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    fs.writeFileSync(filePath, '{"test":"entry"}\n');

    const result = rotator.checkRotation(filePath);
    expect(result.shouldRotate).toBe(false);
    expect(result.reason).toBeNull();

    rotator.stop();
  });

  it('returns shouldRotate=true with reason=size when file exceeds max size', () => {
    const config = makeConfig(tmpDir, { rotationMaxSizeMb: 0.001 }); // ~1 KB
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    // Write more than 1 KB
    const largeContent = 'x'.repeat(2000) + '\n';
    fs.writeFileSync(filePath, largeContent);

    const result = rotator.checkRotation(filePath);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).toBe('size');

    rotator.stop();
  });

  it('returns shouldRotate=true with reason=time when file is older than interval', () => {
    const config = makeConfig(tmpDir, { rotationIntervalHours: 0.0001 }); // ~0.36 seconds
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    fs.writeFileSync(filePath, '{"test":"entry"}\n');

    // Set mtime to 2 hours ago so it's definitely older than 0.36 seconds
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

    const result = rotator.checkRotation(filePath);
    expect(result.shouldRotate).toBe(true);
    expect(result.reason).toBe('time');

    rotator.stop();
  });

  it('returns shouldRotate=false for a non-existent file', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    const result = rotator.checkRotation(path.join(tmpDir, 'does-not-exist.jsonl'));
    expect(result.shouldRotate).toBe(false);
    expect(result.reason).toBeNull();

    rotator.stop();
  });
});

// -----------------------------------------------------------------------
// Test suite: rotate()
// -----------------------------------------------------------------------

describe('LogRotator: rotate()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('creates a .jsonl.gz file and removes the original', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    const content = '{"id":"entry-1"}\n{"id":"entry-2"}\n';
    fs.writeFileSync(filePath, content);

    rotator.rotate(filePath);

    // Original should be gone
    expect(fs.existsSync(filePath)).toBe(false);

    // A .jsonl.gz file should exist
    const files = fs.readdirSync(tmpDir);
    const gzFiles = files.filter((f) => f.endsWith('.jsonl.gz'));
    expect(gzFiles.length).toBe(1);
    expect(gzFiles[0]).toMatch(/^govyn-\d{4}-\d{2}-\d{2}-\d{6}\.jsonl\.gz$/);

    rotator.stop();
  });

  it('output is valid gzip that decompresses to original content', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    const content = '{"id":"entry-1","agent":"test"}\n{"id":"entry-2","agent":"test"}\n';
    fs.writeFileSync(filePath, content);

    rotator.rotate(filePath);

    // Read the gzip file and decompress
    const files = fs.readdirSync(tmpDir);
    const gzFile = files.find((f) => f.endsWith('.jsonl.gz'))!;
    const gzPath = path.join(tmpDir, gzFile);
    const compressed = fs.readFileSync(gzPath);
    const decompressed = zlib.gunzipSync(compressed).toString('utf8');

    expect(decompressed).toBe(content);

    rotator.stop();
  });

  it('returns the path for a fresh log file', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    const filePath = path.join(tmpDir, 'govyn-2026-02-25.jsonl');
    fs.writeFileSync(filePath, '{"test":true}\n');

    const freshPath = rotator.rotate(filePath);
    const dateStr = new Date().toISOString().slice(0, 10);
    expect(freshPath).toContain(`govyn-${dateStr}.jsonl`);
    expect(freshPath).not.toContain('.gz');

    rotator.stop();
  });
});

// -----------------------------------------------------------------------
// Test suite: cleanupExpired()
// -----------------------------------------------------------------------

describe('LogRotator: cleanupExpired()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    // Create payloads subdirectory
    fs.mkdirSync(path.join(tmpDir, 'payloads'), { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('deletes log files older than retentionDays', () => {
    const config = makeConfig(tmpDir, { retentionDays: 1 });
    const rotator = new LogRotator(config);

    // Create an old rotated log file
    const oldFile = path.join(tmpDir, 'govyn-2025-01-01-120000.jsonl.gz');
    fs.writeFileSync(oldFile, zlib.gzipSync('old data'));

    // Set mtime to 3 days ago
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(oldFile, threeDaysAgo, threeDaysAgo);

    rotator.cleanupExpired();

    expect(fs.existsSync(oldFile)).toBe(false);

    rotator.stop();
  });

  it('deletes payload files older than payloadRetentionDays', () => {
    const config = makeConfig(tmpDir, { payloadRetentionDays: 1 });
    const rotator = new LogRotator(config);

    // Create an old payload file
    const oldPayload = path.join(tmpDir, 'payloads', 'old-payload.json');
    fs.writeFileSync(oldPayload, '{"request_body":null}');

    // Set mtime to 3 days ago
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(oldPayload, threeDaysAgo, threeDaysAgo);

    rotator.cleanupExpired();

    expect(fs.existsSync(oldPayload)).toBe(false);

    rotator.stop();
  });

  it('keeps files within retention period', () => {
    const config = makeConfig(tmpDir, { retentionDays: 30, payloadRetentionDays: 7 });
    const rotator = new LogRotator(config);

    // Create recent files
    const recentLog = path.join(tmpDir, 'govyn-2026-02-25-120000.jsonl.gz');
    fs.writeFileSync(recentLog, zlib.gzipSync('recent data'));

    const recentPayload = path.join(tmpDir, 'payloads', 'recent-payload.json');
    fs.writeFileSync(recentPayload, '{"request_body":null}');

    rotator.cleanupExpired();

    expect(fs.existsSync(recentLog)).toBe(true);
    expect(fs.existsSync(recentPayload)).toBe(true);

    rotator.stop();
  });

  it('handles empty directories gracefully', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    // Should not throw with empty directories
    expect(() => rotator.cleanupExpired()).not.toThrow();

    rotator.stop();
  });

  it('handles missing payloads directory gracefully', () => {
    // Remove the payloads directory we created in beforeEach
    fs.rmSync(path.join(tmpDir, 'payloads'), { recursive: true, force: true });

    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    expect(() => rotator.cleanupExpired()).not.toThrow();

    rotator.stop();
  });
});

// -----------------------------------------------------------------------
// Test suite: stop()
// -----------------------------------------------------------------------

describe('LogRotator: stop()', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
  });

  it('clears the cleanup interval', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    rotator.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

    clearIntervalSpy.mockRestore();
  });

  it('is safe to call multiple times', () => {
    const config = makeConfig(tmpDir);
    const rotator = new LogRotator(config);

    // Should not throw on double stop
    rotator.stop();
    rotator.stop();
  });
});
