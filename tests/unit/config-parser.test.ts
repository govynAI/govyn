/**
 * Unit tests for loadConfig() from src/config.ts.
 *
 * Verifies config loading, YAML parsing, validation, defaults, and
 * edge cases (missing file, invalid YAML, missing fields, custom providers,
 * budgets, logging, env var references).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from '../../src/config.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

let tmpDir: string;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-config-test-'));
}

function writeConfig(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// -----------------------------------------------------------------------
// Setup / Teardown
// -----------------------------------------------------------------------

beforeEach(() => {
  tmpDir = makeTempDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('loadConfig()', () => {
  // Test 1: Valid config file — all fields parsed correctly
  it('parses a valid config file with all fields correctly', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
  host: "0.0.0.0"
providers:
  openai:
    base_url: "https://api.openai.com"
    api_key_env: "MY_OPENAI_KEY"
  anthropic:
    base_url: "https://api.anthropic.com"
    api_key_env: "MY_ANTHROPIC_KEY"
agents:
  research-bot:
    api_keys:
      - "govyn-key-research"
  sales-bot: null
pricing:
  custom-model:
    input: 5.0
    output: 20.0
budgets:
  research-bot:
    daily_limit: 10.0
    monthly_limit: 100.0
    limit_type: hard
    soft_warning_percent: 80
logging:
  enabled: true
  directory: "./test-logs"
  default_mode: "full-payload"
  stdout: false
  file: true
  max_body_size: 2097152
  rotation_max_size_mb: 100
  rotation_interval_hours: 12
  retention_days: 60
  payload_retention_days: 14
  agent_modes:
    research-bot: metadata
`;

    const filePath = writeConfig('govyn.config.yaml', yaml);
    const config = loadConfig(filePath);

    // Proxy settings
    expect(config.port).toBe(8080);
    expect(config.host).toBe('0.0.0.0');

    // Providers
    expect(config.providers.size).toBe(2);
    const openai = config.providers.get('openai');
    expect(openai).toBeDefined();
    expect(openai!.baseUrl).toBe('https://api.openai.com');
    expect(openai!.apiKeyEnv).toBe('MY_OPENAI_KEY');
    expect(openai!.providerType).toBe('openai');

    const anthropic = config.providers.get('anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.providerType).toBe('anthropic');

    // Agents (sales-bot with null value is skipped by the agentDef check)
    // The parser iterates entries; null values yield no api_keys but the agent is still added
    expect(config.agents.size).toBeGreaterThanOrEqual(1);
    const researchBot = config.agents.get('research-bot');
    expect(researchBot).toBeDefined();
    expect(researchBot!.apiKeys).toEqual(['govyn-key-research']);

    // Pricing (should include defaults + custom override)
    expect(config.pricing.has('gpt-4o')).toBe(true);
    expect(config.pricing.has('custom-model')).toBe(true);

    // Budgets
    expect(config.budgets.size).toBe(1);
    const budget = config.budgets.get('research-bot');
    expect(budget).toBeDefined();
    expect(budget!.dailyLimit).toBe(10.0);
    expect(budget!.monthlyLimit).toBe(100.0);
    expect(budget!.limitType).toBe('hard');
    expect(budget!.softWarningPercent).toBe(80);

    // Logging
    expect(config.logging).toBeDefined();
    expect(config.logging!.enabled).toBe(true);
    expect(config.logging!.directory).toBe('./test-logs');
    expect(config.logging!.defaultMode).toBe('full-payload');
    expect(config.logging!.stdout).toBe(false);
    expect(config.logging!.file).toBe(true);
    expect(config.logging!.maxBodySize).toBe(2097152);
    expect(config.logging!.rotationMaxSizeMb).toBe(100);
    expect(config.logging!.rotationIntervalHours).toBe(12);
    expect(config.logging!.retentionDays).toBe(60);
    expect(config.logging!.payloadRetentionDays).toBe(14);
    expect(config.logging!.agentModes.get('research-bot')).toBe('metadata');
  });

  // Test 2: Missing file throws with descriptive error message
  it('throws descriptive error for missing file', () => {
    const badPath = path.join(tmpDir, 'nonexistent.yaml');
    expect(() => loadConfig(badPath)).toThrow('Failed to read config file');
    expect(() => loadConfig(badPath)).toThrow(badPath);
  });

  // Test 3: Invalid YAML syntax throws parse error
  it('throws parse error for invalid YAML syntax', () => {
    const filePath = writeConfig('bad.yaml', '{ invalid yaml : [}');
    expect(() => loadConfig(filePath)).toThrow('Failed to parse YAML');
  });

  // Test 4: Missing required fields — no version
  it('throws for config missing version field', () => {
    const yaml = `
proxy:
  port: 8080
`;
    const filePath = writeConfig('no-version.yaml', yaml);
    expect(() => loadConfig(filePath)).toThrow('version');
  });

  // Test 5: Missing required fields — no proxy section
  it('throws for config missing proxy section', () => {
    const yaml = `
version: 1
`;
    const filePath = writeConfig('no-proxy.yaml', yaml);
    expect(() => loadConfig(filePath)).toThrow('proxy');
  });

  // Test 6: Missing required fields — invalid port
  it('throws for config with non-integer port', () => {
    const yaml = `
version: 1
proxy:
  port: "abc"
`;
    const filePath = writeConfig('bad-port.yaml', yaml);
    expect(() => loadConfig(filePath)).toThrow('port');
  });

  // Test 7: Custom provider config parsed into providers map
  it('parses custom provider entries correctly', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
providers:
  custom:
    my-llm:
      base_url: "http://localhost:11434"
      api_key_env: "MY_LLM_KEY"
`;
    const filePath = writeConfig('custom-provider.yaml', yaml);
    const config = loadConfig(filePath);

    expect(config.providers.has('my-llm')).toBe(true);
    const myLlm = config.providers.get('my-llm')!;
    expect(myLlm.baseUrl).toBe('http://localhost:11434');
    expect(myLlm.apiKeyEnv).toBe('MY_LLM_KEY');
    expect(myLlm.providerType).toBe('custom');
  });

  // Test 8: Missing providers section defaults to empty map
  it('missing providers section results in empty providers map', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
`;
    const filePath = writeConfig('no-providers.yaml', yaml);
    const config = loadConfig(filePath);

    expect(config.providers.size).toBe(0);
  });

  // Test 9: Budget config parsing — all fields
  it('budget config parses dailyLimit, monthlyLimit, limitType, softWarningPercent', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
budgets:
  agent-a:
    daily_limit: 5.0
    monthly_limit: 50.0
    limit_type: soft
    soft_warning_percent: 70
`;
    const filePath = writeConfig('budget.yaml', yaml);
    const config = loadConfig(filePath);

    const budget = config.budgets.get('agent-a');
    expect(budget).toBeDefined();
    expect(budget!.dailyLimit).toBe(5.0);
    expect(budget!.monthlyLimit).toBe(50.0);
    expect(budget!.limitType).toBe('soft');
    expect(budget!.softWarningPercent).toBe(70);
  });

  // Test 10: Budget defaults when partial config
  it('budget defaults: hard limit type and 80% warning when not specified', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
budgets:
  agent-b:
    daily_limit: 10.0
`;
    const filePath = writeConfig('budget-defaults.yaml', yaml);
    const config = loadConfig(filePath);

    const budget = config.budgets.get('agent-b');
    expect(budget).toBeDefined();
    expect(budget!.limitType).toBe('hard');
    expect(budget!.softWarningPercent).toBe(80);
    expect(budget!.monthlyLimit).toBeNull();
  });

  // Test 11: Logging config defaults when partial
  it('logging config applies defaults for unspecified fields', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
logging:
  enabled: true
`;
    const filePath = writeConfig('logging-defaults.yaml', yaml);
    const config = loadConfig(filePath);

    expect(config.logging).toBeDefined();
    expect(config.logging!.enabled).toBe(true);
    expect(config.logging!.directory).toBe('./logs');
    expect(config.logging!.defaultMode).toBe('metadata');
    expect(config.logging!.stdout).toBe(true);
    expect(config.logging!.file).toBe(true);
    expect(config.logging!.maxBodySize).toBe(1048576);
    expect(config.logging!.retentionDays).toBe(30);
    expect(config.logging!.payloadRetentionDays).toBe(7);
  });

  // Test 12: Logging agentModes parsing with validation
  it('logging agentModes accepts valid modes and ignores invalid ones', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
logging:
  enabled: true
  agent_modes:
    good-agent: full-payload
    bad-agent: invalid-mode
    meta-agent: metadata
`;
    const filePath = writeConfig('logging-modes.yaml', yaml);
    const config = loadConfig(filePath);

    expect(config.logging!.agentModes.size).toBe(2);
    expect(config.logging!.agentModes.get('good-agent')).toBe('full-payload');
    expect(config.logging!.agentModes.get('meta-agent')).toBe('metadata');
    expect(config.logging!.agentModes.has('bad-agent')).toBe(false);
  });

  // Test 13: Env var references stored correctly
  it('api_key_env field is stored correctly without resolving', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
providers:
  openai:
    api_key_env: "MY_CUSTOM_ENV_VAR"
`;
    const filePath = writeConfig('env-var.yaml', yaml);
    const config = loadConfig(filePath);

    const openai = config.providers.get('openai');
    expect(openai!.apiKeyEnv).toBe('MY_CUSTOM_ENV_VAR');
  });

  // Test 14: Host defaults to 127.0.0.1 when not specified
  it('host defaults to 127.0.0.1 when not specified', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
`;
    const filePath = writeConfig('no-host.yaml', yaml);
    const config = loadConfig(filePath);
    expect(config.host).toBe('127.0.0.1');
    expect(config.security!.requireAgentApiKey).toBe(false);
  });

  it('enables agent API key enforcement by default for non-loopback hosts', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
  host: "0.0.0.0"
`;
    const filePath = writeConfig('public-host.yaml', yaml);
    const config = loadConfig(filePath);
    expect(config.security!.requireAgentApiKey).toBe(true);
  });

  // Test 15: Agent with loop_detection config
  it('parses per-agent loop_detection config', () => {
    const yaml = `
version: 1
proxy:
  port: 8080
agents:
  loop-agent:
    api_keys: []
    loop_detection:
      threshold: 5
      window_seconds: 30
      cooldown_seconds: 120
`;
    const filePath = writeConfig('loop-detection.yaml', yaml);
    const config = loadConfig(filePath);

    const agent = config.agents.get('loop-agent');
    expect(agent).toBeDefined();
    expect(agent!.loopDetection).toBeDefined();
    expect(agent!.loopDetection!.threshold).toBe(5);
    expect(agent!.loopDetection!.windowSeconds).toBe(30);
    expect(agent!.loopDetection!.cooldownSeconds).toBe(120);
  });
});
