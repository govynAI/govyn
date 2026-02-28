/**
 * Async database writer for the Govyn proxy.
 *
 * Writes cost records and policy evaluation results to PostgreSQL.
 * All write methods are async and designed to be called fire-and-forget
 * from the proxy hot path — zero added latency to request processing.
 *
 * Supports fail-open (log errors to stderr, continue proxying) and
 * fail-closed (rethrow errors, reject requests) modes.
 */

import type postgres from 'postgres';
import type { CostRecord } from './types.js';
import { govynEvents } from './events.js';

/**
 * Policy evaluation data to be written to the database.
 */
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

/**
 * DbWriter handles async persistence of cost records and policy evaluations
 * to PostgreSQL. All writes are designed for fire-and-forget usage.
 */
export class DbWriter {
  constructor(
    private sql: postgres.Sql,
    private failOpen: boolean,
  ) {}

  /**
   * Write a cost record to the database.
   * Fire-and-forget from the proxy hot path — never blocks response delivery.
   *
   * @param record - The cost record from the in-memory aggregator
   */
  async writeCostRecord(record: CostRecord): Promise<void> {
    try {
      await this.sql`
        INSERT INTO cost_records (agent_id, model, provider, input_tokens, output_tokens, input_cost, output_cost, total_cost, priced, requested_model, created_at)
        VALUES (${record.agentId}, ${record.model}, ${record.provider}, ${record.inputTokens}, ${record.outputTokens}, ${record.inputCost}, ${record.outputCost}, ${record.totalCost}, ${record.priced}, ${record.requestedModel ?? null}, ${new Date(record.timestamp)})
      `;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      govynEvents.emit('event', {
        type: 'db_write_failed',
        table: 'cost_records',
        error: errorMsg,
      });

      if (this.failOpen) {
        process.stderr.write(`[govyn] DB write failed (fail-open): ${errorMsg}\n`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Write a policy evaluation result to the database.
   * Fire-and-forget from the proxy hot path.
   *
   * @param evalRecord - The policy evaluation data
   */
  async writePolicyEvaluation(evalRecord: PolicyEvaluationRecord): Promise<void> {
    try {
      await this.sql`
        INSERT INTO policy_evaluations (agent_id, provider, path, allowed, evaluated_count, matched_count, denied_by, denied_reason, evaluation_time_ms)
        VALUES (${evalRecord.agentId}, ${evalRecord.provider}, ${evalRecord.path}, ${evalRecord.allowed}, ${evalRecord.evaluatedCount}, ${evalRecord.matchedCount}, ${evalRecord.deniedBy ?? null}, ${evalRecord.deniedReason ?? null}, ${evalRecord.evaluationTimeMs ?? null})
      `;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      govynEvents.emit('event', {
        type: 'db_write_failed',
        table: 'policy_evaluations',
        error: errorMsg,
      });

      if (this.failOpen) {
        process.stderr.write(`[govyn] DB write failed (fail-open): ${errorMsg}\n`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Write an approval event to the database for audit trail logging.
   * Fire-and-forget from the approval flow.
   *
   * @param event - The approval event data
   */
  async writeApprovalEvent(event: {
    requestId: string;
    action: 'created' | 'approved' | 'denied' | 'denied_timeout' | 'token_consumed';
    decidedBy?: string;
    notes?: string;
  }): Promise<void> {
    try {
      // Log the approval event as a policy evaluation with special marker
      await this.sql`
        INSERT INTO policy_evaluations (agent_id, provider, path, allowed, evaluated_count, matched_count, denied_by, denied_reason, evaluation_time_ms)
        VALUES (${'approval:' + event.requestId}, ${'approval'}, ${event.action}, ${event.action === 'approved' || event.action === 'token_consumed'}, ${0}, ${0}, ${event.decidedBy ?? null}, ${event.notes ?? null}, ${null})
      `;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      govynEvents.emit('event', {
        type: 'db_write_failed',
        table: 'policy_evaluations',
        error: errorMsg,
      });

      if (this.failOpen) {
        process.stderr.write(`[govyn] DB write failed (fail-open): ${errorMsg}\n`);
      } else {
        throw err;
      }
    }
  }

  /**
   * Check if the database is currently available.
   * Used by the approval flow (Plan 02) since approvals ALWAYS require DB.
   *
   * @returns true if DB responds to a simple query, false otherwise
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
