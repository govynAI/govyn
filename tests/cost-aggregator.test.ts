/**
 * Tests for the CostAggregator class.
 *
 * Covers: recordCost, getSummary (with agent and period filters),
 * per-model breakdown, getModelSummary, getUnpricedModels, clear.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { CostRecord } from '../src/types.js';

// Helper to build a cost record with defaults
function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    agentId: 'test-agent',
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    inputCost: 0.00025,
    outputCost: 0.0005,
    totalCost: 0.00075,
    priced: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('CostAggregator', () => {
  let aggregator: CostAggregator;

  beforeEach(() => {
    aggregator = new CostAggregator();
  });

  // -----------------------------------------------------------------------
  // recordCost + basic getSummary
  // -----------------------------------------------------------------------

  it('recordCost adds a record and getSummary returns it', () => {
    const record = makeRecord();
    aggregator.recordCost(record);

    const summaries = aggregator.getSummary();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.agentId).toBe('test-agent');
    expect(summaries[0]!.requestCount).toBe(1);
    expect(summaries[0]!.totalCost).toBeCloseTo(0.00075);
    expect(summaries[0]!.totalInputTokens).toBe(100);
    expect(summaries[0]!.totalOutputTokens).toBe(50);
  });

  // -----------------------------------------------------------------------
  // agentId filter
  // -----------------------------------------------------------------------

  it('getSummary with agentId filter returns only that agent records', () => {
    aggregator.recordCost(makeRecord({ agentId: 'research-agent' }));
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot' }));
    aggregator.recordCost(makeRecord({ agentId: 'research-agent' }));

    const result = aggregator.getSummary({ agentId: 'research-agent' });
    expect(result).toHaveLength(1);
    expect(result[0]!.agentId).toBe('research-agent');
    expect(result[0]!.requestCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Period filter: day
  // -----------------------------------------------------------------------

  it('getSummary with period day filters to current day records only', () => {
    // Record from yesterday (25 hours ago)
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    aggregator.recordCost(makeRecord({ timestamp: yesterday }));

    // Record from today
    aggregator.recordCost(makeRecord({ timestamp: Date.now() }));

    const result = aggregator.getSummary({ period: 'day' });
    // Only the today record should appear
    expect(result).toHaveLength(1);
    expect(result[0]!.requestCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Period filter: hour
  // -----------------------------------------------------------------------

  it('getSummary with period hour filters to last 60 minutes only', () => {
    // Record from 90 minutes ago
    const old = Date.now() - 90 * 60 * 1000;
    aggregator.recordCost(makeRecord({ timestamp: old }));

    // Record from 30 minutes ago
    const recent = Date.now() - 30 * 60 * 1000;
    aggregator.recordCost(makeRecord({ timestamp: recent }));

    const result = aggregator.getSummary({ period: 'hour' });
    expect(result).toHaveLength(1);
    expect(result[0]!.requestCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Aggregation across multiple records per agent
  // -----------------------------------------------------------------------

  it('getSummary correctly aggregates multiple records per agent', () => {
    aggregator.recordCost(makeRecord({ totalCost: 0.001, inputTokens: 100, outputTokens: 50 }));
    aggregator.recordCost(makeRecord({ totalCost: 0.002, inputTokens: 200, outputTokens: 100 }));
    aggregator.recordCost(makeRecord({ totalCost: 0.003, inputTokens: 300, outputTokens: 150 }));

    const summaries = aggregator.getSummary();
    expect(summaries).toHaveLength(1);
    const s = summaries[0]!;
    expect(s.requestCount).toBe(3);
    expect(s.totalCost).toBeCloseTo(0.006);
    expect(s.totalInputTokens).toBe(600);
    expect(s.totalOutputTokens).toBe(300);
  });

  // -----------------------------------------------------------------------
  // Per-model breakdown
  // -----------------------------------------------------------------------

  it('getSummary per-model breakdown shows correct per-model cost and token counts', () => {
    aggregator.recordCost(makeRecord({
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      inputCost: 0.00025,
      outputCost: 0.0005,
      totalCost: 0.00075,
    }));
    aggregator.recordCost(makeRecord({
      model: 'gpt-4o-mini',
      inputTokens: 200,
      outputTokens: 100,
      inputCost: 0.00003,
      outputCost: 0.00006,
      totalCost: 0.00009,
    }));
    aggregator.recordCost(makeRecord({
      model: 'gpt-4o',
      inputTokens: 50,
      outputTokens: 25,
      inputCost: 0.000125,
      outputCost: 0.00025,
      totalCost: 0.000375,
    }));

    const summaries = aggregator.getSummary();
    const s = summaries[0]!;

    expect(s.models['gpt-4o']).toBeDefined();
    expect(s.models['gpt-4o']!.requests).toBe(2);
    expect(s.models['gpt-4o']!.inputTokens).toBe(150);
    expect(s.models['gpt-4o']!.outputTokens).toBe(75);
    expect(s.models['gpt-4o']!.cost).toBeCloseTo(0.001125);

    expect(s.models['gpt-4o-mini']).toBeDefined();
    expect(s.models['gpt-4o-mini']!.requests).toBe(1);
    expect(s.models['gpt-4o-mini']!.inputTokens).toBe(200);
    expect(s.models['gpt-4o-mini']!.outputTokens).toBe(100);
  });

  // -----------------------------------------------------------------------
  // getModelSummary
  // -----------------------------------------------------------------------

  it('getModelSummary groups by model correctly', () => {
    aggregator.recordCost(makeRecord({ agentId: 'agent-1', model: 'gpt-4o', totalCost: 0.001, inputTokens: 100, outputTokens: 50 }));
    aggregator.recordCost(makeRecord({ agentId: 'agent-2', model: 'gpt-4o', totalCost: 0.002, inputTokens: 200, outputTokens: 100 }));
    aggregator.recordCost(makeRecord({ agentId: 'agent-1', model: 'claude-sonnet-4-20250514', totalCost: 0.003, inputTokens: 50, outputTokens: 25 }));

    const result = aggregator.getModelSummary();
    expect(result['gpt-4o']).toBeDefined();
    expect(result['gpt-4o']!.requests).toBe(2);
    expect(result['gpt-4o']!.cost).toBeCloseTo(0.003);
    expect(result['gpt-4o']!.inputTokens).toBe(300);
    expect(result['gpt-4o']!.outputTokens).toBe(150);

    expect(result['claude-sonnet-4-20250514']).toBeDefined();
    expect(result['claude-sonnet-4-20250514']!.requests).toBe(1);
  });

  // -----------------------------------------------------------------------
  // getUnpricedModels
  // -----------------------------------------------------------------------

  it('getUnpricedModels returns models flagged as unpriced', () => {
    aggregator.recordCost(makeRecord({ model: 'gpt-4o', priced: true }));
    aggregator.recordCost(makeRecord({ model: 'unknown-model-xyz', priced: false }));
    aggregator.recordCost(makeRecord({ model: 'another-unknown', priced: false }));
    aggregator.recordCost(makeRecord({ model: 'unknown-model-xyz', priced: false })); // duplicate

    const unpriced = aggregator.getUnpricedModels();
    expect(unpriced).toHaveLength(2);
    expect(unpriced).toContain('unknown-model-xyz');
    expect(unpriced).toContain('another-unknown');
    expect(unpriced).not.toContain('gpt-4o');
  });

  // -----------------------------------------------------------------------
  // clear()
  // -----------------------------------------------------------------------

  it('clear() resets all records', () => {
    aggregator.recordCost(makeRecord());
    aggregator.recordCost(makeRecord());
    expect(aggregator.getSummary()).toHaveLength(1);

    aggregator.clear();

    expect(aggregator.getSummary()).toHaveLength(0);
    expect(aggregator.getModelSummary()).toEqual({});
    expect(aggregator.getUnpricedModels()).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Multiple agents
  // -----------------------------------------------------------------------

  it('getSummary without filter returns separate summaries for each agent', () => {
    aggregator.recordCost(makeRecord({ agentId: 'agent-a', totalCost: 0.001 }));
    aggregator.recordCost(makeRecord({ agentId: 'agent-b', totalCost: 0.002 }));
    aggregator.recordCost(makeRecord({ agentId: 'agent-a', totalCost: 0.003 }));

    const summaries = aggregator.getSummary();
    expect(summaries).toHaveLength(2);

    const agentA = summaries.find((s) => s.agentId === 'agent-a');
    const agentB = summaries.find((s) => s.agentId === 'agent-b');

    expect(agentA).toBeDefined();
    expect(agentA!.requestCount).toBe(2);
    expect(agentA!.totalCost).toBeCloseTo(0.004);

    expect(agentB).toBeDefined();
    expect(agentB!.requestCount).toBe(1);
    expect(agentB!.totalCost).toBeCloseTo(0.002);
  });

  // -----------------------------------------------------------------------
  // Past timestamps filtered by time period
  // -----------------------------------------------------------------------

  it('records with timestamps in the past are correctly filtered by time period', () => {
    const twoMonthsAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const oneHourAgo = Date.now() - 60 * 60 * 1000 + 5000; // within last hour
    const now = Date.now();

    aggregator.recordCost(makeRecord({ timestamp: twoMonthsAgo, agentId: 'agent-x' }));
    aggregator.recordCost(makeRecord({ timestamp: twoDaysAgo, agentId: 'agent-x' }));
    aggregator.recordCost(makeRecord({ timestamp: oneHourAgo, agentId: 'agent-x' }));
    aggregator.recordCost(makeRecord({ timestamp: now, agentId: 'agent-x' }));

    // 'all' returns all 4
    expect(aggregator.getSummary({ period: 'all' })[0]!.requestCount).toBe(4);

    // 'month' — depends on whether twoDaysAgo is still in this month
    // For test reliability, just verify that twoMonthsAgo is excluded
    const monthResult = aggregator.getSummary({ period: 'month' });
    // At minimum, twoMonthsAgo record should be excluded
    // The month result should have fewer than 4 records
    expect(monthResult[0]!.requestCount).toBeLessThan(4);

    // 'day' — only today's records (oneHourAgo and now, assuming they're today)
    const dayResult = aggregator.getSummary({ period: 'day' });
    expect(dayResult[0]!.requestCount).toBeGreaterThanOrEqual(1);
    expect(dayResult[0]!.requestCount).toBeLessThanOrEqual(2);

    // 'hour' — only oneHourAgo (within 60 min) and now
    const hourResult = aggregator.getSummary({ period: 'hour' });
    expect(hourResult[0]!.requestCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // getSummary with period 'month'
  // -----------------------------------------------------------------------

  it('getSummary with period month filters to current calendar month', () => {
    const lastMonthTimestamp = Date.now() - 35 * 24 * 60 * 60 * 1000; // ~35 days ago
    aggregator.recordCost(makeRecord({ timestamp: lastMonthTimestamp }));
    aggregator.recordCost(makeRecord({ timestamp: Date.now() }));

    const result = aggregator.getSummary({ period: 'month' });
    // Only this month's record should appear
    expect(result).toHaveLength(1);
    expect(result[0]!.requestCount).toBe(1);
  });
});
