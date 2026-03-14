import type { CostRecord } from './types.js';

export interface PolicyEvaluationRecord {
  agentId: string;
  provider: string;
  path: string;
  allowed: boolean;
  evaluatedCount: number;
  matchedCount: number;
  deniedBy?: string;
  deniedReason?: string;
  evaluationTimeMs?: number;
}

export interface ApprovalStatusRecord {
  id: string;
  status: 'pending' | 'approved' | 'denied' | 'denied_timeout';
  approvalToken?: string;
  decidedAt?: string;
  expiresAt: string;
}

export interface ApprovalListEntry {
  id: string;
  agent_id: string;
  provider: string;
  model: string | null;
  target_path: string;
  policy_name: string;
  estimated_cost: number | null;
  request_summary: string | null;
  status: 'pending' | 'approved' | 'denied' | 'denied_timeout';
  decided_by: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface ApprovalListResult {
  approvals: ApprovalListEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApprovalStore {
  createApprovalRequest(params: {
    agentId: string;
    provider: string;
    model?: string;
    targetPath: string;
    policyName: string;
    policyRule?: string;
    estimatedCost?: number;
    requestSummary: string;
    requestHash: string;
    requestPayload?: unknown;
    timeoutSeconds: number;
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }>;
  getApprovalStatus(id: string): Promise<ApprovalStatusRecord | null>;
  validateAndConsumeToken(
    token: string,
    expected: { agentId: string; targetPath: string; requestHash: string },
  ): Promise<{ policyName: string } | null>;
  approveRequest(id: string, decidedBy: string, notes?: string): Promise<boolean>;
  denyRequest(id: string, decidedBy: string, notes?: string): Promise<boolean>;
  listApprovals(
    statusFilters: string[],
    limit: number,
    offset: number,
    agentId: string | null,
  ): Promise<ApprovalListResult>;
  expireTimedOutApprovals(now?: Date): Promise<number>;
}

export interface BudgetThresholdConfig {
  agent_id: string;
  metric: 'daily' | 'monthly';
  threshold_percent: number;
}

export interface PolicyTriggerConfig {
  policy_name: string;
  agent_id: string;
}

export interface AlertRuleRecord {
  id: string;
  name: string;
  type: 'budget_threshold' | 'policy_trigger';
  enabled: boolean;
  config: BudgetThresholdConfig | PolicyTriggerConfig;
  webhookUrl: string;
  cooldownMinutes: number;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertHistoryEntry {
  id: string;
  rule_id: string;
  rule_name: string;
  rule_type: string;
  event_type: string;
  event_payload: Record<string, unknown>;
  webhook_url: string;
  webhook_status: number | null;
  webhook_error: string | null;
  fired_at: string;
}

export interface AlertHistoryResult {
  alerts: AlertHistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AlertStore {
  listRules(): Promise<AlertRuleRecord[]>;
  createRule(input: {
    name: string;
    type: 'budget_threshold' | 'policy_trigger';
    enabled: boolean;
    config: BudgetThresholdConfig | PolicyTriggerConfig;
    webhookUrl: string;
    cooldownMinutes: number;
  }): Promise<AlertRuleRecord>;
  updateRule(input: {
    id: string;
    name?: string;
    enabled?: boolean;
    config?: BudgetThresholdConfig | PolicyTriggerConfig;
    webhookUrl?: string;
    cooldownMinutes?: number;
  }): Promise<AlertRuleRecord | null>;
  deleteRule(id: string): Promise<boolean>;
  listHistory(limit: number, offset: number, ruleId?: string | null): Promise<AlertHistoryResult>;
  recordAlertHistory(input: {
    ruleId: string;
    ruleName: string;
    ruleType: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    webhookUrl: string;
    webhookStatus: number | null;
    webhookError: string | null;
  }): Promise<void>;
  touchRuleLastFired(id: string, firedAt: Date): Promise<void>;
}

export interface PersistenceWriterStore {
  insertCostRecord(record: CostRecord): Promise<void>;
  insertPolicyEvaluation(record: PolicyEvaluationRecord): Promise<void>;
  insertApprovalEvent(event: {
    requestId: string;
    action: 'created' | 'approved' | 'denied' | 'denied_timeout' | 'token_consumed';
    decidedBy?: string;
    notes?: string;
  }): Promise<void>;
  ping(): Promise<void>;
}

export interface RetentionStore {
  cleanupCostRecords(cutoff: Date): Promise<{ aggregated: number; deleted: number }>;
  cleanupPolicyEvaluations(cutoff: Date): Promise<number>;
  cleanupApprovalRecords(cutoff: Date): Promise<number>;
}

export interface PersistenceCloser {
  close(): Promise<void>;
}
