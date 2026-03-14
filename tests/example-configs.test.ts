import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../src/config.js';

const exampleConfigs = [
  'configs/openai-only.yaml',
  'configs/multi-provider.yaml',
  'configs/team-setup.yaml',
];

describe('shipped example configs', () => {
  it.each(exampleConfigs)('loads %s with loopback-safe defaults', (relativePath) => {
    const config = loadConfig(path.resolve(relativePath));

    expect(config.host).toBe('127.0.0.1');
    expect(config.database).toBeDefined();
    expect(config.security!.requireAgentApiKey).toBe(false);
  });

  it.each(exampleConfigs)('does not default %s to a public bind or empty shipped api_keys', (relativePath) => {
    const source = fs.readFileSync(path.resolve(relativePath), 'utf8');

    expect(source).not.toMatch(/\bhost:\s*0\.0\.0\.0\b/);
    expect(source).not.toMatch(/\bapi_keys:\s*\[\s*\]/);
    expect(source).toMatch(/\bdatabase:\s*\n\s+url:\s*(sqlite:|postgres:\/\/|postgresql:\/\/)/);
  });
});
