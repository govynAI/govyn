/**
 * Background job that auto-denies expired approval requests.
 *
 * Runs on a configurable interval (default 30 seconds) to mark pending
 * approval requests that have passed their expires_at timestamp as
 * 'denied_timeout'. This is distinct from 'denied' — agents can
 * programmatically differentiate between human denial and timeout expiry.
 */

import type postgres from 'postgres';

export class ApprovalTimeoutChecker {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private sql: postgres.Sql) {}

  /**
   * Start checking for expired approvals every 30 seconds.
   * The interval is unref'd so it doesn't keep the process alive.
   */
  start(): void {
    this.interval = setInterval(() => this.expireTimedOut(), 30_000);
    this.interval.unref();
  }

  /**
   * Mark all expired pending approvals as denied_timeout.
   * Returns the number of records updated.
   */
  async expireTimedOut(): Promise<number> {
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'denied_timeout', decided_at = NOW()
      WHERE status = 'pending' AND expires_at < NOW()
    `;
    if (result.count > 0) {
      console.log(`[govyn] Auto-denied ${result.count} expired approval request(s)`);
    }
    return result.count;
  }

  /**
   * Stop the interval checker.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
