import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import type { Policy } from './policy-types.js';

export const DEFAULT_POLICIES_FILE = './policies.yaml';
export const DEFAULT_POLICY_DOCUMENT = 'version: 1\npolicies: []\n';

export function policyToPlainObject(policy: Policy): Record<string, unknown> {
  const obj: Record<string, unknown> = { ...policy };
  const scope = policy.scope;
  obj.scope = scope.level === 'global' ? 'global' : `${scope.level}:${scope.value}`;
  return obj;
}

export function buildPolicyDocument(policies: Policy[]): string {
  if (policies.length === 0) {
    return DEFAULT_POLICY_DOCUMENT;
  }

  return stringify(
    {
      version: 1,
      policies: policies.map(policyToPlainObject),
    },
    { indent: 2 },
  );
}

export function policyToYaml(policy: Policy): string {
  return buildPolicyDocument([policy]);
}

export function ensurePolicyFile(
  filePath: string,
  existingPolicies: Policy[] = [],
): { created: boolean; path: string } {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Policy path is not a file: ${resolvedPath}`);
    }

    return { created: false, path: resolvedPath };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }

  try {
    fs.writeFileSync(
      resolvedPath,
      buildPolicyDocument(existingPolicies),
      { encoding: 'utf8', flag: 'wx' },
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      throw err;
    }
    return { created: false, path: resolvedPath };
  }

  return { created: true, path: resolvedPath };
}
