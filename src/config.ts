/**
 * YAML configuration loader for the Govyn proxy server.
 *
 * Loads and validates govyn.config.yaml (or a user-specified path).
 * Maps the YAML structure to internal ProxyConfig types.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProxyConfig, ProviderConfig, AgentConfig } from './types.js';
import { loadPricing } from './pricing.js';

/**
 * Raw shape of the YAML file on disk.
 */
interface RawConfig {
  version: number;
  proxy: {
    port: number;
    host?: string;
  };
  providers?: {
    openai?: { base_url?: string; api_key_env?: string };
    anthropic?: { base_url?: string; api_key_env?: string };
    custom?: Record<string, { base_url?: string; api_key_env?: string }>;
  };
  agents?: Record<string, { api_keys?: string[] } | null>;
  pricing?: Record<string, { input: number; output: number }>;
}

/**
 * Load and parse the proxy configuration from a YAML file.
 *
 * @param filePath - Path to the YAML config file (defaults to GOVYN_CONFIG env var or ./govyn.config.yaml)
 * @returns Populated ProxyConfig object
 * @throws Error if file not found, unreadable, or missing required fields
 */
export function loadConfig(filePath?: string): ProxyConfig {
  const resolvedPath = filePath ?? process.env['GOVYN_CONFIG'] ?? './govyn.config.yaml';
  const absolutePath = path.resolve(resolvedPath);

  // Read the file
  let raw: string;
  try {
    raw = fs.readFileSync(absolutePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file at ${absolutePath}: ${message}`);
  }

  // Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML config at ${absolutePath}: ${message}`);
  }

  // Type-check and validate required fields
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid config at ${absolutePath}: expected a YAML object`);
  }

  const cfg = parsed as RawConfig;

  if (typeof cfg.version !== 'number') {
    throw new Error(`Invalid config at ${absolutePath}: missing or invalid 'version' field`);
  }

  if (typeof cfg.proxy !== 'object' || cfg.proxy === null) {
    throw new Error(`Invalid config at ${absolutePath}: missing 'proxy' section`);
  }

  if (typeof cfg.proxy.port !== 'number' || !Number.isInteger(cfg.proxy.port)) {
    throw new Error(`Invalid config at ${absolutePath}: 'proxy.port' must be an integer`);
  }

  const providers = new Map<string, ProviderConfig>();

  const rawProviders = cfg.providers ?? {};

  // Parse openai provider
  if (rawProviders.openai) {
    const p = rawProviders.openai;
    providers.set('openai', {
      name: 'openai',
      baseUrl: p.base_url ?? 'https://api.openai.com',
      apiKeyEnv: p.api_key_env ?? 'OPENAI_API_KEY',
      providerType: 'openai',
    });
  }

  // Parse anthropic provider
  if (rawProviders.anthropic) {
    const p = rawProviders.anthropic;
    providers.set('anthropic', {
      name: 'anthropic',
      baseUrl: p.base_url ?? 'https://api.anthropic.com',
      apiKeyEnv: p.api_key_env ?? 'ANTHROPIC_API_KEY',
      providerType: 'anthropic',
    });
  }

  // Parse custom providers
  const custom = rawProviders.custom ?? {};
  for (const [name, providerDef] of Object.entries(custom)) {
    if (typeof providerDef !== 'object' || providerDef === null) continue;
    const p = providerDef as { base_url?: string; api_key_env?: string };
    providers.set(name, {
      name,
      baseUrl: p.base_url ?? '',
      apiKeyEnv: p.api_key_env ?? null,
      providerType: 'custom',
    });
  }

  // Parse agents section
  const agents = new Map<string, AgentConfig>();
  const rawAgents = cfg.agents ?? {};
  for (const [agentName, agentDef] of Object.entries(rawAgents)) {
    if (typeof agentName !== 'string') continue;
    const apiKeys = agentDef?.api_keys ?? [];
    agents.set(agentName, {
      name: agentName,
      apiKeys,
    });
  }

  // Parse pricing section and build pricing table
  const rawPricing = cfg.pricing;
  const configPricing: Record<string, { input: number; output: number }> | undefined = rawPricing;
  const pricing = loadPricing(configPricing);

  const config: ProxyConfig = {
    port: cfg.proxy.port,
    host: cfg.proxy.host ?? '0.0.0.0',
    providers,
    agents,
    pricing,
  };

  console.log(`[govyn] Loaded config from ${absolutePath}`);

  return config;
}
