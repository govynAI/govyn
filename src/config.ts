/**
 * YAML configuration loader for the Govyn proxy server.
 *
 * Loads and validates govyn.config.yaml (or a user-specified path).
 * Maps the YAML structure to internal ProxyConfig types.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ProxyConfig, ProviderConfig, AgentConfig, BudgetConfig, LoopDetectionConfig, LoggingConfig, LoggingMode, DatabaseConfig } from './types.js';
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
  agents?: Record<string, {
    api_keys?: string[];
    loop_detection?: {
      threshold?: number;
      window_seconds?: number;
      cooldown_seconds?: number;
    };
  } | null>;
  pricing?: Record<string, { input: number; output: number }>;
  budgets?: Record<string, {
    daily_limit?: number;
    monthly_limit?: number;
    limit_type?: 'hard' | 'soft';
    soft_warning_percent?: number;
  } | null>;
  policies_file?: string;
  database?: {
    url?: string;
    fail_open?: boolean;
    retention_days?: number;
    approval_retention_days?: number;
  };
  logging?: {
    enabled?: boolean;
    directory?: string;
    default_mode?: string;
    stdout?: boolean;
    file?: boolean;
    max_body_size?: number;
    rotation_max_size_mb?: number;
    rotation_interval_hours?: number;
    retention_days?: number;
    payload_retention_days?: number;
    agent_modes?: Record<string, string>;
    storage_region?: string;
  };
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
    if (agentDef === null || agentDef === undefined) continue;
    const apiKeys = agentDef.api_keys ?? [];

    // Parse per-agent loop detection config with defaults
    let loopDetection: LoopDetectionConfig | undefined;
    if (agentDef?.loop_detection) {
      const ld = agentDef.loop_detection;
      loopDetection = {
        threshold: ld.threshold ?? 10,
        windowSeconds: ld.window_seconds ?? 60,
        cooldownSeconds: ld.cooldown_seconds ?? 300,
      };
    }

    agents.set(agentName, {
      name: agentName,
      apiKeys,
      ...(loopDetection ? { loopDetection } : {}),
    });
  }

  // Parse pricing section and build pricing table
  const rawPricing = cfg.pricing;
  const configPricing: Record<string, { input: number; output: number }> | undefined = rawPricing;
  const pricing = loadPricing(configPricing);

  // Parse budgets section
  const budgets = new Map<string, BudgetConfig>();
  const rawBudgets = cfg.budgets ?? {};
  for (const [agentName, budgetDef] of Object.entries(rawBudgets)) {
    if (typeof agentName !== 'string' || !budgetDef) continue;
    budgets.set(agentName, {
      dailyLimit: budgetDef.daily_limit ?? null,
      monthlyLimit: budgetDef.monthly_limit ?? null,
      limitType: budgetDef.limit_type ?? 'hard',
      softWarningPercent: budgetDef.soft_warning_percent ?? 80,
    });
  }

  // Parse logging section
  let logging: LoggingConfig | undefined;
  if (cfg.logging) {
    const rawLog = cfg.logging;

    // Validate default_mode
    const defaultMode: LoggingMode = rawLog.default_mode === 'full-payload' ? 'full-payload' : 'metadata';

    // Parse per-agent modes with validation
    const agentModes = new Map<string, LoggingMode>();
    if (rawLog.agent_modes) {
      for (const [agentName, modeStr] of Object.entries(rawLog.agent_modes)) {
        if (modeStr === 'metadata' || modeStr === 'full-payload') {
          agentModes.set(agentName, modeStr);
        } else {
          console.warn(`[govyn] Invalid logging mode '${modeStr}' for agent '${agentName}', using default`);
        }
      }
    }

    // Validate storage_region
    let storageRegion: 'eu' | 'us' | 'auto' = 'auto';
    if (rawLog.storage_region) {
      const region = rawLog.storage_region.toLowerCase();
      if (region === 'eu' || region === 'us' || region === 'auto') {
        storageRegion = region;
      } else {
        throw new Error(`Invalid config at ${absolutePath}: logging.storage_region must be 'eu', 'us', or 'auto', got '${rawLog.storage_region}'`);
      }
    }

    logging = {
      enabled: rawLog.enabled ?? true,
      directory: rawLog.directory ?? './logs',
      defaultMode,
      stdout: rawLog.stdout ?? true,
      file: rawLog.file ?? true,
      maxBodySize: rawLog.max_body_size ?? 1048576,
      rotationMaxSizeMb: rawLog.rotation_max_size_mb ?? 50,
      rotationIntervalHours: rawLog.rotation_interval_hours ?? 24,
      retentionDays: rawLog.retention_days ?? 30,
      payloadRetentionDays: rawLog.payload_retention_days ?? 7,
      agentModes,
      storageRegion,
    };
  }

  // Parse database section (optional — no DB persistence if missing)
  let database: DatabaseConfig | undefined;
  const dbUrl = process.env['GOVYN_DATABASE_URL'] ?? cfg.database?.url;
  if (dbUrl && typeof dbUrl === 'string' && dbUrl.length > 0) {
    database = {
      url: dbUrl,
      failOpen: cfg.database?.fail_open ?? true,
      retentionDays: cfg.database?.retention_days ?? 90,
      approvalRetentionDays: cfg.database?.approval_retention_days ?? 365,
    };
  }

  // Parse policies_file (optional path to policy YAML)
  const policiesFile = typeof cfg.policies_file === 'string' ? cfg.policies_file : undefined;
  if (policiesFile) {
    console.log(`[govyn] Policy file configured: ${policiesFile}`);
  }

  const config: ProxyConfig = {
    port: cfg.proxy.port,
    host: cfg.proxy.host ?? '0.0.0.0',
    providers,
    agents,
    pricing,
    budgets,
    ...(logging ? { logging } : {}),
    ...(policiesFile ? { policiesFile } : {}),
    ...(database ? { database } : {}),
  };

  console.log(`[govyn] Loaded config from ${absolutePath}`);

  return config;
}
