/**
 * Unit tests for BudgetEnforcer.checkBudget() policy evaluation.
 *
 * Tests budget enforcement rules: no budget, under/at/over limits,
 * hard vs soft, monthly limits, soft warning thresholds, loop-blocked agents,
 * and budget reset behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import type { BudgetConfig, CostRecord } from '../../src/types.js';

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

describe('BudgetEnforcer.checkBudget() — policy evaluation', () => {
  let aggregator: CostAggregator;

  beforeEach(() => {
    aggregator = new CostAggregator();
  });

  // Test 1: Agent with no budget configured -> allowed: true
  it('agent with no budget configured is always allowed', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);
    const result = enforcer.checkBudget('unconfigured-agent');
    expect(result.allowed).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  // Test 2: Agent under daily limit -> allowed: true
  it('agent under daily limit is allowed', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 5.0);

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true);
  });

  // Test 3: Agent at exactly daily limit -> behavior (>= means blocked for hard)
  it('agent at exactly daily limit with hard enforcement is blocked', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 10.0); // exactly at limit

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily');
  });

  // Test 4: Agent over daily limit with hard enforcement -> blocked
  it('agent over daily limit with hard enforcement is blocked with correct code', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 12.0);

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily');
    expect(result.limitAmount).toBe(10.0);
    expect(result.currentSpend).toBeCloseTo(12.0, 2);
    expect(result.resetTime).toBeDefined();
  });

  // Test 5: Agent over monthly limit -> blocked
  it('agent over monthly limit with hard enforcement is blocked', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: null, monthlyLimit: 50.0, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 55.0);

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_monthly');
    expect(result.limitAmount).toBe(50.0);
  });

  // Test 6: Agent with soft limit and warning threshold reached -> allowed with warning
  it('agent with soft limit at warning threshold gets warning', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 8.5); // 85% of $10 limit

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.percentUsed).toBeDefined();
    expect(result.percentUsed!).toBeCloseTo(85, 1);
  });

  // Test 7: Agent with soft limit over daily limit -> allowed with warning
  it('agent with soft limit over daily limit is still allowed with warning', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 15.0); // 150% of $10

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBe(true);
    expect(result.code).toBe('budget_exceeded_daily');
  });

  // Test 8: Loop-blocked agent -> not allowed with loop_detected code
  it('loop-blocked agent is blocked with loop_detected code', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);
    enforcer.blockAgent('agent-loop', 'loop_detected', 300);

    const result = enforcer.checkBudget('agent-loop');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('loop_detected');
  });

  // Test 9: Loop block takes priority over budget check
  it('loop block takes priority over budget limits', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 1000.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    // Agent is under budget but loop-blocked
    recordSpend(aggregator, 'agent-a', 1.0);
    enforcer.blockAgent('agent-a', 'loop_detected', 300);

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('loop_detected');
  });

  // Test 10: Budget reset behavior — yesterday's spending does not count
  it('spending from a different time period (yesterday) does not count toward today', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);

    // Record spend from yesterday (25 hours ago)
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    aggregator.recordCost(
      makeRecord({
        agentId: 'agent-a',
        totalCost: 11.0, // Over daily limit — but from yesterday
        inputCost: 4.0,
        outputCost: 7.0,
        timestamp: yesterday,
      }),
    );

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true); // Yesterday's spend doesn't count
  });

  // Test 11: Soft warning below threshold has no warning
  it('soft limit below warning threshold does not produce warning', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 10.0, monthlyLimit: null, limitType: 'soft', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 7.0); // 70% — below 80% threshold

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  // Test 12: Daily check before monthly — agent over daily but under monthly
  it('daily limit checked before monthly limit', () => {
    const budgets = new Map<string, BudgetConfig>([
      ['agent-a', { dailyLimit: 5.0, monthlyLimit: 100.0, limitType: 'hard', softWarningPercent: 80 }],
    ]);
    const enforcer = new BudgetEnforcer(budgets, aggregator);
    recordSpend(aggregator, 'agent-a', 6.0); // Over daily, under monthly

    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('budget_exceeded_daily'); // Daily checked first
  });

  // Test 13: Expired block is auto-removed
  it('expired loop block is auto-removed and agent is allowed', () => {
    const enforcer = new BudgetEnforcer(new Map(), aggregator);
    // Block with 0 seconds cooldown — immediately expired
    enforcer.blockAgent('agent-a', 'loop_detected', 0);

    // Wait a moment for timestamp to pass
    const result = enforcer.checkBudget('agent-a');
    expect(result.allowed).toBe(true);
  });
});
