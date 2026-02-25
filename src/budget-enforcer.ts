/**
 * Budget enforcement for the Govyn proxy server.
 *
 * Checks per-agent spending limits before each proxied request.
 * Hard limits block requests with HTTP 429.
 * Soft limits forward requests but emit warnings.
 */

import type { BudgetConfig, BudgetCheckResult, BudgetStatus } from './types.js';
import { CostAggregator } from './cost-aggregator.js';

/**
 * BudgetEnforcer checks agent spending against configured limits.
 *
 * - Hard limits: block the request when spend >= limit
 * - Soft limits: allow the request but set warning when spend >= limit
 * - Soft warning threshold: emit warning when spend >= (limit * softWarningPercent / 100)
 * - Agents with no budget config are always allowed
 */
export class BudgetEnforcer {
  private budgets: Map<string, BudgetConfig>;
  private aggregator: CostAggregator;

  constructor(budgets: Map<string, BudgetConfig>, aggregator: CostAggregator) {
    this.budgets = budgets;
    this.aggregator = aggregator;
  }

  /**
   * Check whether a request from the given agent is within budget.
   *
   * @param agentId - The agent making the request
   * @returns BudgetCheckResult indicating whether to allow, block, or warn
   */
  checkBudget(agentId: string): BudgetCheckResult {
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

    // Determine if agent is currently blocked (only for hard limits)
    const blocked =
      limitType === 'hard' &&
      ((dailyLimit !== null && dailySpend >= dailyLimit) ||
        (monthlyLimit !== null && monthlySpend >= monthlyLimit));

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
