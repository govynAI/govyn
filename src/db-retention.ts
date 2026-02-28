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

/**
 * RetentionManager aggregates and cleans up old database records.
 */
export class RetentionManager {
  constructor(
    private sql: postgres.Sql,
    private retentionDays: number,
    private approvalRetentionDays: number,
  ) {}

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

    // Aggregate into daily summaries (upsert for idempotency)
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

    // Delete old raw records
    const deleteResult = await this.sql`
      DELETE FROM cost_records WHERE created_at < ${cutoff}
    `;

    return {
      aggregated: aggregateResult.count,
      deleted: deleteResult.count,
    };
  }

  /**
   * Delete old policy evaluation records past the retention period.
   * No aggregation needed for policy evaluations.
   *
   * @returns Number of deleted records
   */
  async cleanupPolicyEvaluations(): Promise<number> {
    const cutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.sql`
      DELETE FROM policy_evaluations WHERE created_at < ${cutoff}
    `;

    return result.count;
  }

  /**
   * Delete old approval records past the approval retention period.
   * Approvals use a separate, longer retention (default 365 days).
   *
   * @returns Number of deleted records
   */
  async cleanupApprovalRecords(): Promise<number> {
    const cutoff = new Date(Date.now() - this.approvalRetentionDays * 24 * 60 * 60 * 1000);

    const result = await this.sql`
      DELETE FROM approval_requests WHERE created_at < ${cutoff}
    `;

    return result.count;
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
