import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildPolicyDocument, ensurePolicyFile } from '../src/policy-file.js';
import type { Policy } from '../src/policy-types.js';

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
  cleanupPaths.length = 0;
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-policy-file-test-'));
  cleanupPaths.push(dir);
  return dir;
}

function makePolicy(name: string): Policy {
  return {
    name,
    type: 'block',
    description: `Policy ${name}`,
    scope: { level: 'global' },
    enabled: true,
    message: 'blocked',
  };
}

describe('ensurePolicyFile', () => {
  it('creates a missing policy file with an empty document by default', () => {
    const tempDir = makeTempDir();
    const filePath = path.join(tempDir, 'policies.yaml');

    const result = ensurePolicyFile(filePath);

    expect(result.created).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('version: 1\npolicies: []\n');
  });

  it('seeds a recreated policy file from existing in-memory policies', () => {
    const tempDir = makeTempDir();
    const filePath = path.join(tempDir, 'policies.yaml');
    const policy = makePolicy('baseline');

    const result = ensurePolicyFile(filePath, [policy]);

    expect(result.created).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(buildPolicyDocument([policy]));
  });

  it('does not overwrite an existing policy file', () => {
    const tempDir = makeTempDir();
    const filePath = path.join(tempDir, 'policies.yaml');
    fs.writeFileSync(filePath, 'version: 1\npolicies:\n  - name: existing\n', 'utf8');

    const result = ensurePolicyFile(filePath, [makePolicy('replacement')]);

    expect(result.created).toBe(false);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('version: 1\npolicies:\n  - name: existing\n');
  });
});
