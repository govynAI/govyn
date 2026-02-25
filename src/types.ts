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

/**
 * Configuration for a named agent that can send requests through the proxy.
 */
export interface AgentConfig {
  /** Human-readable name for this agent */
  name: string;
  /** Optional list of API keys scoped to this agent */
  apiKeys?: string[];
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
  code?: 'budget_exceeded_daily' | 'budget_exceeded_monthly';
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
}
