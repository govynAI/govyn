/**
 * Budget enforcement for the Govyn proxy server.
 *
 * Checks per-agent spending limits before each proxied request.
 * Hard limits block requests with HTTP 429.
 * Soft limits forward requests but emit warnings.
 *
 * Budget resets are implicit: CostAggregator.getSummary({ period: 'day' })
 * automatically excludes records before today's midnight UTC.
 * CostAggregator.getSummary({ period: 'month' }) excludes records before this month start.
 * No explicit timer or counter reset is needed.
 *
 * Loop detection blocks are tracked separately via blockedAgents with expiry timestamps.
 * A periodic cleanup interval removes expired entries.
 */

import type { BudgetConfig, BudgetCheckResult, BudgetStatus } from './types.js';
import { CostAggregator } from './cost-aggregator.js';

/** Entry for a temporarily blocked agent (e.g. loop detection cooldown) */
interface BlockedEntry {
  reason: string;
  expiresAt: number;
}

/**
 * BudgetEnforcer checks agent spending against configured limits.
 *
 * - Hard limits: block the request when spend >= limit
 * - Soft limits: allow the request but set warning when spend >= limit
 * - Soft warning threshold: emit warning when spend >= (limit * softWarningPercent / 100)
 * - Agents with no budget config are always allowed
 * - Loop-blocked agents are blocked regardless of budget state
 */
export class BudgetEnforcer {
  private budgets: Map<string, BudgetConfig>;
  private aggregator: CostAggregator;

  /** Temporarily blocked agents (e.g. loop detection cooldown) */
  private blockedAgents: Map<string, BlockedEntry>;

  /** Interval handle for periodic cleanup of expired blocks */
  private cleanupInterval: ReturnType<typeof setInterval> | null;

  constructor(budgets: Map<string, BudgetConfig>, aggregator: CostAggregator) {
    this.budgets = budgets;
    this.aggregator = aggregator;
    this.blockedAgents = new Map();
    this.cleanupInterval = null;
  }

  /**
   * Block an agent temporarily (e.g. after loop detection).
   *
   * @param agentId - The agent to block
   * @param reason - Human-readable reason (used as error code, e.g. 'loop_detected')
   * @param cooldownSeconds - How long to block the agent (in seconds)
   */
  blockAgent(agentId: string, reason: string, cooldownSeconds: number): void {
    const expiresAt = Date.now() + cooldownSeconds * 1000;
    this.blockedAgents.set(agentId, { reason, expiresAt });
  }

  /**
   * Manually unblock an agent (e.g. via API call).
   *
   * @param agentId - The agent to unblock
   * @returns true if the agent was actually blocked and has been unblocked; false if not blocked
   */
  unblockAgent(agentId: string): boolean {
    if (this.blockedAgents.has(agentId)) {
      this.blockedAgents.delete(agentId);
      return true;
    }
    return false;
  }

  /**
   * Check if an agent is currently in a temporary block (e.g. cooldown).
   * Auto-removes expired entries.
   *
   * @param agentId - The agent to check
   * @returns Object with blocked status and optional reason/expiry
   */
  isBlocked(agentId: string): { blocked: boolean; reason?: string; expiresAt?: number } {
    const entry = this.blockedAgents.get(agentId);
    if (!entry) return { blocked: false };

    if (Date.now() >= entry.expiresAt) {
      // Cooldown expired — auto-remove
      this.blockedAgents.delete(agentId);
      return { blocked: false };
    }

    return { blocked: true, reason: entry.reason, expiresAt: entry.expiresAt };
  }

  /**
   * Start a periodic cleanup interval that removes expired blocked agent entries.
   * Call stopCleanup() to clear the interval (e.g. in tests).
   */
  startCleanup(): void {
    if (this.cleanupInterval !== null) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [agentId, entry] of this.blockedAgents.entries()) {
        if (now >= entry.expiresAt) {
          this.blockedAgents.delete(agentId);
        }
      }
    }, 60_000);
    // Don't keep the process alive just for cleanup
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Stop the periodic cleanup interval.
   * Should be called when shutting down the server or in test teardown.
   */
  stopCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Check whether a request from the given agent is within budget.
   * First checks if the agent is in a temporary block (loop cooldown).
   * Then checks spending limits.
   *
   * @param agentId - The agent making the request
   * @returns BudgetCheckResult indicating whether to allow, block, or warn
   */
  checkBudget(agentId: string): BudgetCheckResult {
    // Check temporary block FIRST (loop detection cooldown takes priority)
    const blockStatus = this.isBlocked(agentId);
    if (blockStatus.blocked) {
      return {
        allowed: false,
        code: 'loop_detected',
        resetTime: blockStatus.expiresAt
          ? new Date(blockStatus.expiresAt).toISOString()
          : undefined,
      };
    }

    const budget = this.budgets.get(agentId);

    // No budget config = always allowed
    if (!budget) {
      return { allowed: true };
    }

    // Get current daily spend
    const dailySummaries = this.aggregator.getSummary({ agentId, period: 'day' });
    const dailySpend = dailySummaries.find((s) => s.agentId === agentId)?.totalCost ?? 0;

    // Get current monthly spend
    const monthlySummaries = this.aggregator.getSummary({ agentId, period: 'month' });
    const monthlySpend = monthlySummaries.find((s) => s.agentId === agentId)?.totalCost ?? 0;

    // Check daily limit first
    if (budget.dailyLimit !== null) {
      if (budget.limitType === 'hard' && dailySpend >= budget.dailyLimit) {
        return {
          allowed: false,
          code: 'budget_exceeded_daily',
          limitAmount: budget.dailyLimit,
          currentSpend: dailySpend,
          resetTime: this.nextMidnightUTC(),
        };
      }

      if (budget.limitType === 'soft' && dailySpend >= budget.dailyLimit) {
        // Over the soft daily limit — still allow but warn
        const percentUsed = (dailySpend / budget.dailyLimit) * 100;
        return {
          allowed: true,
          warning: true,
          code: 'budget_exceeded_daily',
          limitAmount: budget.dailyLimit,
          currentSpend: dailySpend,
          resetTime: this.nextMidnightUTC(),
          percentUsed,
        };
      }

      // Check soft warning threshold (spend approaching limit)
      if (
        budget.limitType === 'soft' &&
        budget.dailyLimit > 0 &&
        dailySpend >= (budget.dailyLimit * budget.softWarningPercent) / 100
      ) {
        const percentUsed = (dailySpend / budget.dailyLimit) * 100;
        return {
          allowed: true,
          warning: true,
          limitAmount: budget.dailyLimit,
          currentSpend: dailySpend,
          resetTime: this.nextMidnightUTC(),
          percentUsed,
        };
      }
    }

    // Check monthly limit
    if (budget.monthlyLimit !== null) {
      if (budget.limitType === 'hard' && monthlySpend >= budget.monthlyLimit) {
        return {
          allowed: false,
          code: 'budget_exceeded_monthly',
          limitAmount: budget.monthlyLimit,
          currentSpend: monthlySpend,
          resetTime: this.nextMonthStartUTC(),
        };
      }

      if (budget.limitType === 'soft' && monthlySpend >= budget.monthlyLimit) {
        const percentUsed = (monthlySpend / budget.monthlyLimit) * 100;
        return {
          allowed: true,
          warning: true,
          code: 'budget_exceeded_monthly',
          limitAmount: budget.monthlyLimit,
          currentSpend: monthlySpend,
          resetTime: this.nextMonthStartUTC(),
          percentUsed,
        };
      }

      // Check soft monthly warning threshold
      if (
        budget.limitType === 'soft' &&
        budget.monthlyLimit > 0 &&
        monthlySpend >= (budget.monthlyLimit * budget.softWarningPercent) / 100
      ) {
        const percentUsed = (monthlySpend / budget.monthlyLimit) * 100;
        return {
          allowed: true,
          warning: true,
          limitAmount: budget.monthlyLimit,
          currentSpend: monthlySpend,
          resetTime: this.nextMonthStartUTC(),
          percentUsed,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Get the current budget status for a specific agent.
   *
   * @param agentId - The agent to query
   * @returns BudgetStatus with daily and monthly spend/limit/remaining
   */
  getStatus(agentId: string): BudgetStatus {
    const budget = this.budgets.get(agentId);

    const dailySummaries = this.aggregator.getSummary({ agentId, period: 'day' });
    const dailySpend = dailySummaries.find((s) => s.agentId === agentId)?.totalCost ?? 0;

    const monthlySummaries = this.aggregator.getSummary({ agentId, period: 'month' });
    const monthlySpend = monthlySummaries.find((s) => s.agentId === agentId)?.totalCost ?? 0;

    const dailyLimit = budget?.dailyLimit ?? null;
    const monthlyLimit = budget?.monthlyLimit ?? null;
    const limitType = budget?.limitType ?? 'hard';

    const dailyRemaining = dailyLimit !== null ? Math.max(0, dailyLimit - dailySpend) : null;
    const monthlyRemaining =
      monthlyLimit !== null ? Math.max(0, monthlyLimit - monthlySpend) : null;

    const dailyPercentUsed =
      dailyLimit !== null && dailyLimit > 0 ? (dailySpend / dailyLimit) * 100 : null;
    const monthlyPercentUsed =
      monthlyLimit !== null && monthlyLimit > 0 ? (monthlySpend / monthlyLimit) * 100 : null;

    // Determine if agent is currently blocked (hard limit exceeded OR in loop cooldown)
    const blockStatus = this.isBlocked(agentId);
    const blocked =
      blockStatus.blocked ||
      (limitType === 'hard' &&
        ((dailyLimit !== null && dailySpend >= dailyLimit) ||
          (monthlyLimit !== null && monthlySpend >= monthlyLimit)));

    return {
      agentId,
      daily: {
        limit: dailyLimit,
        spent: dailySpend,
        remaining: dailyRemaining,
        percentUsed: dailyPercentUsed,
        resetsAt: this.nextMidnightUTC(),
      },
      monthly: {
        limit: monthlyLimit,
        spent: monthlySpend,
        remaining: monthlyRemaining,
        percentUsed: monthlyPercentUsed,
        resetsAt: this.nextMonthStartUTC(),
      },
      limitType,
      blocked,
    };
  }

  /**
   * Get budget status for all configured agents.
   *
   * @returns Array of BudgetStatus, one per configured agent
   */
  getAllStatuses(): BudgetStatus[] {
    const statuses: BudgetStatus[] = [];
    for (const agentId of this.budgets.keys()) {
      statuses.push(this.getStatus(agentId));
    }
    return statuses;
  }

  /**
   * ISO timestamp of the next midnight UTC.
   */
  private nextMidnightUTC(): string {
    const now = new Date();
    const nextMidnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return nextMidnight.toISOString();
  }

  /**
   * ISO timestamp of the 1st of next month UTC.
   */
  private nextMonthStartUTC(): string {
    const now = new Date();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return nextMonth.toISOString();
  }
}
