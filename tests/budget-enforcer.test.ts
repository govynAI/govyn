/**
 * Unit tests for the BudgetEnforcer class (src/budget-enforcer.ts).
 *
 * Uses real CostAggregator instances with manually-inserted CostRecords
 * to simulate agent spending at various levels.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetEnforcer } from '../src/budget-enforcer.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { BudgetConfig, CostRecord } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    agentId: 'test-agent',
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 1000,
    outputTokens: 500,
    inputCost: 0.0025,
    outputCost: 0.005,
    totalCost: 0.0075,
    priced: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeBudget(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
  return {
    dailyLimit: 10.0,
    monthlyLimit: 100.0,
    limitType: 'hard',
    softWarningPercent: 80,
    ...overrides,
  };
}

/** Insert a cost record with a specific totalCost (today's timestamp). */
function recordSpend(aggregator: CostAggregator, agentId: string, totalCost: number): void {
  aggregator.recordCost(
    makeRecord({
      agentId,
      totalCost,
      inputCost: totalCost * 0.33,
      outputCost: totalCost * 0.67,
      timestamp: Date.now(),
    }),
  );
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('BudgetEnforcer.checkBudget()', () => {
  let aggregator: CostAggregator;

  beforeEach(() => {
    aggregator = new CostAggregator();
  });

  // Test 1: Agent with no budget config is always allowed
  it('agent with no budget config is always allowed', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);
    const result = enforcer.checkBudget('unknown-agent');
    expect(result.allowed).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  // Test 2: Agent under daily hard limit is allowed
  it('agent under daily hard limit is allowed', () => {
    const budgets = new Map([['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null })]]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $5.00 (under $10 daily limit)
    recordSpend(aggregator, 'agent1', 5.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(true);
    expect(result.code).toBeUndefined();
  });

  // Test 3: Agent at exactly daily hard limit is blocked with budget_exceeded_daily
  it('agent at exactly daily hard limit is blocked with budget_exceeded_daily', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend exactly $10.00
    recordSpend(aggregator, 'agent1', 10.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily');
  });

  // Test 4: Agent over daily hard limit blocked with correct error fields
  it('agent over daily hard limit blocked with correct limitAmount, currentSpend, resetTime', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $10.50 (over $10 limit)
    recordSpend(aggregator, 'agent1', 10.5);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily');
    expect(result.limitAmount).toBe(10.0);
    expect(result.currentSpend).toBeCloseTo(10.5, 5);
    expect(result.resetTime).toBeDefined();
    // resetTime should be a valid ISO string in the future
    const resetDate = new Date(result.resetTime!);
    expect(resetDate.getTime()).toBeGreaterThan(Date.now());
  });

  // Test 5: Agent over daily limit is blocked (daily checked first, not monthly)
  it('agent over daily limit is blocked with daily code even if monthly is fine', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 5.0, monthlyLimit: 100.0, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $6.00 today (over daily $5 limit, under monthly $100 limit)
    recordSpend(aggregator, 'agent1', 6.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily');
  });

  // Test 6: Agent over monthly hard limit is blocked with budget_exceeded_monthly
  it('agent over monthly hard limit is blocked with budget_exceeded_monthly', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: null, monthlyLimit: 50.0, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $55 this month (over $50 monthly limit)
    recordSpend(aggregator, 'agent1', 55.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_monthly');
    expect(result.limitAmount).toBe(50.0);
    expect(result.currentSpend).toBeCloseTo(55.0, 5);
  });

  // Test 7: Agent with soft limit over daily limit is allowed but has warning: true
  it('agent with soft limit over daily limit is allowed with warning', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $12 (over $10 soft daily limit)
    recordSpend(aggregator, 'agent1', 12.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.code).toBe('budget_exceeded_daily');
  });

  // Test 8: Agent with soft limit over monthly limit gets warning
  it('agent with soft limit over monthly limit gets warning', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: null, monthlyLimit: 50.0, limitType: 'soft' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $60 (over $50 soft monthly limit)
    recordSpend(aggregator, 'agent1', 60.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.code).toBe('budget_exceeded_monthly');
  });

  // Test 9: Soft warning at 80% threshold emits warning with percentUsed
  it('soft warning at 80% threshold emits warning with percentUsed', () => {
    const budgets = new Map([
      [
        'agent1',
        makeBudget({
          dailyLimit: 10.0,
          monthlyLimit: null,
          limitType: 'soft',
          softWarningPercent: 80,
        }),
      ],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $8.50 = 85% of $10 daily limit (above 80% threshold)
    recordSpend(aggregator, 'agent1', 8.5);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBeDefined();
    expect(result.percentUsed!).toBeCloseTo(85, 1);
  });

  // Test 10: Soft warning below threshold has no warning
  it('soft warning below threshold has no warning', () => {
    const budgets = new Map([
      [
        'agent1',
        makeBudget({
          dailyLimit: 10.0,
          monthlyLimit: null,
          limitType: 'soft',
          softWarningPercent: 80,
        }),
      ],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Spend $7.00 = 70% of $10 (below 80% threshold)
    recordSpend(aggregator, 'agent1', 7.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  // Test 14: Budget check with unknown agent returns allowed (no config = no limit)
  it('budget check with unknown agent returns allowed', () => {
    const budgets = new Map([['known-agent', makeBudget()]]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    const result = enforcer.checkBudget('totally-unknown-agent');
    expect(result.allowed).toBe(true);
  });

  // Test 15: resetTime fields are valid ISO timestamps in the future
  it('resetTime fields are valid ISO timestamps in the future', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 5.0, monthlyLimit: null, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    recordSpend(aggregator, 'agent1', 6.0);

    const result = enforcer.checkBudget('agent1');
    expect(result.resetTime).toBeDefined();

    // Parse and verify it's a valid date in the future
    const resetDate = new Date(result.resetTime!);
    expect(isNaN(resetDate.getTime())).toBe(false);
    expect(resetDate.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('BudgetEnforcer.getStatus()', () => {
  let aggregator: CostAggregator;

  beforeEach(() => {
    aggregator = new CostAggregator();
  });

  // Test 11: getStatus() returns correct daily/monthly breakdown
  it('getStatus() returns correct daily and monthly spend', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: 100.0, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    recordSpend(aggregator, 'agent1', 3.0);
    recordSpend(aggregator, 'agent1', 2.0);

    const status = enforcer.getStatus('agent1');

    expect(status.agentId).toBe('agent1');
    expect(status.daily.limit).toBe(10.0);
    expect(status.daily.spent).toBeCloseTo(5.0, 5);
    expect(status.daily.remaining).toBeCloseTo(5.0, 5);
    expect(status.daily.percentUsed).toBeCloseTo(50, 1);
    expect(status.daily.resetsAt).toBeDefined();

    expect(status.monthly.limit).toBe(100.0);
    expect(status.monthly.spent).toBeCloseTo(5.0, 5);
    expect(status.monthly.remaining).toBeCloseTo(95.0, 5);
    expect(status.monthly.percentUsed).toBeCloseTo(5, 1);
    expect(status.monthly.resetsAt).toBeDefined();

    expect(status.limitType).toBe('hard');
    expect(status.blocked).toBe(false);
  });

  // Test 12: getStatus() for agent with no config returns zeros
  it('getStatus() for agent with no config returns zero spend and null limits', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);

    const status = enforcer.getStatus('no-config-agent');

    expect(status.agentId).toBe('no-config-agent');
    expect(status.daily.limit).toBeNull();
    expect(status.daily.spent).toBe(0);
    expect(status.daily.remaining).toBeNull();
    expect(status.daily.percentUsed).toBeNull();
    expect(status.monthly.limit).toBeNull();
    expect(status.monthly.spent).toBe(0);
    expect(status.monthly.remaining).toBeNull();
    expect(status.monthly.percentUsed).toBeNull();
    expect(status.blocked).toBe(false);
  });

  it('getStatus() shows blocked=true when hard limit exceeded', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    recordSpend(aggregator, 'agent1', 11.0);

    const status = enforcer.getStatus('agent1');
    expect(status.blocked).toBe(true);
  });

  it('getStatus() shows blocked=false for soft limits even when over limit', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft' })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    recordSpend(aggregator, 'agent1', 11.0);

    const status = enforcer.getStatus('agent1');
    expect(status.blocked).toBe(false);
  });
});

describe('BudgetEnforcer.getAllStatuses()', () => {
  let aggregator: CostAggregator;

  beforeEach(() => {
    aggregator = new CostAggregator();
  });

  // Test 13: getAllStatuses() returns all configured agents
  it('getAllStatuses() returns status for all configured agents', () => {
    const budgets = new Map([
      ['agent1', makeBudget({ dailyLimit: 10.0, monthlyLimit: null })],
      ['agent2', makeBudget({ dailyLimit: 5.0, monthlyLimit: 50.0 })],
      ['agent3', makeBudget({ dailyLimit: null, monthlyLimit: 200.0 })],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    const statuses = enforcer.getAllStatuses();

    expect(statuses.length).toBe(3);
    const agentIds = statuses.map((s) => s.agentId).sort();
    expect(agentIds).toEqual(['agent1', 'agent2', 'agent3']);
  });

  it('getAllStatuses() returns empty array when no budgets configured', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);
    const statuses = enforcer.getAllStatuses();
    expect(statuses).toEqual([]);
  });
});
