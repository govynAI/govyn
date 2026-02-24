/**
 * Tests for YAML configuration loader (src/config.ts).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../src/config.js';

/** Write a temp YAML file and return its absolute path. */
function writeTempConfig(content: string): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `govyn-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

const cleanupFiles: string[] = [];

afterEach(() => {
  for (const f of cleanupFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
  cleanupFiles.length = 0;
});

describe('loadConfig', () => {
  it('loads a valid minimal YAML config', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
  host: 127.0.0.1
providers:
  openai:
    base_url: https://api.openai.com
    api_key_env: OPENAI_API_KEY
  anthropic:
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
  custom: {}
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    expect(config.port).toBe(4000);
    expect(config.host).toBe('127.0.0.1');
    expect(config.providers.size).toBeGreaterThanOrEqual(2);
  });

  it('creates openai provider with correct fields', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 3000
providers:
  openai:
    base_url: https://api.openai.com
    api_key_env: OPENAI_API_KEY
  custom: {}
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);
    const openai = config.providers.get('openai');

    expect(openai).toBeDefined();
    expect(openai!.name).toBe('openai');
    expect(openai!.baseUrl).toBe('https://api.openai.com');
    expect(openai!.apiKeyEnv).toBe('OPENAI_API_KEY');
    expect(openai!.providerType).toBe('openai');
  });

  it('creates anthropic provider with correct fields', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 3000
providers:
  anthropic:
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
  custom: {}
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);
    const anthropic = config.providers.get('anthropic');

    expect(anthropic).toBeDefined();
    expect(anthropic!.name).toBe('anthropic');
    expect(anthropic!.baseUrl).toBe('https://api.anthropic.com');
    expect(anthropic!.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(anthropic!.providerType).toBe('anthropic');
  });

  it('parses custom providers correctly', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
providers:
  custom:
    my-llm:
      base_url: https://my-llm.example.com
      api_key_env: MY_LLM_API_KEY
    another:
      base_url: https://another.example.com
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);

    const myLlm = config.providers.get('my-llm');
    expect(myLlm).toBeDefined();
    expect(myLlm!.name).toBe('my-llm');
    expect(myLlm!.baseUrl).toBe('https://my-llm.example.com');
    expect(myLlm!.apiKeyEnv).toBe('MY_LLM_API_KEY');
    expect(myLlm!.providerType).toBe('custom');

    const another = config.providers.get('another');
    expect(another).toBeDefined();
    expect(another!.name).toBe('another');
    expect(another!.baseUrl).toBe('https://another.example.com');
    expect(another!.apiKeyEnv).toBeNull();
    expect(another!.providerType).toBe('custom');
  });

  it('throws with file path in error when file not found', () => {
    const fakePath = '/absolutely/nonexistent/govyn-test-config-99999.yaml';

    // The error must contain the filename portion (works cross-platform — Windows
    // converts the Unix path to an absolute Windows path, but the filename is preserved)
    expect(() => loadConfig(fakePath)).toThrow('govyn-test-config-99999.yaml');
  });

  it('throws when version field is missing', () => {
    const filePath = writeTempConfig(`
proxy:
  port: 4000
`);
    cleanupFiles.push(filePath);

    expect(() => loadConfig(filePath)).toThrow(/version/i);
  });

  it('throws when proxy section is missing', () => {
    const filePath = writeTempConfig(`
version: 1
`);
    cleanupFiles.push(filePath);

    expect(() => loadConfig(filePath)).toThrow(/proxy/i);
  });

  it('throws when proxy.port is missing', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  host: 0.0.0.0
`);
    cleanupFiles.push(filePath);

    expect(() => loadConfig(filePath)).toThrow(/port/i);
  });

  it('defaults host to 0.0.0.0 when not specified', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 5000
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);
    expect(config.host).toBe('0.0.0.0');
  });

  it('works with empty custom section', () => {
    const filePath = writeTempConfig(`
version: 1
proxy:
  port: 4000
providers:
  custom: {}
`);
    cleanupFiles.push(filePath);

    const config = loadConfig(filePath);
    expect(config.port).toBe(4000);
  });
});
