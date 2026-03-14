/**
 * Tests for `govyn policy validate` CLI command.
 *
 * Spawns the CLI as a child process and verifies stdout/stderr output
 * and exit codes for various policy file scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

let tmpDir: string;

function writeTempFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Run the CLI command and capture output + exit code.
 * Returns { stdout, stderr, exitCode }.
 */
function runCli(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx src/cli.ts ${args}`, {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 15000,
      // Merge stderr into a separate pipe
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('govyn policy validate', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-cli-validate-'));
  });

  afterEach(() => {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  it('validates a valid policy file with exit code 0', () => {
    const filePath = writeTempFile('valid.yaml', `version: 1
policies:
  - name: block-all
    type: block
    scope: global
    enabled: true
    message: Blocked by policy
`);

    const result = runCli(`policy validate "${filePath}"`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Valid:');
    expect(result.stdout).toContain('1 policies found');
    expect(result.stdout).toContain('block-all');
    expect(result.stdout).toContain('block');
    expect(result.stdout).toContain('scope: global');
  });

  it('reports invalid YAML syntax with exit code 1', () => {
    const filePath = writeTempFile('bad-yaml.yaml', `version: 1
policies:
  - name: "unclosed string
    type: block
`);

    const result = runCli(`policy validate "${filePath}"`);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toMatch(/Invalid:|Error:/);
  });

  it('reports schema error with line number for missing type field', () => {
    const filePath = writeTempFile('no-type.yaml', `version: 1
policies:
  - name: missing-type
    scope: global
    enabled: true
`);

    const result = runCli(`policy validate "${filePath}"`);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Invalid:');
    expect(output).toContain('Error:');
    // Should reference the policy name
    expect(output).toContain('missing-type');
    // Should include a line number reference
    expect(output).toMatch(/line \d+/);
  });

  it('reports error for missing file with exit code 1', () => {
    const nonexistent = path.join(tmpDir, 'does-not-exist.yaml');

    const result = runCli(`policy validate "${nonexistent}"`);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('File not found');
  });

  it('reports usage error when no file argument provided', () => {
    const result = runCli('policy validate');
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Usage:');
  });

  it('treats option-first invocation as proxy start instead of unknown command', () => {
    const missingConfigPath = path.join(tmpDir, 'missing-config.yaml');

    const result = runCli(`--config "${missingConfigPath}"`);
    expect(result.exitCode).toBe(1);

    const output = result.stdout + result.stderr;
    expect(output).not.toContain('Unknown command: --config');
    expect(output).toContain('Failed to read config file');
  });

  it('validates multiple policies and shows summaries', () => {
    const filePath = writeTempFile('multi.yaml', `version: 1
policies:
  - name: rate-limiter
    type: rate_limit
    scope: agent:bot-1
    enabled: true
    limit: 100
    window_seconds: 60
  - name: global-block
    type: block
    scope: global
    enabled: true
`);

    const result = runCli(`policy validate "${filePath}"`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Valid:');
    expect(result.stdout).toContain('2 policies found');
    expect(result.stdout).toContain('rate-limiter');
    expect(result.stdout).toContain('rate_limit');
    expect(result.stdout).toContain('scope: agent');
    expect(result.stdout).toContain('global-block');
    expect(result.stdout).toContain('scope: global');
  });

  it('catches type-specific validation errors (invalid policy type)', () => {
    // content_filter with an invalid regex pattern is not caught by the parser
    // (the parser stores patterns as-is). Instead, test an invalid scope format
    // which the parser does validate at the type level.
    const filePath = writeTempFile('bad-type.yaml', `version: 1
policies:
  - name: bad-scope-policy
    type: block
    scope: "invalid::"
    enabled: true
`);

    const result = runCli(`policy validate "${filePath}"`);
    expect(result.exitCode).toBe(1);
    const output = result.stdout + result.stderr;
    expect(output).toContain('Invalid:');
    expect(output).toContain('Error:');
    expect(output).toContain('bad-scope-policy');
  });
});
