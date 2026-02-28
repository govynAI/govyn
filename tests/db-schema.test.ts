/**
 * Tests for database schema definitions (src/db-schema.ts) and
 * database-related config parsing (src/config.ts database section).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MIGRATIONS } from '../src/db-schema.js';
import { loadConfig } from '../src/config.js';

/** Write a temp YAML file and return its absolute path. */
function writeTempConfig(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `govyn-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

const cleanupFiles: string[] = [];

afterEach(() => {
  // Clean up env var overrides
  delete process.env['GOVYN_DATABASE_URL'];

  for (const f of cleanupFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  cleanupFiles.length = 0;
});

describe('MIGRATIONS', () => {
  it('has at least one migration', () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(1);
  });

  it('each migration has version, name, and sql fields', () => {
    for (const m of MIGRATIONS) {
      expect(typeof m.version).toBe('number');
      expect(typeof m.name).toBe('string');
      expect(m.name.length).toBeGreaterThan(0);
      expect(typeof m.sql).toBe('string');
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });

  it('migration versions are sequential starting from 1', () => {
    for (let i = 0; i < MIGRATIONS.length; i++) {
      expect(MIGRATIONS[i].version).toBe(i + 1);
    }
  });

  it('each migration SQL contains CREATE TABLE or CREATE INDEX', () => {
    for (const m of MIGRATIONS) {
      const upper = m.sql.toUpperCase();
      const hasCreate = upper.includes('CREATE TABLE') || upper.includes('CREATE INDEX');
      expect(hasCreate).toBe(true);
    }
  });

  it('initial migration creates all required tables', () => {
    const sql = MIGRATIONS[0].sql.toUpperCase();
    expect(sql).toContain('COST_RECORDS');
    expect(sql).toContain('POLICY_EVALUATIONS');
    expect(sql).toContain('APPROVAL_REQUESTS');
    expect(sql).toContain('COST_DAILY_SUMMARY');
    expect(sql).toContain('GOVYN_MIGRATIONS');
  });

  it('initial migration creates indexes for time-windowed queries', () => {
    const sql = MIGRATIONS[0].sql;
    expect(sql).toContain('idx_cost_records_agent_created');
    expect(sql).toContain('idx_cost_records_created');
    expect(sql).toContain('idx_policy_evals_agent_created');
    expect(sql).toContain('idx_daily_summary_agent_date');
  });
});

describe('config database section', () => {
  it('parses database section from YAML', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
database:
  url: postgres://user:pass@localhost:5432/govyn
  fail_open: false
  retention_days: 60
  approval_retention_days: 180
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeDefined();
    expect(config.database!.url).toBe('postgres://user:pass@localhost:5432/govyn');
    expect(config.database!.failOpen).toBe(false);
    expect(config.database!.retentionDays).toBe(60);
    expect(config.database!.approvalRetentionDays).toBe(180);
  });

  it('applies default values for optional database fields', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
database:
  url: postgres://localhost/govyn
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeDefined();
    expect(config.database!.failOpen).toBe(true);
    expect(config.database!.retentionDays).toBe(90);
    expect(config.database!.approvalRetentionDays).toBe(365);
  });

  it('GOVYN_DATABASE_URL env var overrides YAML url', () => {
    process.env['GOVYN_DATABASE_URL'] = 'postgres://env-override@localhost/govyn';

    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
database:
  url: postgres://yaml-url@localhost/govyn
  fail_open: false
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeDefined();
    expect(config.database!.url).toBe('postgres://env-override@localhost/govyn');
    // Other settings from YAML should still apply
    expect(config.database!.failOpen).toBe(false);
  });

  it('GOVYN_DATABASE_URL env var creates database config even without YAML section', () => {
    process.env['GOVYN_DATABASE_URL'] = 'postgres://env-only@localhost/govyn';

    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeDefined();
    expect(config.database!.url).toBe('postgres://env-only@localhost/govyn');
    expect(config.database!.failOpen).toBe(true);
    expect(config.database!.retentionDays).toBe(90);
  });

  it('missing database config results in undefined (no crash)', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeUndefined();
  });

  it('empty database url results in undefined config', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
database:
  url: ""
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.database).toBeUndefined();
  });
});
