/**
 * Unit tests for calculateCost() from src/pricing.ts.
 *
 * Verifies pricing accuracy for known models, edge cases (unknown model,
 * zero tokens, large token counts, case sensitivity), and batch accuracy
 * within 5% of expected provider pricing.
 */

import { describe, it, expect } from 'vitest';
import { calculateCost, loadPricing, getDefaultPricing } from '../../src/pricing.js';
import type { TokenUsage } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    model: 'gpt-4o',
    provider: 'openai',
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('calculateCost()', () => {
  const pricingTable = loadPricing();

  // Test 1: Known OpenAI model (gpt-4o) accuracy
  it('gpt-4o: input cost, output cost, and total cost match expected values within 0.01%', () => {
    const usage = makeUsage({
      inputTokens: 10000,
      outputTokens: 5000,
      totalTokens: 15000,
      model: 'gpt-4o',
      provider: 'openai',
    });

    const result = calculateCost(usage, pricingTable);

    // gpt-4o: $2.50/M input, $10.00/M output
    const expectedInput = (10000 / 1_000_000) * 2.50;   // 0.025
    const expectedOutput = (5000 / 1_000_000) * 10.00;  // 0.05
    const expectedTotal = expectedInput + expectedOutput; // 0.075

    expect(result.priced).toBe(true);
    expect(result.model).toBe('gpt-4o');
    expect(Math.abs(result.inputCost - expectedInput) / expectedInput).toBeLessThan(0.0001);
    expect(Math.abs(result.outputCost - expectedOutput) / expectedOutput).toBeLessThan(0.0001);
    expect(Math.abs(result.totalCost - expectedTotal) / expectedTotal).toBeLessThan(0.0001);
  });

  // Test 2: Known Anthropic model (claude-sonnet-4-20250514) accuracy
  it('claude-sonnet-4-20250514: input and output costs match expected values', () => {
    const usage = makeUsage({
      inputTokens: 10000,
      outputTokens: 5000,
      totalTokens: 15000,
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    });

    const result = calculateCost(usage, pricingTable);

    // claude-sonnet-4-20250514: $3.00/M input, $15.00/M output
    const expectedInput = (10000 / 1_000_000) * 3.00;   // 0.03
    const expectedOutput = (5000 / 1_000_000) * 15.00;  // 0.075
    const expectedTotal = expectedInput + expectedOutput; // 0.105

    expect(result.priced).toBe(true);
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.inputCost).toBeCloseTo(expectedInput, 8);
    expect(result.outputCost).toBeCloseTo(expectedOutput, 8);
    expect(result.totalCost).toBeCloseTo(expectedTotal, 8);
  });

  // Test 3: Unknown model returns priced=false and totalCost=0
  it('unknown model returns priced=false and totalCost=0', () => {
    const usage = makeUsage({
      inputTokens: 5000,
      outputTokens: 2000,
      totalTokens: 7000,
      model: 'unknown-model-xyz',
    });

    const result = calculateCost(usage, pricingTable);

    expect(result.priced).toBe(false);
    expect(result.totalCost).toBe(0);
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.model).toBe('unknown-model-xyz');
  });

  // Test 4: Zero tokens produce zero cost
  it('zero tokens produce zero cost', () => {
    const usage = makeUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      model: 'gpt-4o',
    });

    const result = calculateCost(usage, pricingTable);

    expect(result.priced).toBe(true);
    expect(result.totalCost).toBe(0);
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
  });

  // Test 5: Large token counts (1M input, 500K output) no floating point overflow
  it('large token counts (1M input, 500K output) compute without floating point overflow', () => {
    const usage = makeUsage({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
      model: 'gpt-4o',
    });

    const result = calculateCost(usage, pricingTable);

    // gpt-4o: $2.50/M input, $10.00/M output
    const expectedInput = (1_000_000 / 1_000_000) * 2.50;  // $2.50
    const expectedOutput = (500_000 / 1_000_000) * 10.00;  // $5.00
    const expectedTotal = expectedInput + expectedOutput;    // $7.50

    expect(result.priced).toBe(true);
    expect(result.totalCost).toBeCloseTo(expectedTotal, 6);
    expect(result.inputCost).toBeCloseTo(expectedInput, 6);
    expect(result.outputCost).toBeCloseTo(expectedOutput, 6);
    expect(Number.isFinite(result.totalCost)).toBe(true);
  });

  // Test 6: Model name case sensitivity (should be case-sensitive match)
  it('model name matching is case-sensitive', () => {
    const usage = makeUsage({
      inputTokens: 1000,
      outputTokens: 500,
      model: 'GPT-4O', // wrong case
    });

    const result = calculateCost(usage, pricingTable);

    // 'GPT-4O' should NOT match 'gpt-4o' — case-sensitive
    expect(result.priced).toBe(false);
    expect(result.totalCost).toBe(0);
  });

  // Test 7: Config overrides work correctly
  it('config pricing overrides apply correctly', () => {
    const customTable = loadPricing({
      'custom-model': { input: 5.0, output: 20.0 },
    });

    const usage = makeUsage({
      inputTokens: 10000,
      outputTokens: 5000,
      model: 'custom-model',
    });

    const result = calculateCost(usage, customTable);

    const expectedInput = (10000 / 1_000_000) * 5.0;   // 0.05
    const expectedOutput = (5000 / 1_000_000) * 20.0;  // 0.1
    const expectedTotal = expectedInput + expectedOutput; // 0.15

    expect(result.priced).toBe(true);
    expect(result.totalCost).toBeCloseTo(expectedTotal, 8);
  });

  // Test 8: Batch accuracy within 5% of expected pricing for 100 varied requests
  it('batch of 100 varied requests: cost accuracy within 5% of expected', () => {
    const defaultPricing = getDefaultPricing();
    const models = Array.from(defaultPricing.keys());

    let totalExpected = 0;
    let totalActual = 0;

    for (let i = 0; i < 100; i++) {
      const model = models[i % models.length]!;
      const pricing = defaultPricing.get(model)!;
      const inputTokens = Math.floor(Math.random() * 50000) + 100;
      const outputTokens = Math.floor(Math.random() * 20000) + 50;

      const expectedInput = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
      const expectedOutput = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;
      totalExpected += expectedInput + expectedOutput;

      const usage = makeUsage({
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        model,
      });

      const result = calculateCost(usage, pricingTable);
      totalActual += result.totalCost;
    }

    // Overall accuracy within 5%
    const accuracy = Math.abs(totalActual - totalExpected) / totalExpected;
    expect(accuracy).toBeLessThan(0.05);
  });

  // Test 9: All default models are priced
  it('all default models return priced=true', () => {
    const defaultPricing = getDefaultPricing();
    for (const model of defaultPricing.keys()) {
      const usage = makeUsage({ model, inputTokens: 1000, outputTokens: 500, totalTokens: 1500 });
      const result = calculateCost(usage, pricingTable);
      expect(result.priced).toBe(true);
    }
  });
});
