/**
 * SQL schema definitions and versioned migration statements for the Govyn proxy.
 *
 * Migrations are applied in order by the migration runner (src/db.ts).
 * Each migration runs inside a transaction and is tracked in govyn_migrations.
 */

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ordered array of database migrations.
 * New migrations are appended with incrementing version numbers.
 * NEVER modify or reorder existing migrations — append only.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      -- Migrations tracking table
      CREATE TABLE IF NOT EXISTS govyn_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Cost records table
      CREATE TABLE IF NOT EXISTS cost_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        input_cost NUMERIC(12,8) NOT NULL,
        output_cost NUMERIC(12,8) NOT NULL,
        total_cost NUMERIC(12,8) NOT NULL,
        priced BOOLEAN NOT NULL DEFAULT true,
        requested_model TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Indexes for time-windowed aggregation queries (DATA-02)
      CREATE INDEX idx_cost_records_agent_created ON cost_records (agent_id, created_at);
      CREATE INDEX idx_cost_records_created ON cost_records (created_at);
      CREATE INDEX idx_cost_records_model ON cost_records (model);

      -- Policy evaluation log table
      CREATE TABLE IF NOT EXISTS policy_evaluations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        path TEXT NOT NULL,
        allowed BOOLEAN NOT NULL,
        evaluated_count INTEGER NOT NULL DEFAULT 0,
        matched_count INTEGER NOT NULL DEFAULT 0,
        denied_by TEXT,
        denied_reason TEXT,
        evaluation_time_ms REAL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_policy_evals_agent_created ON policy_evaluations (agent_id, created_at);
      CREATE INDEX idx_policy_evals_created ON policy_evaluations (created_at);

      -- Approval requests table (foundation for Plan 02)
      CREATE TABLE IF NOT EXISTS approval_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        target_path TEXT NOT NULL,
        policy_name TEXT NOT NULL,
        policy_rule TEXT,
        estimated_cost NUMERIC(12,8),
        request_summary TEXT,
        request_payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'denied', 'denied_timeout')),
        decided_by TEXT,
        decision_notes TEXT,
        decided_at TIMESTAMPTZ,
        timeout_seconds INTEGER NOT NULL DEFAULT 1800,
        expires_at TIMESTAMPTZ NOT NULL,
        approval_token UUID,
        token_used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_approvals_status ON approval_requests (status);
      CREATE INDEX idx_approvals_agent_created ON approval_requests (agent_id, created_at);
      CREATE INDEX idx_approvals_expires ON approval_requests (expires_at) WHERE status = 'pending';
      CREATE INDEX idx_approvals_token ON approval_requests (approval_token) WHERE approval_token IS NOT NULL;

      -- Daily cost summary table for retention aggregation
      CREATE TABLE IF NOT EXISTS cost_daily_summary (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        date DATE NOT NULL,
        total_requests INTEGER NOT NULL DEFAULT 0,
        total_input_tokens BIGINT NOT NULL DEFAULT 0,
        total_output_tokens BIGINT NOT NULL DEFAULT 0,
        total_input_cost NUMERIC(12,8) NOT NULL DEFAULT 0,
        total_output_cost NUMERIC(12,8) NOT NULL DEFAULT 0,
        total_cost NUMERIC(12,8) NOT NULL DEFAULT 0,
        UNIQUE (agent_id, model, provider, date)
      );

      CREATE INDEX idx_daily_summary_agent_date ON cost_daily_summary (agent_id, date);
    `,
  },
  {
    version: 2,
    name: 'alert_tables',
    sql: `
      CREATE TABLE IF NOT EXISTS alert_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('budget_threshold', 'policy_trigger')),
        enabled BOOLEAN NOT NULL DEFAULT true,
        config JSONB NOT NULL,
        webhook_url TEXT NOT NULL,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60,
        last_fired_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_alert_rules_type ON alert_rules (type);
      CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = true;

      CREATE TABLE IF NOT EXISTS alert_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_payload JSONB NOT NULL,
        webhook_url TEXT NOT NULL,
        webhook_status INTEGER,
        webhook_error TEXT,
        fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_alert_history_rule ON alert_history (rule_id, fired_at);
      CREATE INDEX idx_alert_history_fired ON alert_history (fired_at);
    `,
  },
];
