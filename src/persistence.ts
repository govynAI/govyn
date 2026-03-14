import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import DatabaseConstructor from 'better-sqlite3';
import type Database from 'better-sqlite3';
import postgres from 'postgres';
import { createPool, runMigrations } from './db.js';
import { getDatabaseKind, sqlitePathFromUrl } from './database-url.js';
import type {
  AlertHistoryResult,
  AlertRuleRecord,
  ApprovalListResult,
  ApprovalStatusRecord,
  ApprovalStore,
  AlertStore,
  PersistenceCloser,
  PersistenceWriterStore,
  PolicyEvaluationRecord,
  RetentionStore,
} from './persistence-types.js';
import { SQLITE_MIGRATIONS } from './sqlite-schema.js';
import type { CostRecord, DatabaseConfig } from './types.js';

type SqliteRow = Record<string, unknown>;
type AlertRuleType = 'budget_threshold' | 'policy_trigger';

export interface PersistenceBackend extends
  ApprovalStore,
  AlertStore,
  PersistenceWriterStore,
  RetentionStore,
  PersistenceCloser {
  readonly kind: 'sqlite' | 'postgres';
  readonly url: string;
}

export function isPostgresSql(value: unknown): value is postgres.Sql {
  return typeof value === 'function';
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function booleanFromUnknown(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return value === '1' || value.toLowerCase() === 'true';
  }
  return false;
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonValue<T>(value: unknown): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value as T;
}

function mapAlertRuleRow(row: SqliteRow): AlertRuleRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type) as AlertRuleType,
    enabled: booleanFromUnknown(row.enabled),
    config: parseJsonValue(row.config),
    webhookUrl: String(row.webhook_url),
    cooldownMinutes: Number(row.cooldown_minutes),
    lastFiredAt: row.last_fired_at ? new Date(String(row.last_fired_at)) : null,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function mapApprovalListRow(row: SqliteRow): ApprovalListResult['approvals'][number] {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    provider: String(row.provider),
    model: row.model == null ? null : String(row.model),
    target_path: String(row.target_path),
    policy_name: String(row.policy_name),
    estimated_cost: numberFromUnknown(row.estimated_cost),
    request_summary: row.request_summary == null ? null : String(row.request_summary),
    status: String(row.status) as ApprovalStatusRecord['status'],
    decided_by: row.decided_by == null ? null : String(row.decided_by),
    decision_notes: row.decision_notes == null ? null : String(row.decision_notes),
    decided_at: isoTimestamp(row.decided_at),
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
  };
}

function mapAlertHistoryRow(row: SqliteRow): AlertHistoryResult['alerts'][number] {
  return {
    id: String(row.id),
    rule_id: String(row.rule_id),
    rule_name: String(row.rule_name),
    rule_type: String(row.rule_type),
    event_type: String(row.event_type),
    event_payload: parseJsonValue<Record<string, unknown>>(row.event_payload),
    webhook_url: String(row.webhook_url),
    webhook_status: row.webhook_status == null ? null : Number(row.webhook_status),
    webhook_error: row.webhook_error == null ? null : String(row.webhook_error),
    fired_at: String(row.fired_at),
  };
}

function runSqliteMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS govyn_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const appliedRows = db.prepare('SELECT version FROM govyn_migrations ORDER BY version').all() as SqliteRow[];
  const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));

  for (const migration of SQLITE_MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const transaction = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT OR IGNORE INTO govyn_migrations (version, name) VALUES (?, ?)',
      ).run(migration.version, migration.name);
    });
    transaction();
    console.log(`[govyn] Applied SQLite migration v${migration.version}: ${migration.name}`);
  }
}

export class PostgresPersistence implements PersistenceBackend {
  readonly kind = 'postgres' as const;

  constructor(
    private readonly sql: postgres.Sql,
    readonly url: string,
    private readonly retentionDays: number,
    private readonly approvalRetentionDays: number,
  ) {}

  static async connect(config: DatabaseConfig): Promise<PostgresPersistence> {
    const sql = createPool(config.url);
    await runMigrations(sql);
    return new PostgresPersistence(sql, config.url, config.retentionDays, config.approvalRetentionDays);
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  async ping(): Promise<void> {
    await this.sql`SELECT 1`;
  }

  async insertCostRecord(record: CostRecord): Promise<void> {
    await this.sql`
      INSERT INTO cost_records (agent_id, model, provider, input_tokens, output_tokens, input_cost, output_cost, total_cost, priced, requested_model, created_at)
      VALUES (${record.agentId}, ${record.model}, ${record.provider}, ${record.inputTokens}, ${record.outputTokens}, ${record.inputCost}, ${record.outputCost}, ${record.totalCost}, ${record.priced}, ${record.requestedModel ?? null}, ${new Date(record.timestamp)})
    `;
  }

  async insertPolicyEvaluation(record: PolicyEvaluationRecord): Promise<void> {
    await this.sql`
      INSERT INTO policy_evaluations (agent_id, provider, path, allowed, evaluated_count, matched_count, denied_by, denied_reason, evaluation_time_ms)
      VALUES (${record.agentId}, ${record.provider}, ${record.path}, ${record.allowed}, ${record.evaluatedCount}, ${record.matchedCount}, ${record.deniedBy ?? null}, ${record.deniedReason ?? null}, ${record.evaluationTimeMs ?? null})
    `;
  }

  async insertApprovalEvent(event: {
    requestId: string;
    action: 'created' | 'approved' | 'denied' | 'denied_timeout' | 'token_consumed';
    decidedBy?: string;
    notes?: string;
  }): Promise<void> {
    await this.sql`
      INSERT INTO policy_evaluations (agent_id, provider, path, allowed, evaluated_count, matched_count, denied_by, denied_reason, evaluation_time_ms)
      VALUES (${'approval:' + event.requestId}, ${'approval'}, ${event.action}, ${event.action === 'approved' || event.action === 'token_consumed'}, ${0}, ${0}, ${event.decidedBy ?? null}, ${event.notes ?? null}, ${null})
    `;
  }

  async createApprovalRequest(params: {
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
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + params.timeoutSeconds * 1000);
    const [row] = await this.sql`
      INSERT INTO approval_requests (
        agent_id, provider, model, target_path, policy_name, policy_rule,
        estimated_cost, request_summary, request_hash, request_payload,
        timeout_seconds, expires_at
      ) VALUES (
        ${params.agentId}, ${params.provider}, ${params.model ?? null},
        ${params.targetPath}, ${params.policyName}, ${params.policyRule ?? null},
        ${params.estimatedCost ?? null}, ${params.requestSummary}, ${params.requestHash},
        ${params.requestPayload ? JSON.stringify(params.requestPayload) : null},
        ${params.timeoutSeconds}, ${expiresAt}
      ) RETURNING id, expires_at
    `;
    return {
      id: String(row.id),
      pollingUrl: `/api/approvals/${row.id}`,
      expiresAt: (row.expires_at as Date).toISOString(),
    };
  }

  async getApprovalStatus(id: string): Promise<ApprovalStatusRecord | null> {
    const [row] = await this.sql`
      SELECT id, status, approval_token, decided_at, expires_at
      FROM approval_requests
      WHERE id = ${id}
    `;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      status: String(row.status) as ApprovalStatusRecord['status'],
      approvalToken: String(row.status) === 'approved' ? String(row.approval_token) : undefined,
      decidedAt: row.decided_at ? (row.decided_at as Date).toISOString() : undefined,
      expiresAt: (row.expires_at as Date).toISOString(),
    };
  }

  async validateAndConsumeToken(
    token: string,
    expected: { agentId: string; targetPath: string; requestHash: string },
  ): Promise<{ policyName: string } | null> {
    const [row] = await this.sql`
      UPDATE approval_requests
      SET token_used = true
      WHERE approval_token = ${token}
        AND status = 'approved'
        AND token_used = false
        AND agent_id = ${expected.agentId}
        AND target_path = ${expected.targetPath}
        AND request_hash = ${expected.requestHash}
      RETURNING policy_name
    `;
    if (!row) {
      return null;
    }
    return { policyName: String(row.policy_name) };
  }

  async approveRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const approvalToken = crypto.randomUUID();
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = ${decidedBy},
          decision_notes = ${notes ?? null},
          decided_at = NOW(),
          approval_token = ${approvalToken}
      WHERE id = ${id} AND status = 'pending'
    `;
    return result.count > 0;
  }

  async denyRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'denied',
          decided_by = ${decidedBy},
          decision_notes = ${notes ?? null},
          decided_at = NOW()
      WHERE id = ${id} AND status = 'pending'
    `;
    return result.count > 0;
  }

  async listApprovals(
    statusFilters: string[],
    limit: number,
    offset: number,
    agentId: string | null,
  ): Promise<ApprovalListResult> {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let paramIndex = 1;

    if (statusFilters.length > 0) {
      const placeholders = statusFilters.map((_, index) => `$${paramIndex + index}`).join(', ');
      conditions.push(`status IN (${placeholders})`);
      values.push(...statusFilters);
      paramIndex += statusFilters.length;
    }

    if (agentId) {
      conditions.push(`agent_id = $${paramIndex}`);
      values.push(agentId);
      paramIndex += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = await this.sql.unsafe(
      `SELECT COUNT(*)::int AS total FROM approval_requests ${whereClause}`,
      values,
    );
    const total = Number(countRows[0]?.total ?? 0);

    const rows = await this.sql.unsafe(
      `
        SELECT
          id, agent_id, provider, model, target_path, policy_name,
          estimated_cost, request_summary, status, decided_by,
          decision_notes, decided_at, expires_at, created_at
        FROM approval_requests
        ${whereClause}
        ORDER BY
          CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
          CASE WHEN status = 'pending' THEN created_at END ASC,
          decided_at DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...values, limit, offset],
    );

    return {
      approvals: (rows as SqliteRow[]).map(mapApprovalListRow),
      total,
      limit,
      offset,
    };
  }

  async expireTimedOutApprovals(now = new Date()): Promise<number> {
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'denied_timeout', decided_at = ${now}
      WHERE status = 'pending' AND expires_at < ${now}
    `;
    return result.count;
  }

  async listRules(): Promise<AlertRuleRecord[]> {
    const rows = await this.sql`SELECT * FROM alert_rules ORDER BY created_at DESC`;
    return (rows as SqliteRow[]).map(mapAlertRuleRow);
  }

  async createRule(input: {
    name: string;
    type: AlertRuleType;
    enabled: boolean;
    config: AlertRuleRecord['config'];
    webhookUrl: string;
    cooldownMinutes: number;
  }): Promise<AlertRuleRecord> {
    const [row] = await this.sql`
      INSERT INTO alert_rules (name, type, enabled, config, webhook_url, cooldown_minutes)
      VALUES (${input.name}, ${input.type}, ${input.enabled}, ${JSON.stringify(input.config)}, ${input.webhookUrl}, ${input.cooldownMinutes})
      RETURNING *
    `;
    return mapAlertRuleRow(row as SqliteRow);
  }

  async updateRule(input: {
    id: string;
    name?: string;
    enabled?: boolean;
    config?: AlertRuleRecord['config'];
    webhookUrl?: string;
    cooldownMinutes?: number;
  }): Promise<AlertRuleRecord | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex++}`);
      values.push(input.enabled);
    }
    if (input.config !== undefined) {
      setClauses.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(input.config));
    }
    if (input.webhookUrl !== undefined) {
      setClauses.push(`webhook_url = $${paramIndex++}`);
      values.push(input.webhookUrl);
    }
    if (input.cooldownMinutes !== undefined) {
      setClauses.push(`cooldown_minutes = $${paramIndex++}`);
      values.push(input.cooldownMinutes);
    }
    if (setClauses.length === 0) {
      return null;
    }

    setClauses.push('updated_at = NOW()');
    values.push(input.id);
    const rows = await this.sql.unsafe(
      `UPDATE alert_rules SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values as (string | number | boolean)[],
    );
    if (rows.length === 0) {
      return null;
    }
    return mapAlertRuleRow(rows[0] as SqliteRow);
  }

  async deleteRule(id: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM alert_rules WHERE id = ${id} RETURNING id`;
    return rows.length > 0;
  }

  async listHistory(limit: number, offset: number, ruleId?: string | null): Promise<AlertHistoryResult> {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    let paramIndex = 1;

    if (ruleId) {
      conditions.push(`rule_id = $${paramIndex}`);
      values.push(ruleId);
      paramIndex += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = await this.sql.unsafe(
      `SELECT COUNT(*)::int AS total FROM alert_history ${whereClause}`,
      values,
    );
    const rows = await this.sql.unsafe(
      `
        SELECT * FROM alert_history
        ${whereClause}
        ORDER BY fired_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...values, limit, offset],
    );

    return {
      alerts: (rows as SqliteRow[]).map(mapAlertHistoryRow),
      total: Number(countRows[0]?.total ?? 0),
      limit,
      offset,
    };
  }

  async recordAlertHistory(input: {
    ruleId: string;
    ruleName: string;
    ruleType: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    webhookUrl: string;
    webhookStatus: number | null;
    webhookError: string | null;
  }): Promise<void> {
    await this.sql`
      INSERT INTO alert_history (rule_id, rule_name, rule_type, event_type, event_payload, webhook_url, webhook_status, webhook_error)
      VALUES (${input.ruleId}, ${input.ruleName}, ${input.ruleType}, ${input.eventType}, ${JSON.stringify(input.eventPayload)}, ${input.webhookUrl}, ${input.webhookStatus}, ${input.webhookError})
    `;
  }

  async touchRuleLastFired(id: string, firedAt: Date): Promise<void> {
    await this.sql`
      UPDATE alert_rules SET last_fired_at = ${firedAt}, updated_at = NOW() WHERE id = ${id}
    `;
  }

  async cleanupCostRecords(cutoff: Date): Promise<{ aggregated: number; deleted: number }> {
    const aggregateResult = await this.sql`
      INSERT INTO cost_daily_summary (agent_id, model, provider, date, total_requests, total_input_tokens, total_output_tokens, total_input_cost, total_output_cost, total_cost)
      SELECT
        agent_id,
        model,
        provider,
        DATE(created_at) as date,
        COUNT(*)::INTEGER as total_requests,
        SUM(input_tokens)::BIGINT as total_input_tokens,
        SUM(output_tokens)::BIGINT as total_output_tokens,
        SUM(input_cost) as total_input_cost,
        SUM(output_cost) as total_output_cost,
        SUM(total_cost) as total_cost
      FROM cost_records
      WHERE created_at < ${cutoff}
      GROUP BY agent_id, model, provider, DATE(created_at)
      ON CONFLICT (agent_id, model, provider, date) DO UPDATE SET
        total_requests = cost_daily_summary.total_requests + EXCLUDED.total_requests,
        total_input_tokens = cost_daily_summary.total_input_tokens + EXCLUDED.total_input_tokens,
        total_output_tokens = cost_daily_summary.total_output_tokens + EXCLUDED.total_output_tokens,
        total_input_cost = cost_daily_summary.total_input_cost + EXCLUDED.total_input_cost,
        total_output_cost = cost_daily_summary.total_output_cost + EXCLUDED.total_output_cost,
        total_cost = cost_daily_summary.total_cost + EXCLUDED.total_cost
    `;

    const deleteResult = await this.sql`
      DELETE FROM cost_records WHERE created_at < ${cutoff}
    `;

    return {
      aggregated: aggregateResult.count,
      deleted: deleteResult.count,
    };
  }

  async cleanupPolicyEvaluations(cutoff: Date): Promise<number> {
    const result = await this.sql`
      DELETE FROM policy_evaluations WHERE created_at < ${cutoff}
    `;
    return result.count;
  }

  async cleanupApprovalRecords(cutoff: Date): Promise<number> {
    const result = await this.sql`
      DELETE FROM approval_requests WHERE created_at < ${cutoff}
    `;
    return result.count;
  }
}

export class SqlitePersistence implements PersistenceBackend {
  readonly kind = 'sqlite' as const;

  constructor(
    private readonly db: Database.Database,
    readonly url: string,
    private readonly retentionDays: number,
    private readonly approvalRetentionDays: number,
  ) {}

  static async connect(config: DatabaseConfig): Promise<SqlitePersistence> {
    const dbPath = sqlitePathFromUrl(config.url);
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    const db = new DatabaseConstructor(dbPath);
    db.pragma('foreign_keys = ON');
    if (dbPath !== ':memory:') {
      db.pragma('journal_mode = WAL');
    }
    runSqliteMigrations(db);

    return new SqlitePersistence(db, config.url, config.retentionDays, config.approvalRetentionDays);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async ping(): Promise<void> {
    this.db.prepare('SELECT 1').get();
  }

  async insertCostRecord(record: CostRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO cost_records (
        id, agent_id, model, provider, input_tokens, output_tokens,
        input_cost, output_cost, total_cost, priced, requested_model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      record.agentId,
      record.model,
      record.provider,
      record.inputTokens,
      record.outputTokens,
      record.inputCost,
      record.outputCost,
      record.totalCost,
      record.priced ? 1 : 0,
      record.requestedModel ?? null,
      new Date(record.timestamp).toISOString(),
    );
  }

  async insertPolicyEvaluation(record: PolicyEvaluationRecord): Promise<void> {
    this.db.prepare(`
      INSERT INTO policy_evaluations (
        id, agent_id, provider, path, allowed, evaluated_count,
        matched_count, denied_by, denied_reason, evaluation_time_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      record.agentId,
      record.provider,
      record.path,
      record.allowed ? 1 : 0,
      record.evaluatedCount,
      record.matchedCount,
      record.deniedBy ?? null,
      record.deniedReason ?? null,
      record.evaluationTimeMs ?? null,
      new Date().toISOString(),
    );
  }

  async insertApprovalEvent(event: {
    requestId: string;
    action: 'created' | 'approved' | 'denied' | 'denied_timeout' | 'token_consumed';
    decidedBy?: string;
    notes?: string;
  }): Promise<void> {
    await this.insertPolicyEvaluation({
      agentId: `approval:${event.requestId}`,
      provider: 'approval',
      path: event.action,
      allowed: event.action === 'approved' || event.action === 'token_consumed',
      evaluatedCount: 0,
      matchedCount: 0,
      deniedBy: event.decidedBy,
      deniedReason: event.notes,
    });
  }

  async createApprovalRequest(params: {
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
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }> {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + params.timeoutSeconds * 1000).toISOString();
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, agent_id, provider, model, target_path, policy_name, policy_rule,
        estimated_cost, request_summary, request_hash, request_payload,
        timeout_seconds, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.agentId,
      params.provider,
      params.model ?? null,
      params.targetPath,
      params.policyName,
      params.policyRule ?? null,
      params.estimatedCost ?? null,
      params.requestSummary,
      params.requestHash,
      params.requestPayload == null ? null : JSON.stringify(params.requestPayload),
      params.timeoutSeconds,
      expiresAt,
      new Date().toISOString(),
    );
    return {
      id,
      pollingUrl: `/api/approvals/${id}`,
      expiresAt,
    };
  }

  async getApprovalStatus(id: string): Promise<ApprovalStatusRecord | null> {
    const row = this.db.prepare(`
      SELECT id, status, approval_token, decided_at, expires_at
      FROM approval_requests
      WHERE id = ?
    `).get(id) as SqliteRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: String(row.id),
      status: String(row.status) as ApprovalStatusRecord['status'],
      approvalToken: String(row.status) === 'approved' && row.approval_token
        ? String(row.approval_token)
        : undefined,
      decidedAt: isoTimestamp(row.decided_at) ?? undefined,
      expiresAt: String(row.expires_at),
    };
  }

  async validateAndConsumeToken(
    token: string,
    expected: { agentId: string; targetPath: string; requestHash: string },
  ): Promise<{ policyName: string } | null> {
    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT id, policy_name
        FROM approval_requests
        WHERE approval_token = ?
          AND status = 'approved'
          AND token_used = 0
          AND agent_id = ?
          AND target_path = ?
          AND request_hash = ?
      `).get(
        token,
        expected.agentId,
        expected.targetPath,
        expected.requestHash,
      ) as SqliteRow | undefined;

      if (!row) {
        return null;
      }

      this.db.prepare('UPDATE approval_requests SET token_used = 1 WHERE id = ?').run(String(row.id));
      return { policyName: String(row.policy_name) };
    });

    return transaction();
  }

  async approveRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = ?,
          decision_notes = ?,
          decided_at = ?,
          approval_token = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      decidedBy,
      notes ?? null,
      new Date().toISOString(),
      crypto.randomUUID(),
      id,
    );
    return result.changes > 0;
  }

  async denyRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const result = this.db.prepare(`
      UPDATE approval_requests
      SET status = 'denied',
          decided_by = ?,
          decision_notes = ?,
          decided_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      decidedBy,
      notes ?? null,
      new Date().toISOString(),
      id,
    );
    return result.changes > 0;
  }

  async listApprovals(
    statusFilters: string[],
    limit: number,
    offset: number,
    agentId: string | null,
  ): Promise<ApprovalListResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (statusFilters.length > 0) {
      conditions.push(`status IN (${statusFilters.map(() => '?').join(', ')})`);
      values.push(...statusFilters);
    }

    if (agentId) {
      conditions.push('agent_id = ?');
      values.push(agentId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS total FROM approval_requests ${whereClause}`,
    ).get(...values) as SqliteRow | undefined;

    const rows = this.db.prepare(`
      SELECT
        id, agent_id, provider, model, target_path, policy_name,
        estimated_cost, request_summary, status, decided_by,
        decision_notes, decided_at, expires_at, created_at
      FROM approval_requests
      ${whereClause}
      ORDER BY
        CASE WHEN status = 'pending' THEN 0 ELSE 1 END ASC,
        CASE WHEN status = 'pending' THEN created_at END ASC,
        CASE WHEN status = 'pending' THEN NULL ELSE decided_at END DESC,
        created_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as SqliteRow[];

    return {
      approvals: rows.map(mapApprovalListRow),
      total: Number(countRow?.total ?? 0),
      limit,
      offset,
    };
  }

  async expireTimedOutApprovals(now = new Date()): Promise<number> {
    const result = this.db.prepare(`
      UPDATE approval_requests
      SET status = 'denied_timeout', decided_at = ?
      WHERE status = 'pending' AND expires_at < ?
    `).run(now.toISOString(), now.toISOString());
    return result.changes;
  }

  async listRules(): Promise<AlertRuleRecord[]> {
    const rows = this.db.prepare(`
      SELECT * FROM alert_rules ORDER BY created_at DESC
    `).all() as SqliteRow[];
    return rows.map(mapAlertRuleRow);
  }

  async createRule(input: {
    name: string;
    type: AlertRuleType;
    enabled: boolean;
    config: AlertRuleRecord['config'];
    webhookUrl: string;
    cooldownMinutes: number;
  }): Promise<AlertRuleRecord> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO alert_rules (
        id, name, type, enabled, config, webhook_url,
        cooldown_minutes, last_fired_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.type,
      input.enabled ? 1 : 0,
      JSON.stringify(input.config),
      input.webhookUrl,
      input.cooldownMinutes,
      null,
      now,
      now,
    );
    return this.getRuleById(id) as AlertRuleRecord;
  }

  async updateRule(input: {
    id: string;
    name?: string;
    enabled?: boolean;
    config?: AlertRuleRecord['config'];
    webhookUrl?: string;
    cooldownMinutes?: number;
  }): Promise<AlertRuleRecord | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      fields.push('name = ?');
      values.push(input.name);
    }
    if (input.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }
    if (input.config !== undefined) {
      fields.push('config = ?');
      values.push(JSON.stringify(input.config));
    }
    if (input.webhookUrl !== undefined) {
      fields.push('webhook_url = ?');
      values.push(input.webhookUrl);
    }
    if (input.cooldownMinutes !== undefined) {
      fields.push('cooldown_minutes = ?');
      values.push(input.cooldownMinutes);
    }
    if (fields.length === 0) {
      return this.getRuleById(input.id);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString(), input.id);

    const result = this.db.prepare(`
      UPDATE alert_rules
      SET ${fields.join(', ')}
      WHERE id = ?
    `).run(...values);
    if (result.changes === 0) {
      return null;
    }
    return this.getRuleById(input.id);
  }

  async deleteRule(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async listHistory(limit: number, offset: number, ruleId?: string | null): Promise<AlertHistoryResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (ruleId) {
      conditions.push('rule_id = ?');
      values.push(ruleId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS total FROM alert_history ${whereClause}`,
    ).get(...values) as SqliteRow | undefined;
    const rows = this.db.prepare(`
      SELECT * FROM alert_history
      ${whereClause}
      ORDER BY fired_at DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as SqliteRow[];

    return {
      alerts: rows.map(mapAlertHistoryRow),
      total: Number(countRow?.total ?? 0),
      limit,
      offset,
    };
  }

  async recordAlertHistory(input: {
    ruleId: string;
    ruleName: string;
    ruleType: string;
    eventType: string;
    eventPayload: Record<string, unknown>;
    webhookUrl: string;
    webhookStatus: number | null;
    webhookError: string | null;
  }): Promise<void> {
    this.db.prepare(`
      INSERT INTO alert_history (
        id, rule_id, rule_name, rule_type, event_type, event_payload,
        webhook_url, webhook_status, webhook_error, fired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      input.ruleId,
      input.ruleName,
      input.ruleType,
      input.eventType,
      JSON.stringify(input.eventPayload),
      input.webhookUrl,
      input.webhookStatus,
      input.webhookError,
      new Date().toISOString(),
    );
  }

  async touchRuleLastFired(id: string, firedAt: Date): Promise<void> {
    this.db.prepare(`
      UPDATE alert_rules
      SET last_fired_at = ?, updated_at = ?
      WHERE id = ?
    `).run(firedAt.toISOString(), firedAt.toISOString(), id);
  }

  async cleanupCostRecords(cutoff: Date): Promise<{ aggregated: number; deleted: number }> {
    const cutoffIso = cutoff.toISOString();
    const transaction = this.db.transaction((deadline: string) => {
      const summaryRow = this.db.prepare(`
        SELECT COUNT(*) AS total
        FROM (
          SELECT 1
          FROM cost_records
          WHERE created_at < ?
          GROUP BY agent_id, model, provider, substr(created_at, 1, 10)
        )
      `).get(deadline) as SqliteRow | undefined;

      this.db.prepare(`
        INSERT INTO cost_daily_summary (
          id, agent_id, model, provider, date, total_requests,
          total_input_tokens, total_output_tokens, total_input_cost,
          total_output_cost, total_cost
        )
        SELECT
          hex(randomblob(16)),
          agent_id,
          model,
          provider,
          substr(created_at, 1, 10) AS date,
          COUNT(*) AS total_requests,
          SUM(input_tokens) AS total_input_tokens,
          SUM(output_tokens) AS total_output_tokens,
          SUM(input_cost) AS total_input_cost,
          SUM(output_cost) AS total_output_cost,
          SUM(total_cost) AS total_cost
        FROM cost_records
        WHERE created_at < ?
        GROUP BY agent_id, model, provider, substr(created_at, 1, 10)
        ON CONFLICT(agent_id, model, provider, date) DO UPDATE SET
          total_requests = cost_daily_summary.total_requests + excluded.total_requests,
          total_input_tokens = cost_daily_summary.total_input_tokens + excluded.total_input_tokens,
          total_output_tokens = cost_daily_summary.total_output_tokens + excluded.total_output_tokens,
          total_input_cost = cost_daily_summary.total_input_cost + excluded.total_input_cost,
          total_output_cost = cost_daily_summary.total_output_cost + excluded.total_output_cost,
          total_cost = cost_daily_summary.total_cost + excluded.total_cost
      `).run(deadline);

      const deleteResult = this.db.prepare(`
        DELETE FROM cost_records WHERE created_at < ?
      `).run(deadline);

      return {
        aggregated: Number(summaryRow?.total ?? 0),
        deleted: deleteResult.changes,
      };
    });

    return transaction(cutoffIso);
  }

  async cleanupPolicyEvaluations(cutoff: Date): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM policy_evaluations WHERE created_at < ?
    `).run(cutoff.toISOString());
    return result.changes;
  }

  async cleanupApprovalRecords(cutoff: Date): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM approval_requests WHERE created_at < ?
    `).run(cutoff.toISOString());
    return result.changes;
  }

  private getRuleById(id: string): AlertRuleRecord | null {
    const row = this.db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as SqliteRow | undefined;
    return row ? mapAlertRuleRow(row) : null;
  }
}

export async function createPersistenceBackend(config: DatabaseConfig): Promise<PersistenceBackend> {
  const kind = getDatabaseKind(config.url);
  if (kind === 'postgres') {
    return PostgresPersistence.connect(config);
  }
  return SqlitePersistence.connect(config);
}

export function adaptApprovalStore(input: ApprovalStore | postgres.Sql): ApprovalStore {
  if (isPostgresSql(input)) {
    return new PostgresPersistence(input, 'postgres://runtime', 90, 365);
  }
  return input;
}

export function adaptAlertStore(input: AlertStore | postgres.Sql): AlertStore {
  if (isPostgresSql(input)) {
    return new PostgresPersistence(input, 'postgres://runtime', 90, 365);
  }
  return input;
}

export function adaptWriterStore(input: PersistenceWriterStore | postgres.Sql): PersistenceWriterStore {
  if (isPostgresSql(input)) {
    return new PostgresPersistence(input, 'postgres://runtime', 90, 365);
  }
  return input;
}

export function adaptRetentionStore(
  input: RetentionStore | postgres.Sql,
  retentionDays: number,
  approvalRetentionDays: number,
): RetentionStore {
  if (isPostgresSql(input)) {
    return new PostgresPersistence(input, 'postgres://runtime', retentionDays, approvalRetentionDays);
  }
  return input;
}
