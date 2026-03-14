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
import type { PersistenceWriterStore, PolicyEvaluationRecord } from './persistence-types.js';
import { adaptWriterStore } from './persistence.js';

/**
 * DbWriter handles async persistence of cost records and policy evaluations
 * to PostgreSQL. All writes are designed for fire-and-forget usage.
 */
export class DbWriter {
  private readonly store: PersistenceWriterStore;

  constructor(
    storeOrSql: PersistenceWriterStore | postgres.Sql,
    private failOpen: boolean,
  ) {
    this.store = adaptWriterStore(storeOrSql);
  }

  /**
   * Write a cost record to the database.
   * Fire-and-forget from the proxy hot path — never blocks response delivery.
   *
   * @param record - The cost record from the in-memory aggregator
   */
  async writeCostRecord(record: CostRecord): Promise<void> {
    try {
      await this.store.insertCostRecord(record);
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
      await this.store.insertPolicyEvaluation(evalRecord);
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
      await this.store.insertApprovalEvent(event);
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
      await this.store.ping();
      return true;
    } catch {
      return false;
    }
  }
}
