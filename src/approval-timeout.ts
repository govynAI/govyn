/**
 * Background job that auto-denies expired approval requests.
 *
 * Runs on a configurable interval (default 30 seconds) to mark pending
 * approval requests that have passed their expires_at timestamp as
 * 'denied_timeout'. This is distinct from 'denied' — agents can
 * programmatically differentiate between human denial and timeout expiry.
 */

import type postgres from 'postgres';
import type { ApprovalStore } from './persistence-types.js';
import { adaptApprovalStore } from './persistence.js';

export class ApprovalTimeoutChecker {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly store: ApprovalStore;

  constructor(storeOrSql: ApprovalStore | postgres.Sql) {
    this.store = adaptApprovalStore(storeOrSql);
  }

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
    const count = await this.store.expireTimedOutApprovals();
    if (count > 0) {
      console.log(`[govyn] Auto-denied ${count} expired approval request(s)`);
    }
    return count;
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
