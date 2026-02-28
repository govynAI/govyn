/**
 * PolicyEngine — core runtime component for evaluating policies against requests.
 *
 * Loads policies into memory and evaluates them synchronously per request.
 * Supports scoping hierarchy (global > per-agent > per-target) with
 * most-restrictive-wins precedence: if any matching policy denies, the
 * request is denied.
 *
 * Phase 7/8 evaluators:
 * - Block: multi-criteria AND matching with optional regex mode
 * - Rate limit: per-agent per-policy sliding window with dynamic retry_after
 * - Budget limit: integrates with CostAggregator for period-based spend checks
 * - Content filter: PII/pattern scanning on JSON string values
 * - Time window: schedule-based access control with timezone support
 * - Model route: smart model routing with criteria matching, aliases, and safeguards
 *
 * Performance target: 100 policies in <5ms (ADR-006, ADR-013).
 */

import { parsePolicies, parsePoliciesFromFile } from './policy-parser.js';
import { CostAggregator } from './cost-aggregator.js';
import type {
  Policy,
  PolicyType,
  PolicyScope,
  PolicyRequestContext,
  SinglePolicyResult,
  PolicyEvaluationResult,
  PolicyParseResult,
  BlockPolicy,
  RateLimitPolicy,
  BudgetLimitPolicy,
  ContentFilterPolicy,
  TimeWindowPolicy,
  ModelRoutePolicy,
  ModelRouteResult,
  RequireApprovalPolicy,
  ApprovalPolicyResult,
} from './policy-types.js';

/** Evaluation options for testability (e.g., injectable timestamp). */
export interface EvaluateOptions {
  /** Current timestamp in milliseconds (injectable for testing rate limit windows). */
  now?: number;
}

/**
 * Infer the action type from an API endpoint path.
 *
 * Maps common OpenAI-style paths to semantic action types.
 * Order matters: /chat/completions must be checked before /completions.
 */
export function inferActionType(path: string): string {
  if (path.includes('/chat/completions')) return 'chat';
  if (path.includes('/embeddings')) return 'embedding';
  if (path.includes('/images/generations')) return 'image_generation';
  if (path.includes('/audio/transcriptions')) return 'audio_transcription';
  if (path.includes('/completions')) return 'completion';
  return 'unknown';
}

/**
 * Check if a policy's scope matches the given request context.
 *
 * - global: always matches
 * - agent: matches if scope.value === context.agentId
 * - target: matches if scope.value === context.provider
 */
function scopeMatches(scope: PolicyScope, context: PolicyRequestContext): boolean {
  switch (scope.level) {
    case 'global':
      return true;
    case 'agent':
      return scope.value === context.agentId;
    case 'target':
      return scope.value === context.provider;
    default:
      return false;
  }
}

/**
 * Evaluate a block policy against a request context.
 *
 * If no match criteria are specified, the block is unconditional (backward
 * compatible with Phase 6 skeleton behavior).
 *
 * When match criteria are specified, ALL specified criteria must match (AND logic).
 * The `regex` flag controls whether string patterns are literal or regex.
 */
function evaluateBlock(policy: BlockPolicy, context: PolicyRequestContext): SinglePolicyResult {
  const match = policy.match;

  // No match criteria = unconditional block (backward compat with Phase 6)
  if (!match) {
    return {
      policyName: policy.name,
      policyType: 'block',
      allowed: false,
      reason: 'Blocked by policy',
      message: policy.message,
    };
  }

  const useRegex = match.regex === true;

  // AND logic: all specified criteria must match for denial.
  // If any criterion does not match, the request is allowed.

  if (match.provider !== undefined) {
    if (match.provider !== context.provider) {
      return { policyName: policy.name, policyType: 'block', allowed: true };
    }
  }

  if (match.action_type !== undefined) {
    const actionType = inferActionType(context.path);
    if (match.action_type !== actionType) {
      return { policyName: policy.name, policyType: 'block', allowed: true };
    }
  }

  if (match.model !== undefined) {
    const contextModel = context.model ?? '';
    if (useRegex) {
      if (!new RegExp(match.model).test(contextModel)) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    } else {
      if (match.model !== contextModel) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    }
  }

  if (match.path !== undefined) {
    if (useRegex) {
      if (!new RegExp(match.path).test(context.path)) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    } else {
      if (match.path !== context.path) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    }
  }

  if (match.body !== undefined && context.body) {
    if (useRegex) {
      if (!new RegExp(match.body).test(context.body)) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    } else {
      if (!context.body.includes(match.body)) {
        return { policyName: policy.name, policyType: 'block', allowed: true };
      }
    }
  } else if (match.body !== undefined && !context.body) {
    // Body criterion specified but no body in context -> no match
    return { policyName: policy.name, policyType: 'block', allowed: true };
  }

  if (match.headers !== undefined && context.headers) {
    for (const [headerName, pattern] of Object.entries(match.headers)) {
      const headerValue = context.headers[headerName.toLowerCase()] ?? context.headers[headerName] ?? '';
      if (useRegex) {
        if (!new RegExp(pattern).test(headerValue)) {
          return { policyName: policy.name, policyType: 'block', allowed: true };
        }
      } else {
        if (headerValue !== pattern) {
          return { policyName: policy.name, policyType: 'block', allowed: true };
        }
      }
    }
  } else if (match.headers !== undefined && !context.headers) {
    return { policyName: policy.name, policyType: 'block', allowed: true };
  }

  // All criteria matched -> block
  return {
    policyName: policy.name,
    policyType: 'block',
    allowed: false,
    reason: 'Request matched block criteria',
    message: policy.message,
  };
}

/**
 * In-memory sliding window store for rate limit tracking.
 *
 * Keys are `${policyName}:${agentId}` to ensure per-agent per-policy isolation.
 * Timestamps are stored in ascending order for efficient window eviction.
 */
class RateLimitStore {
  private windows: Map<string, number[]> = new Map();

  /**
   * Record a request and check if the rate limit is exceeded.
   *
   * All requests are counted (including those denied by other policies)
   * to prevent agents from hammering despite being blocked.
   *
   * @param key - unique key (policyName:agentId)
   * @param limit - max requests allowed in window
   * @param windowMs - window size in milliseconds
   * @param now - current timestamp in ms (injectable for testing)
   * @returns result with allowed status and retry info
   */
  check(
    key: string,
    limit: number,
    windowMs: number,
    now?: number,
  ): { allowed: boolean; retryAfterSeconds?: number; remaining: number } {
    const currentTime = now ?? Date.now();
    const windowStart = currentTime - windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Evict expired entries
    while (timestamps.length > 0 && timestamps[0] <= windowStart) {
      timestamps.shift();
    }

    // Always record this request (all requests count per CONTEXT.md decision)
    timestamps.push(currentTime);

    if (timestamps.length > limit) {
      // Exceeded: retry_after is time until oldest entry expires
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - currentTime;
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
        remaining: 0,
      };
    }

    return {
      allowed: true,
      remaining: limit - timestamps.length,
    };
  }

  /** Clear all tracked windows. */
  clear(): void {
    this.windows.clear();
  }
}

/**
 * Evaluate a rate limit policy against a request context.
 */
function evaluateRateLimit(
  policy: RateLimitPolicy,
  context: PolicyRequestContext,
  store: RateLimitStore,
  now?: number,
): SinglePolicyResult {
  const key = `${policy.name}:${context.agentId}`;
  const windowMs = policy.window_seconds * 1000;
  const result = store.check(key, policy.limit, windowMs, now);

  if (!result.allowed) {
    return {
      policyName: policy.name,
      policyType: 'rate_limit',
      allowed: false,
      reason: `Rate limit exceeded: ${policy.limit} requests per ${policy.window_seconds}s`,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  return {
    policyName: policy.name,
    policyType: 'rate_limit',
    allowed: true,
  };
}

/**
 * Evaluate a budget limit policy against a request context.
 *
 * Queries the CostAggregator for the agent's spend in the configured period.
 * If no aggregator is available, the budget is not enforced (allows).
 */
function evaluateBudgetLimit(
  policy: BudgetLimitPolicy,
  context: PolicyRequestContext,
  aggregator?: CostAggregator,
): SinglePolicyResult {
  if (!aggregator) {
    // No aggregator available — can't enforce budget, allow
    return {
      policyName: policy.name,
      policyType: 'budget_limit',
      allowed: true,
      reason: 'No cost aggregator available — budget not enforced',
    };
  }

  // Map policy period to CostAggregator TimePeriod
  const periodMap: Record<string, 'day' | 'week' | 'month' | 'all'> = {
    daily: 'day',
    weekly: 'week', // 7-day sliding window
    monthly: 'month',
  };
  const timePeriod = periodMap[policy.period] ?? 'all';

  const summaries = aggregator.getSummary({
    agentId: context.agentId,
    period: timePeriod,
  });

  const currentSpend = summaries.length > 0 ? summaries[0].totalCost : 0;

  if (currentSpend >= policy.limit) {
    return {
      policyName: policy.name,
      policyType: 'budget_limit',
      allowed: false,
      reason: `Budget limit exceeded: $${currentSpend.toFixed(2)} spent of $${policy.limit.toFixed(2)} ${policy.period} limit`,
    };
  }

  return {
    policyName: policy.name,
    policyType: 'budget_limit',
    allowed: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Content filter evaluator
// ─────────────────────────────────────────────────────────────

/** Built-in PII pattern regexes (opt-in per pattern name). */
const BUILTIN_PATTERNS: Record<string, RegExp> = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  phone: /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/,
};

/**
 * Recursively extract all string values from a parsed JSON object.
 * Only values are extracted (not keys), to avoid false positives from JSON structure.
 */
function extractStringValues(obj: unknown): string[] {
  const values: string[] = [];
  if (typeof obj === 'string') {
    values.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      values.push(...extractStringValues(item));
    }
  } else if (obj !== null && typeof obj === 'object') {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      values.push(...extractStringValues(val));
    }
  }
  return values;
}

/**
 * Evaluate a content filter policy against a request context.
 *
 * Parses the request body as JSON, extracts all string values (recursive),
 * and scans them against configured patterns. Built-in pattern names
 * resolve to predefined regexes; unrecognized names are treated as custom regex strings.
 */
function evaluateContentFilter(
  policy: ContentFilterPolicy,
  context: PolicyRequestContext,
): SinglePolicyResult {
  if (!context.body) {
    return { policyName: policy.name, policyType: 'content_filter', allowed: true };
  }

  // Parse body as JSON and extract string values
  let stringValues: string[];
  try {
    const parsed = JSON.parse(context.body);
    stringValues = extractStringValues(parsed);
  } catch {
    // Non-JSON body — can't scan, allow
    return { policyName: policy.name, policyType: 'content_filter', allowed: true };
  }

  const combinedText = stringValues.join(' ');

  // Check each pattern
  for (const pattern of policy.patterns) {
    const builtinRegex = BUILTIN_PATTERNS[pattern];
    const regex = builtinRegex ?? new RegExp(pattern);

    if (regex.test(combinedText)) {
      const reason = policy.reveal_pattern
        ? `Content filter triggered: ${builtinRegex ? pattern : 'custom pattern'} detected`
        : `Content blocked by policy '${policy.name}'`;

      return {
        policyName: policy.name,
        policyType: 'content_filter',
        allowed: false,
        reason,
        message: reason,
      };
    }
  }

  return { policyName: policy.name, policyType: 'content_filter', allowed: true };
}

// ─────────────────────────────────────────────────────────────
// Time window evaluator
// ─────────────────────────────────────────────────────────────

/**
 * Expand day preset names into individual day names.
 *
 * Supports: 'weekdays' -> Mon-Fri, 'weekends' -> Sat-Sun, 'daily' -> all 7 days,
 * or individual day names passed through as-is (lowercased).
 */
function expandDayPresets(days: string[]): string[] {
  const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const weekends = ['saturday', 'sunday'];
  const all = [...weekdays, ...weekends];

  const result: string[] = [];
  for (const day of days) {
    switch (day) {
      case 'weekdays': result.push(...weekdays); break;
      case 'weekends': result.push(...weekends); break;
      case 'daily': result.push(...all); break;
      default: result.push(day.toLowerCase()); break;
    }
  }
  return result;
}

/**
 * Evaluate a time window policy against a request context.
 *
 * Uses Intl.DateTimeFormat to convert the current time to the policy's
 * IANA timezone, then checks if the day and time fall within the window.
 * Supports overnight windows where end < start (e.g., 22:00-06:00).
 *
 * @param policy - The time window policy to evaluate
 * @param _context - Request context (unused, time is external)
 * @param now - Optional injectable Date for testing
 */
function evaluateTimeWindow(
  policy: TimeWindowPolicy,
  _context: PolicyRequestContext,
  now?: Date,
): SinglePolicyResult {
  const currentDate = now ?? new Date();

  // Convert to the policy's timezone using Intl.DateTimeFormat
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: policy.timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'long',
  });
  const parts = formatter.formatToParts(currentDate);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
  const dayName = (parts.find(p => p.type === 'weekday')?.value ?? 'monday').toLowerCase();

  const currentMinutes = hour * 60 + minute;

  // Parse start/end times
  const [startH, startM] = policy.start.split(':').map(Number);
  const [endH, endM] = policy.end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Check day match
  const expandedDays = expandDayPresets(policy.days);
  const dayMatches = expandedDays.includes(dayName);

  // Check time match (handles overnight windows where end < start)
  let timeMatches: boolean;
  if (endMinutes > startMinutes) {
    // Normal window: 09:00-17:00
    timeMatches = currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window: 22:00-06:00
    timeMatches = currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  const inWindow = dayMatches && timeMatches;

  // Apply mode
  if (policy.mode === 'allow') {
    // Allow mode: allowed during window, denied outside
    if (inWindow) {
      return { policyName: policy.name, policyType: 'time_window', allowed: true };
    }
    return {
      policyName: policy.name,
      policyType: 'time_window',
      allowed: false,
      reason: `Access restricted: outside allowed hours (${policy.start}-${policy.end} ${policy.timezone})`,
    };
  } else {
    // Deny mode: denied during window, allowed outside
    if (inWindow) {
      return {
        policyName: policy.name,
        policyType: 'time_window',
        allowed: false,
        reason: `Access restricted: blocked during ${policy.start}-${policy.end} ${policy.timezone}`,
      };
    }
    return { policyName: policy.name, policyType: 'time_window', allowed: true };
  }
}

// ─────────────────────────────────────────────────────────────
// Model route evaluator
// ─────────────────────────────────────────────────────────────

/**
 * Parse a comparison string like "<500", ">=100", ">4000", "<=1000", "=42".
 * Returns the operator and numeric value.
 */
function parseComparison(value: string): { op: string; num: number } {
  const match = value.match(/^([<>]=?|=)(\d+(?:\.\d+)?)$/);
  if (!match) {
    return { op: '<', num: 0 };
  }
  return { op: match[1], num: parseFloat(match[2]) };
}

/**
 * Apply a parsed comparison against a numeric value.
 */
function applyComparison(actual: number, op: string, threshold: number): boolean {
  switch (op) {
    case '<': return actual < threshold;
    case '>': return actual > threshold;
    case '<=': return actual <= threshold;
    case '>=': return actual >= threshold;
    case '=': return actual === threshold;
    default: return false;
  }
}

/**
 * Evaluate a model route policy against a request context.
 *
 * The model_route evaluator never denies requests — it either routes to a
 * different model or passes through unchanged. Rules are evaluated in order
 * (first match wins). Model aliases resolve symbolic tier names to actual
 * model strings. Safeguards include max_downgrade_level and per-agent opt-out.
 *
 * @param policy - The model route policy to evaluate
 * @param context - Request context with routing-relevant fields
 * @param now - Optional injectable timestamp for time_of_day matching
 */
function evaluateModelRoute(
  policy: ModelRoutePolicy,
  context: PolicyRequestContext,
  now?: number,
): ModelRouteResult {
  const baseResult: ModelRouteResult = {
    policyName: policy.name,
    policyType: 'model_route',
    allowed: true,
    requestedModel: context.model,
  };

  // 1. Per-agent opt-out check
  if (policy.routing_opt_out_agents?.includes(context.agentId)) {
    return baseResult; // passthrough — no routeTo
  }

  // 2. Iterate rules in order (first match wins)
  for (let i = 0; i < policy.rules.length; i++) {
    const rule = policy.rules[i];

    // Explicit default passthrough rule
    if (rule.default === 'passthrough') {
      return baseResult; // passthrough
    }

    // If no when clause, rule always matches (unconditional route)
    const when = rule.when;
    if (when) {
      let allMatch = true;

      // input_tokens_estimate
      if (when.input_tokens_estimate !== undefined) {
        const { op, num } = parseComparison(when.input_tokens_estimate);
        if (!applyComparison(context.inputTokensEstimate ?? 0, op, num)) {
          allMatch = false;
        }
      }

      // system_prompt_contains — ANY keyword match (case-insensitive)
      if (allMatch && when.system_prompt_contains !== undefined) {
        const prompt = (context.systemPrompt ?? '').toLowerCase();
        if (!prompt || !when.system_prompt_contains.some(kw => prompt.includes(kw.toLowerCase()))) {
          allMatch = false;
        }
      }

      // no_system_prompt_contains — NONE may appear (case-insensitive)
      if (allMatch && when.no_system_prompt_contains !== undefined) {
        const prompt = (context.systemPrompt ?? '').toLowerCase();
        if (prompt && when.no_system_prompt_contains.some(kw => prompt.includes(kw.toLowerCase()))) {
          allMatch = false;
        }
      }

      // user_prompt_contains — ANY keyword match (case-insensitive)
      if (allMatch && when.user_prompt_contains !== undefined) {
        const prompt = (context.userPrompt ?? '').toLowerCase();
        if (!prompt || !when.user_prompt_contains.some(kw => prompt.includes(kw.toLowerCase()))) {
          allMatch = false;
        }
      }

      // no_user_prompt_contains — NONE may appear (case-insensitive)
      if (allMatch && when.no_user_prompt_contains !== undefined) {
        const prompt = (context.userPrompt ?? '').toLowerCase();
        if (prompt && when.no_user_prompt_contains.some(kw => prompt.includes(kw.toLowerCase()))) {
          allMatch = false;
        }
      }

      // agent — literal or "*" wildcard
      if (allMatch && when.agent !== undefined) {
        if (when.agent !== '*' && when.agent !== context.agentId) {
          allMatch = false;
        }
      }

      // time_of_day — "HH:MM-HH:MM" range in UTC
      if (allMatch && when.time_of_day !== undefined) {
        const currentDate = now !== undefined ? new Date(now) : new Date();
        const currentHour = currentDate.getUTCHours();
        const currentMinute = currentDate.getUTCMinutes();
        const currentMinutes = currentHour * 60 + currentMinute;

        const [startStr, endStr] = when.time_of_day.split('-');
        const [startH, startM] = startStr.split(':').map(Number);
        const [endH, endM] = endStr.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        let timeMatches: boolean;
        if (endMinutes > startMinutes) {
          // Normal window: 09:00-17:00
          timeMatches = currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {
          // Overnight window: 22:00-06:00
          timeMatches = currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }

        if (!timeMatches) {
          allMatch = false;
        }
      }

      // tool_calls_present
      if (allMatch && when.tool_calls_present !== undefined) {
        if (when.tool_calls_present !== (context.toolCallsPresent ?? false)) {
          allMatch = false;
        }
      }

      // conversation_turns
      if (allMatch && when.conversation_turns !== undefined) {
        const { op, num } = parseComparison(when.conversation_turns);
        if (!applyComparison(context.conversationTurns ?? 0, op, num)) {
          allMatch = false;
        }
      }

      // provider
      if (allMatch && when.provider !== undefined) {
        if (when.provider !== context.provider) {
          allMatch = false;
        }
      }

      if (!allMatch) continue; // This rule does not match, try next
    }

    // Rule matched — resolve route_to through model_aliases
    let resolvedModel = rule.route_to;
    const aliases = policy.model_aliases;
    const isAlias = aliases && aliases[rule.route_to] !== undefined;
    if (isAlias) {
      resolvedModel = aliases[rule.route_to];
    }

    // 4. max_downgrade_level enforcement
    if (policy.max_downgrade_level && aliases && isAlias) {
      const tierKeys = Object.keys(aliases);
      const resolvedTier = tierKeys.indexOf(rule.route_to);
      const maxTier = tierKeys.indexOf(policy.max_downgrade_level);
      if (resolvedTier !== -1 && maxTier !== -1 && resolvedTier < maxTier) {
        // Routing below max_downgrade_level — skip this rule (passthrough)
        continue;
      }
    }

    return {
      ...baseResult,
      routeTo: resolvedModel,
      matchedRuleIndex: i,
    };
  }

  // 5. No match — passthrough
  return baseResult;
}

// ─────────────────────────────────────────────────────────────
// Require approval evaluator
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate a require_approval policy against a request context.
 *
 * Uses the same AND-match logic as block policies. If all match criteria
 * match, returns a result with requiresApproval: true (and allowed: false
 * to signal interception). If criteria don't match, returns allowed: true
 * (pass through).
 */
function evaluateRequireApproval(
  policy: RequireApprovalPolicy,
  context: PolicyRequestContext,
): SinglePolicyResult | ApprovalPolicyResult {
  const match = policy.match;

  // No match criteria = unconditional approval requirement
  if (!match) {
    return {
      policyName: policy.name,
      policyType: 'require_approval',
      allowed: false,
      requiresApproval: true,
      timeoutSeconds: policy.timeout_seconds ?? 1800,
      storePayload: policy.store_payload ?? false,
      reason: 'Request requires human approval',
      message: policy.message,
    } as ApprovalPolicyResult;
  }

  const useRegex = match.regex === true;

  // AND logic: all specified criteria must match for approval requirement.

  if (match.provider !== undefined) {
    if (match.provider !== context.provider) {
      return { policyName: policy.name, policyType: 'require_approval', allowed: true };
    }
  }

  if (match.action_type !== undefined) {
    const actionType = inferActionType(context.path);
    if (match.action_type !== actionType) {
      return { policyName: policy.name, policyType: 'require_approval', allowed: true };
    }
  }

  if (match.model !== undefined) {
    const contextModel = context.model ?? '';
    if (useRegex) {
      if (!new RegExp(match.model).test(contextModel)) {
        return { policyName: policy.name, policyType: 'require_approval', allowed: true };
      }
    } else {
      if (match.model !== contextModel) {
        return { policyName: policy.name, policyType: 'require_approval', allowed: true };
      }
    }
  }

  if (match.path !== undefined) {
    if (useRegex) {
      if (!new RegExp(match.path).test(context.path)) {
        return { policyName: policy.name, policyType: 'require_approval', allowed: true };
      }
    } else {
      if (match.path !== context.path) {
        return { policyName: policy.name, policyType: 'require_approval', allowed: true };
      }
    }
  }

  // All criteria matched -> requires approval
  return {
    policyName: policy.name,
    policyType: 'require_approval',
    allowed: false,
    requiresApproval: true,
    timeoutSeconds: policy.timeout_seconds ?? 1800,
    storePayload: policy.store_payload ?? false,
    reason: 'Request requires human approval',
    message: policy.message,
  } as ApprovalPolicyResult;
}

/**
 * Dispatch to the correct type-specific evaluator for a policy.
 */
function evaluatePolicy(
  policy: Policy,
  context: PolicyRequestContext,
  rateLimitStore: RateLimitStore,
  costAggregator?: CostAggregator,
  now?: number,
): SinglePolicyResult {
  switch (policy.type) {
    case 'block':
      return evaluateBlock(policy, context);
    case 'rate_limit':
      return evaluateRateLimit(policy, context, rateLimitStore, now);
    case 'budget_limit':
      return evaluateBudgetLimit(policy, context, costAggregator);
    case 'content_filter':
      return evaluateContentFilter(policy, context);
    case 'time_window':
      return evaluateTimeWindow(policy, context, now !== undefined ? new Date(now) : undefined);
    case 'model_route':
      return evaluateModelRoute(policy, context, now);
    case 'require_approval':
      return evaluateRequireApproval(policy, context);
  }
}

export class PolicyEngine {
  private policies: Policy[] = [];
  private rateLimitStore = new RateLimitStore();
  private costAggregator?: CostAggregator;

  /**
   * Set the CostAggregator dependency for budget limit evaluation.
   * If not set, budget limit policies will allow all requests.
   */
  setCostAggregator(aggregator: CostAggregator): void {
    this.costAggregator = aggregator;
  }

  /**
   * Parse a YAML string and load the resulting policies into memory.
   * Returns the parse result so callers can inspect errors/warnings.
   */
  loadFromYaml(yamlString: string): PolicyParseResult {
    const result = parsePolicies(yamlString);
    if (result.success) {
      this.policies = result.policies;
    }
    return result;
  }

  /**
   * Read and parse a YAML policy file from disk, loading the resulting policies
   * into memory. Returns the parse result so callers can inspect errors/warnings.
   */
  loadFromFile(filePath: string): PolicyParseResult {
    const result = parsePoliciesFromFile(filePath);
    if (result.success) {
      this.policies = result.policies;
    }
    return result;
  }

  /**
   * Load pre-parsed policies directly into memory.
   * Useful for testing and programmatic policy creation.
   */
  loadFromPolicies(policies: Policy[]): void {
    this.policies = [...policies];
  }

  /** Remove all loaded policies and reset rate limit state. */
  clearPolicies(): void {
    this.policies = [];
    this.rateLimitStore.clear();
  }

  /** Return all loaded policies. */
  getPolicies(): Policy[] {
    return this.policies;
  }

  /** Return policies filtered by type. */
  getPoliciesByType(type: PolicyType): Policy[] {
    return this.policies.filter((p) => p.type === type);
  }

  /**
   * Evaluate all matching policies against a request context.
   *
   * 1. Filter to enabled policies
   * 2. Check scope match for each
   * 3. Evaluate matching policies with type-specific evaluators
   * 4. Apply most-restrictive-wins: any deny -> overall denied
   * 5. Return structured result with timing
   *
   * @param context - The request context to evaluate against
   * @param options - Optional evaluation settings (e.g., injectable timestamp for testing)
   */
  evaluate(context: PolicyRequestContext, options?: EvaluateOptions): PolicyEvaluationResult {
    const start = performance.now();
    const now = options?.now;

    const results: SinglePolicyResult[] = [];
    let evaluatedCount = 0;
    let matchedCount = 0;
    let denied: SinglePolicyResult | undefined;

    for (let i = 0; i < this.policies.length; i++) {
      const policy = this.policies[i];

      // Skip disabled policies
      if (!policy.enabled) continue;

      evaluatedCount++;

      // Check scope match
      if (!scopeMatches(policy.scope, context)) continue;

      matchedCount++;

      // Evaluate the policy with type-specific evaluator
      const singleResult = evaluatePolicy(
        policy,
        context,
        this.rateLimitStore,
        this.costAggregator,
        now,
      );
      results.push(singleResult);

      // Track first denial (most-restrictive-wins).
      // require_approval results have allowed=false but are NOT denials —
      // they signal "hold for approval". Only track non-approval denials here.
      if (!singleResult.allowed && denied === undefined) {
        const isApprovalHold = singleResult.policyType === 'require_approval'
          && (singleResult as ApprovalPolicyResult).requiresApproval;
        if (!isApprovalHold) {
          denied = singleResult;
        }
      }
    }

    const evaluationTimeMs = performance.now() - start;

    // If a real deny policy triggered, that takes precedence over any approval holds.
    // The caller checks results for require_approval only when allowed=true (no denials).
    return {
      allowed: denied === undefined,
      evaluatedCount,
      matchedCount,
      denied,
      results,
      evaluationTimeMs,
    };
  }
}
