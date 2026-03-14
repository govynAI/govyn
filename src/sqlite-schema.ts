export interface SqliteMigration {
  version: number;
  name: string;
  sql: string;
}

export const SQLITE_MIGRATIONS: SqliteMigration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS cost_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        input_cost REAL NOT NULL,
        output_cost REAL NOT NULL,
        total_cost REAL NOT NULL,
        priced INTEGER NOT NULL DEFAULT 1,
        requested_model TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_cost_records_agent_created ON cost_records (agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cost_records_created ON cost_records (created_at);
      CREATE INDEX IF NOT EXISTS idx_cost_records_model ON cost_records (model);

      CREATE TABLE IF NOT EXISTS policy_evaluations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        path TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        evaluated_count INTEGER NOT NULL DEFAULT 0,
        matched_count INTEGER NOT NULL DEFAULT 0,
        denied_by TEXT,
        denied_reason TEXT,
        evaluation_time_ms REAL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_policy_evals_agent_created ON policy_evaluations (agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_policy_evals_created ON policy_evaluations (created_at);

      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        target_path TEXT NOT NULL,
        policy_name TEXT NOT NULL,
        policy_rule TEXT,
        estimated_cost REAL,
        request_summary TEXT,
        request_payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'denied', 'denied_timeout')),
        decided_by TEXT,
        decision_notes TEXT,
        decided_at TEXT,
        timeout_seconds INTEGER NOT NULL DEFAULT 1800,
        expires_at TEXT NOT NULL,
        approval_token TEXT,
        token_used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests (status);
      CREATE INDEX IF NOT EXISTS idx_approvals_agent_created ON approval_requests (agent_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_expires ON approval_requests (expires_at) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS idx_approvals_token ON approval_requests (approval_token) WHERE approval_token IS NOT NULL;

      CREATE TABLE IF NOT EXISTS cost_daily_summary (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        date TEXT NOT NULL,
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_input_tokens INTEGER NOT NULL DEFAULT 0,
        total_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_input_cost REAL NOT NULL DEFAULT 0,
        total_output_cost REAL NOT NULL DEFAULT 0,
        total_cost REAL NOT NULL DEFAULT 0,
        UNIQUE (agent_id, model, provider, date)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_summary_agent_date ON cost_daily_summary (agent_id, date);
    `,
  },
  {
    version: 2,
    name: 'alert_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('budget_threshold', 'policy_trigger')),
        enabled INTEGER NOT NULL DEFAULT 1,
        config TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60,
        last_fired_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules (type);
      CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = 1;

      CREATE TABLE IF NOT EXISTS alert_history (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_payload TEXT NOT NULL,
        webhook_url TEXT NOT NULL,
        webhook_status INTEGER,
        webhook_error TEXT,
        fired_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history (rule_id, fired_at);
      CREATE INDEX IF NOT EXISTS idx_alert_history_fired ON alert_history (fired_at);
    `,
  },
  {
    version: 3,
    name: 'approval_request_binding',
    sql: `
      ALTER TABLE approval_requests ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS idx_approvals_request_hash ON approval_requests (request_hash);
    `,
  },
];
