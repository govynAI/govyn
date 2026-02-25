/**
 * Core type definitions for the Govyn proxy server.
 */

/**
 * Supported provider types for routing.
 */
export type ProviderType = 'openai' | 'anthropic' | 'custom';

/**
 * Configuration for an upstream API provider.
 */
export interface ProviderConfig {
  /** Unique name identifier for this provider */
  name: string;
  /** Base URL for the upstream API (e.g. https://api.openai.com) */
  baseUrl: string;
  /** Environment variable name to read the API key from, or null if not needed */
  apiKeyEnv: string | null;
  /** The type of provider */
  providerType: ProviderType;
}

/**
 * Result of matching a URL route to a provider.
 */
export interface RouteMatch {
  /** The resolved provider configuration */
  provider: ProviderConfig;
  /** The upstream path to forward to (e.g. /v1/chat/completions) */
  upstreamPath: string;
  /** The type of provider matched */
  providerType: ProviderType;
}

/** Per-agent loop detection configuration from YAML */
export interface LoopDetectionConfig {
  /** Number of identical calls to trigger loop detection (default: 10) */
  threshold: number;
  /** Time window in seconds to count identical calls (default: 60) */
  windowSeconds: number;
  /** Cooldown period in seconds after loop detected (default: 300 = 5 min) */
  cooldownSeconds: number;
}

/**
 * Configuration for a named agent that can send requests through the proxy.
 */
export interface AgentConfig {
  /** Human-readable name for this agent */
  name: string;
  /** Optional list of API keys scoped to this agent */
  apiKeys?: string[];
  /** Per-agent loop detection overrides */
  loopDetection?: LoopDetectionConfig;
}

/**
 * Resolved identity of the agent making a request.
 */
export interface AgentIdentity {
  /** The agent's identifier (e.g. "research-agent" or "unknown") */
  agentId: string;
  /** How the agent was identified */
  source: 'header' | 'api-key' | 'default';
}

/**
 * Token usage extracted from a provider response.
 */
export interface TokenUsage {
  /** Number of input/prompt tokens used */
  inputTokens: number;
  /** Number of output/completion tokens generated */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** The model that was used */
  model: string;
  /** The provider type */
  provider: ProviderType;
}

/**
 * A single cost record for one proxied request.
 * Stored in the CostAggregator after every proxied request.
 */
export interface CostRecord {
  /** The agent that made the request */
  agentId: string;
  /** The model used (as returned by the upstream) */
  model: string;
  /** The provider type */
  provider: ProviderType;
  /** Number of input tokens */
  inputTokens: number;
  /** Number of output tokens */
  outputTokens: number;
  /** Cost for input tokens (USD) */
  inputCost: number;
  /** Cost for output tokens (USD) */
  outputCost: number;
  /** Total cost (USD) */
  totalCost: number;
  /** Whether the model was found in the pricing table */
  priced: boolean;
  /** Unix timestamp (ms) when the record was created */
  timestamp: number;
}

/**
 * Aggregated cost summary for a single agent over a time period.
 */
export interface CostSummary {
  /** The agent identifier */
  agentId: string;
  /** Total cost (USD) */
  totalCost: number;
  /** Total input token cost (USD) */
  inputCost: number;
  /** Total output token cost (USD) */
  outputCost: number;
  /** Total input tokens across all requests */
  totalInputTokens: number;
  /** Total output tokens across all requests */
  totalOutputTokens: number;
  /** Number of requests attributed to this agent */
  requestCount: number;
  /** Per-model cost and token breakdown */
  models: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }>;
}

/**
 * Time period for cost aggregation queries.
 * - 'hour': last 60 minutes
 * - 'day': current calendar day (midnight UTC to now)
 * - 'month': current calendar month (1st UTC to now)
 * - 'all': all records
 */
export type TimePeriod = 'hour' | 'day' | 'month' | 'all';

/** Per-agent budget configuration from YAML */
export interface BudgetConfig {
  /** Daily spending limit in USD (null = no daily limit) */
  dailyLimit: number | null;
  /** Monthly spending limit in USD (null = no monthly limit) */
  monthlyLimit: number | null;
  /** Hard or soft limit behavior */
  limitType: 'hard' | 'soft';
  /** Soft warning threshold as a percentage (0-100), default 80 */
  softWarningPercent: number;
}

/** Result of a budget check before proxying a request */
export interface BudgetCheckResult {
  /** Whether the request is allowed to proceed */
  allowed: boolean;
  /** If blocked, the reason code */
  code?: 'budget_exceeded_daily' | 'budget_exceeded_monthly' | 'loop_detected';
  /** If blocked or warning, the limit that was hit */
  limitAmount?: number;
  /** Current spend in the relevant period */
  currentSpend?: number;
  /** ISO timestamp when the budget resets */
  resetTime?: string;
  /** Whether a soft warning should be emitted */
  warning?: boolean;
  /** Percentage of budget used (for warnings) */
  percentUsed?: number;
}

/** Budget status for a single agent */
export interface BudgetStatus {
  agentId: string;
  daily: {
    limit: number | null;
    spent: number;
    remaining: number | null;
    percentUsed: number | null;
    resetsAt: string;
  };
  monthly: {
    limit: number | null;
    spent: number;
    remaining: number | null;
    percentUsed: number | null;
    resetsAt: string;
  };
  limitType: 'hard' | 'soft';
  blocked: boolean;
}

/**
 * Logging mode for an agent.
 * - 'metadata': log summary fields only (default)
 * - 'full-payload': log full request/response bodies as separate files
 */
export type LoggingMode = 'metadata' | 'full-payload';

/**
 * A structured log entry for a single proxied request.
 */
export interface LogEntry {
  /** Unique identifier for this log entry */
  id: string;
  /** ISO 8601 timestamp when the request was completed */
  timestamp: string;
  /** The agent that made the request */
  agent_id: string;
  /** The upstream provider type */
  provider: ProviderType;
  /** The upstream path that was forwarded to */
  target: string;
  /** The model used (if extractable from the response) */
  model: string | null;
  /** Number of input/prompt tokens (if extractable) */
  input_tokens: number | null;
  /** Number of output/completion tokens (if extractable) */
  output_tokens: number | null;
  /** Calculated cost in USD (if priced) */
  cost: number | null;
  /** Whether the model was found in the pricing table */
  priced: boolean;
  /** Request latency in milliseconds (request start to upstream response end) */
  latency_ms: number;
  /** HTTP status code of the upstream response */
  status: number;
  /** Whether a full payload file was stored for this request */
  has_payload: boolean;
  /** Reference ID to the payload file (null if metadata-only) */
  payload_id: string | null;
  /** Storage region where this log entry is stored */
  storage_region: 'eu' | 'us' | 'auto';
}

/**
 * Configuration for the action logging system.
 */
export interface LoggingConfig {
  /** Whether logging is enabled (default: true) */
  enabled: boolean;
  /** Directory for log files (default: './logs') */
  directory: string;
  /** Default logging mode for all agents (default: 'metadata') */
  defaultMode: LoggingMode;
  /** Write log lines to stdout (default: true) */
  stdout: boolean;
  /** Write log lines to JSONL file (default: true) */
  file: boolean;
  /** Max body size in bytes before truncation (default: 1048576 = 1MB) */
  maxBodySize: number;
  /** File rotation trigger: max size in MB (default: 50) */
  rotationMaxSizeMb: number;
  /** File rotation trigger: hours between rotations (default: 24) */
  rotationIntervalHours: number;
  /** Auto-delete log files after N days (default: 30) */
  retentionDays: number;
  /** Auto-delete payload files after N days (default: 7) */
  payloadRetentionDays: number;
  /** Per-agent logging mode overrides */
  agentModes: Map<string, LoggingMode>;
  /** Storage region for GDPR compliance: 'eu', 'us', or 'auto' (default: 'auto') */
  storageRegion: 'eu' | 'us' | 'auto';
}

/**
 * Overall proxy server configuration.
 */
export interface ProxyConfig {
  /** TCP port to listen on */
  port: number;
  /** Host/address to bind to (e.g. 0.0.0.0) */
  host: string;
  /** Map of provider name to provider configuration */
  providers: Map<string, ProviderConfig>;
  /** Map of agent name to agent configuration */
  agents: Map<string, AgentConfig>;
  /** Pricing table for cost calculation */
  pricing: Map<string, { inputPricePerMillion: number; outputPricePerMillion: number }>;
  /** Per-agent budget configuration */
  budgets: Map<string, BudgetConfig>;
  /** Action logging configuration (optional, defaults applied if missing) */
  logging?: LoggingConfig;
}
