/**
 * TypeScript types mirroring the Govyn proxy API response shapes.
 *
 * These types match the JSON returned by /api/costs and /api/budgets
 * endpoints on the proxy server.
 */

/** Dashboard-facing period options shown in the UI */
export type DashboardPeriod = "today" | "7d" | "30d" | "all";

/** Map a dashboard period label to the API query parameter value */
export function toApiPeriod(period: DashboardPeriod): string {
  switch (period) {
    case "today":
      return "today";
    case "7d":
      return "week";
    case "30d":
      return "month";
    case "all":
      return "all";
  }
}

/** Per-model cost and token breakdown */
export interface ModelBreakdown {
  cost: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Per-agent cost summary (element of CostsApiResponse.agents) */
export interface AgentCostSummary {
  agentId: string;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  models: Record<string, ModelBreakdown>;
}

/** Response shape of GET /api/costs */
export interface CostsApiResponse {
  period: string;
  generated_at: string;
  agents: AgentCostSummary[];
  models: Record<string, ModelBreakdown>;
  unpriced_models: string[];
  totals: {
    cost: number;
    requests: number;
    input_tokens: number;
    output_tokens: number;
  };
}

export interface CostTimeSeriesPoint {
  timestamp: string;
  label: string;
  total: number;
  agents: Record<string, number>;
}

export interface CostTimeSeriesApiResponse {
  period: string;
  bucket: "hour" | "day" | "month";
  generated_at: string;
  points: CostTimeSeriesPoint[];
}

/** Budget status for a single period (daily or monthly) */
export interface BudgetPeriodStatus {
  limit: number | null;
  spent: number;
  remaining: number | null;
  percentUsed: number | null;
  resetsAt: string;
}

/** Budget status for a single agent (element of /api/budgets response) */
export interface BudgetStatus {
  agentId: string;
  daily: BudgetPeriodStatus;
  monthly: BudgetPeriodStatus;
  limitType: "hard" | "soft";
  blocked: boolean;
}

/** Policy type union matching proxy PolicyType */
export type PolicyType =
  | "block"
  | "rate_limit"
  | "budget_limit"
  | "content_filter"
  | "time_window"
  | "model_route"
  | "require_approval";

/** Policy scope from the proxy */
export interface PolicyScope {
  level: "global" | "agent" | "target";
  value?: string;
}

/** Summary of a policy as returned by GET /api/policies */
export interface PolicySummary {
  name: string;
  type: PolicyType;
  scope: PolicyScope;
  enabled: boolean;
  description?: string;
}

/** Full policy detail as returned by GET /api/policies/:name */
export interface PolicyDetail extends PolicySummary {
  yaml: string;
  [key: string]: unknown;
}

/** Error from policy validation */
export interface PolicyValidationError {
  message: string;
  line?: number;
  column?: number;
  policyName?: string;
}

/** Approval request status from the proxy */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'denied_timeout';

/** Approval request as returned by GET /api/approvals */
export interface ApprovalRequest {
  id: string;
  agent_id: string;
  provider: string;
  model: string | null;
  target_path: string;
  policy_name: string;
  estimated_cost: number | null;
  request_summary: string | null;
  status: ApprovalStatus;
  decided_by: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
}

/** Response shape of GET /api/approvals */
export interface ApprovalsApiResponse {
  approvals: ApprovalRequest[];
  total: number;
  limit: number;
  offset: number;
  available?: boolean;
  reason?: string;
}

/** Alert rule type */
export type AlertRuleType = 'budget_threshold' | 'policy_trigger';

/** Budget threshold alert config */
export interface BudgetThresholdConfig {
  agent_id: string;
  metric: 'daily' | 'monthly';
  threshold_percent: number;
}

/** Policy trigger alert config */
export interface PolicyTriggerConfig {
  policy_name: string;
  agent_id: string;
}

/** Alert rule as returned by GET /api/alerts/rules */
export interface AlertRule {
  id: string;
  name: string;
  type: AlertRuleType;
  enabled: boolean;
  config: BudgetThresholdConfig | PolicyTriggerConfig;
  webhook_url: string;
  cooldown_minutes: number;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload for creating a new alert rule */
export interface AlertRuleCreatePayload {
  name: string;
  type: AlertRuleType;
  config: BudgetThresholdConfig | PolicyTriggerConfig;
  webhook_url: string;
  cooldown_minutes?: number;
  enabled?: boolean;
}

/** Alert history entry as returned by GET /api/alerts/history */
export interface AlertHistoryEntry {
  id: string;
  rule_id: string;
  rule_name: string;
  rule_type: AlertRuleType;
  event_type: string;
  event_payload: Record<string, unknown>;
  webhook_url: string;
  webhook_status: number | null;
  webhook_error: string | null;
  fired_at: string;
}

/** Response shape of GET /api/alerts/rules */
export interface AlertRulesApiResponse {
  rules: AlertRule[];
  available?: boolean;
  reason?: string;
}

/** Response shape of GET /api/alerts/history */
export interface AlertHistoryApiResponse {
  alerts: AlertHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
  available?: boolean;
  reason?: string;
}
