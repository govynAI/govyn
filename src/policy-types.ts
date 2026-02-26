/**
 * Policy type definitions for the Govyn policy engine.
 *
 * These types define the schema for YAML policy files and the
 * results of parsing/validating them.
 */

/** The six policy types supported by Govyn (Phase 6 defines skeletons; Phase 7 adds evaluators) */
export type PolicyType = 'block' | 'rate_limit' | 'budget_limit' | 'content_filter' | 'time_window' | 'model_route';

/** Policy scope — determines which requests a policy applies to */
export interface PolicyScope {
  /** 'global' applies to all requests; 'agent' scopes to a specific agent; 'target' scopes to a provider */
  level: 'global' | 'agent' | 'target';
  /** The agent name (when level='agent') or target provider (when level='target'), undefined for global */
  value?: string;
}

/** Base fields shared by all policy definitions */
export interface PolicyBase {
  /** Unique policy name (must be unique across all loaded policies) */
  name: string;
  /** Human-readable description of what this policy does */
  description?: string;
  /** Whether this policy is active (default: true) */
  enabled: boolean;
  /** The type of policy rule */
  type: PolicyType;
  /** Scoping: who/what this policy applies to */
  scope: PolicyScope;
}

/** Block policy — denies requests matching configured criteria with AND logic */
export interface BlockPolicy extends PolicyBase {
  type: 'block';
  match?: {
    body?: string;         // string or regex pattern to match against request body
    headers?: Record<string, string>;  // header name -> pattern to match
    provider?: string;     // target provider name (literal match)
    path?: string;         // target path pattern (literal or regex)
    model?: string;        // model name to block (literal or regex)
    action_type?: string;  // inferred action type: 'chat', 'embedding', 'image_generation', etc.
    regex?: boolean;       // if true, body/headers/path/model patterns are regex; default false (literal)
  };
  message?: string;
}

/** Rate limit policy — throttles requests per sliding window */
export interface RateLimitPolicy extends PolicyBase {
  type: 'rate_limit';
  limit: number;            // max requests allowed in window
  window_seconds: number;   // sliding window size in seconds
}

/** Budget limit policy — enforces spending limits per period */
export interface BudgetLimitPolicy extends PolicyBase {
  type: 'budget_limit';
  limit: number;            // max spend amount (in dollars)
  period: 'daily' | 'weekly' | 'monthly';  // reset period
}

/** Content filter policy — scans request body JSON string values for PII and custom patterns */
export interface ContentFilterPolicy extends PolicyBase {
  type: 'content_filter';
  patterns: string[];       // list of built-in pattern names ('ssn', 'credit_card', 'email', 'phone') and/or custom regex strings
  reveal_pattern?: boolean; // if true, error message includes which pattern matched; default false (generic message)
}

/** Time window policy — schedule-based access control with timezone support */
export interface TimeWindowPolicy extends PolicyBase {
  type: 'time_window';
  start: string;            // start time in HH:MM format (e.g., "09:00")
  end: string;              // end time in HH:MM format (e.g., "17:00")
  days: string[];           // day names: 'monday'-'sunday', or presets: 'weekdays', 'weekends', 'daily'
  timezone: string;         // IANA timezone (e.g., 'America/New_York', 'UTC')
  mode: 'allow' | 'deny';  // 'allow' = access during window, 'deny' = blocked during window
}

/** A single routing rule with criteria and target model */
export interface ModelRoutingRule {
  when?: {
    input_tokens_estimate?: string;          // comparison: "<500", ">4000", "<=1000"
    system_prompt_contains?: string[];       // ANY keyword match in system prompt -> rule matches
    no_system_prompt_contains?: string[];    // NONE of these keywords may appear in system prompt
    user_prompt_contains?: string[];         // ANY keyword match in user message content
    no_user_prompt_contains?: string[];      // NONE of these keywords may appear in user message
    agent?: string;                          // literal agent ID or "*" for wildcard
    time_of_day?: string;                    // "HH:MM-HH:MM" range (UTC unless timezone in policy)
    tool_calls_present?: boolean;            // true if request includes tool/function definitions
    conversation_turns?: string;             // comparison: "<3", ">10", "<=5"
    provider?: string;                       // literal provider name match
  };
  route_to: string;                          // target model name or alias (resolved via model_aliases)
  default?: 'passthrough';                   // if set to 'passthrough', this is the fallback rule
}

/** Model route policy — smart model routing per ADR-021 */
export interface ModelRoutePolicy extends PolicyBase {
  type: 'model_route';
  rules: ModelRoutingRule[];
  model_aliases?: Record<string, string>;    // e.g., { cheap: "claude-haiku-4-5-20251001", standard: "claude-sonnet-4-5-20250929" }
  max_downgrade_level?: string;              // alias tier name: routing cannot go below this tier
  routing_opt_out_agents?: string[];         // agents that skip routing entirely (passthrough)
}

/** Union type of all policy variants */
export type Policy = BlockPolicy | RateLimitPolicy | BudgetLimitPolicy | ContentFilterPolicy | TimeWindowPolicy | ModelRoutePolicy;

/** Context about the current request, passed to the engine for evaluation */
export interface PolicyRequestContext {
  /** The agent making the request */
  agentId: string;
  /** The target provider (e.g., 'openai', 'anthropic') */
  provider: string;
  /** The upstream path being requested */
  path: string;
  /** HTTP method */
  method: string;
  /** Model name from the request (for block matching on model) */
  model?: string;
  /** Request body as string (for content matching) */
  body?: string;
  /** Request headers (for header matching) */
  headers?: Record<string, string>;
  /** Estimated input token count (for model routing criteria) */
  inputTokensEstimate?: number;
  /** Whether tool/function definitions are present in the request */
  toolCallsPresent?: boolean;
  /** Number of conversation turns (messages) in the request */
  conversationTurns?: number;
  /** System prompt content (for keyword matching) */
  systemPrompt?: string;
  /** User message content (for keyword matching) */
  userPrompt?: string;
}

/** Result of evaluating a single policy against a request */
export interface SinglePolicyResult {
  /** The policy that was evaluated */
  policyName: string;
  /** The policy type */
  policyType: PolicyType;
  /** Whether this policy allows the request */
  allowed: boolean;
  /** Reason for denial (if blocked) */
  reason?: string;
  /** The deny message from the policy (if any) */
  message?: string;
  /** For rate_limit type — seconds until retry is allowed */
  retryAfterSeconds?: number;
}

/** Result extension for model_route evaluations */
export interface ModelRouteResult extends SinglePolicyResult {
  policyType: 'model_route';
  /** The model to route to (undefined = passthrough, no rewrite) */
  routeTo?: string;
  /** The original model requested by the agent */
  requestedModel?: string;
  /** The rule index that matched (for logging) */
  matchedRuleIndex?: number;
}

/** Aggregate result of evaluating all matching policies */
export interface PolicyEvaluationResult {
  /** Whether the request is allowed (true only if ALL matching policies allow) */
  allowed: boolean;
  /** Number of policies that were evaluated */
  evaluatedCount: number;
  /** Number of policies that matched the request scope */
  matchedCount: number;
  /** If denied, the first denying policy result (most-restrictive-wins) */
  denied?: SinglePolicyResult;
  /** All individual policy results */
  results: SinglePolicyResult[];
  /** Time taken for evaluation in milliseconds */
  evaluationTimeMs: number;
}

/** Top-level policy file structure */
export interface PolicyFile {
  /** Schema version — must be 1 per ADR-018 */
  version: number;
  /** Array of policy definitions */
  policies: Policy[];
}

/** A policy parse error with location information */
export interface PolicyParseError {
  /** Human-readable error message */
  message: string;
  /** Line number in the YAML file (1-indexed), if available */
  line?: number;
  /** Column number (1-indexed), if available */
  column?: number;
  /** The policy name this error relates to, if applicable */
  policyName?: string;
}

/** Result of parsing a policy file */
export interface PolicyParseResult {
  /** Whether parsing succeeded without errors */
  success: boolean;
  /** Parsed policies (empty if success=false) */
  policies: Policy[];
  /** Validation errors (empty if success=true) */
  errors: PolicyParseError[];
  /** Non-fatal warnings */
  warnings: PolicyParseError[];
}
