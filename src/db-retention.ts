/**
 * Data retention manager for the Govyn proxy database.
 *
 * Handles cleanup of old records with pre-delete aggregation:
 * - Cost records are aggregated into daily summaries before deletion
 * - Policy evaluations are deleted after retention period (no aggregation needed)
 * - Approval records have a separate, longer retention period
 *
 * Designed to run on a periodic schedule (e.g. every 6 hours).
 */

import type postgres from 'postgres';
import type { RetentionStore } from './persistence-types.js';
import { adaptRetentionStore } from './persistence.js';

/**
 * RetentionManager aggregates and cleans up old database records.
 */
export class RetentionManager {
  private readonly store: RetentionStore;

  constructor(
    storeOrSql: RetentionStore | postgres.Sql,
    private retentionDays: number,
    private approvalRetentionDays: number,
  ) {
    this.store = adaptRetentionStore(storeOrSql, retentionDays, approvalRetentionDays);
  }

  /**
   * Aggregate old cost records into daily summaries, then delete the raw records.
   *
   * Before deleting: INSERT INTO cost_daily_summary grouped by agent_id, model, provider, date.
   * Uses UPSERT (ON CONFLICT UPDATE) so re-runs are safe.
   * Then: DELETE FROM cost_records WHERE created_at < cutoff.
   *
   * @returns Counts of aggregated summary rows and deleted raw records
   */
  async cleanupCostRecords(): Promise<{ aggregated: number; deleted: number }> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    return this.store.cleanupCostRecords(cutoff);
  }

  /**
   * Delete old policy evaluation records past the retention period.
   * No aggregation needed for policy evaluations.
   *
   * @returns Number of deleted records
   */
  async cleanupPolicyEvaluations(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
    return this.store.cleanupPolicyEvaluations(cutoff);
  }

  /**
   * Delete old approval records past the approval retention period.
   * Approvals use a separate, longer retention (default 365 days).
   *
   * @returns Number of deleted records
   */
  async cleanupApprovalRecords(): Promise<number> {
    const cutoff = new Date(Date.now() - this.approvalRetentionDays * 24 * 60 * 60 * 1000);
    return this.store.cleanupApprovalRecords(cutoff);
  }

  /**
   * Run all retention cleanup tasks.
   * Logs results to stdout for observability.
   */
  async runAll(): Promise<void> {
    try {
      const costResult = await this.cleanupCostRecords();
      if (costResult.deleted > 0) {
        console.log(`[govyn] Retention cleanup: aggregated ${costResult.aggregated} daily summaries, deleted ${costResult.deleted} cost records`);
      }

      const policyDeleted = await this.cleanupPolicyEvaluations();
      if (policyDeleted > 0) {
        console.log(`[govyn] Retention cleanup: deleted ${policyDeleted} policy evaluations`);
      }

      const approvalDeleted = await this.cleanupApprovalRecords();
      if (approvalDeleted > 0) {
        console.log(`[govyn] Retention cleanup: deleted ${approvalDeleted} approval records`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Retention cleanup failed: ${message}\n`);
    }
  }
}
