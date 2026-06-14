/**
 * Tests for the pricing table and cost calculation module (src/pricing.ts).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultPricing, loadPricing, calculateCost } from '../src/pricing.js';
import type { TokenUsage } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenUsage(
  model: string,
  inputTokens: number,
  outputTokens: number
): TokenUsage {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model,
    provider: 'openai',
  };
}

// ---------------------------------------------------------------------------
// getDefaultPricing tests
// ---------------------------------------------------------------------------

describe('getDefaultPricing', () => {
  it('includes gpt-4o with correct pricing', () => {
    const table = getDefaultPricing();
    const pricing = table.get('gpt-4o');

    expect(pricing).not.toBeUndefined();
    expect(pricing!.inputPricePerMillion).toBe(2.50);
    expect(pricing!.outputPricePerMillion).toBe(10.00);
  });

  it('includes claude-sonnet-4-20250514 with correct pricing', () => {
    const table = getDefaultPricing();
    const pricing = table.get('claude-sonnet-4-20250514');

    expect(pricing).not.toBeUndefined();
    expect(pricing!.inputPricePerMillion).toBe(3.00);
    expect(pricing!.outputPricePerMillion).toBe(15.00);
  });

  it('includes all expected built-in models', () => {
    const table = getDefaultPricing();

    const expectedModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o3',
      'o3-mini',
      'o4-mini',
      'claude-sonnet-4-20250514',
      'claude-haiku-3-5-20241022',
      'claude-opus-4-20250514',
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-fable-5',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
    ];

    for (const model of expectedModels) {
      expect(table.has(model), `Expected pricing table to include "${model}"`).toBe(true);
    }
  });

  it('returns a new independent Map each call (not a shared singleton)', () => {
    const table1 = getDefaultPricing();
    const table2 = getDefaultPricing();

    table1.delete('gpt-4o');

    expect(table2.has('gpt-4o')).toBe(true);
  });

  it('includes all current-gen models with priced entries', () => {
    const table = getDefaultPricing();

    const currentGenModels: Array<[string, number, number]> = [
      ['claude-opus-4-8', 5.00, 25.00],
      ['claude-sonnet-4-6', 3.00, 15.00],
      ['claude-haiku-4-5', 1.00, 5.00],
      ['claude-fable-5', 10.00, 50.00],
      ['gpt-5.5', 5.00, 30.00],
      ['gpt-5.4', 2.50, 15.00],
      ['gpt-5.4-mini', 0.75, 4.50],
      ['gpt-5.4-nano', 0.20, 1.25],
    ];

    for (const [model, expectedInput, expectedOutput] of currentGenModels) {
      const pricing = table.get(model);
      expect(pricing, `Expected pricing table to include "${model}"`).not.toBeUndefined();
      expect(pricing!.inputPricePerMillion).toBe(expectedInput);
      expect(pricing!.outputPricePerMillion).toBe(expectedOutput);
    }
  });

  it('includes all smart-router alias targets in the default pricing table', () => {
    const table = getDefaultPricing();

    const smartRouterAliasTargets = [
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'gpt-5.4-nano',
      'gpt-5.4-mini',
      'gpt-5.5',
    ];

    for (const model of smartRouterAliasTargets) {
      expect(
        table.has(model),
        `Smart-router alias target "${model}" must exist in the default pricing table`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// calculateCost tests
// ---------------------------------------------------------------------------

describe('calculateCost', () => {
  it('calculates correct cost for gpt-4o with 1000 input and 500 output tokens', () => {
    // gpt-4o: $2.50/M input, $10.00/M output
    // Expected: (1000/1_000_000 * 2.50) + (500/1_000_000 * 10.00)
    //         = 0.0025 + 0.005 = 0.0075
    const table = getDefaultPricing();
    const usage = makeTokenUsage('gpt-4o', 1000, 500);

    const result = calculateCost(usage, table);

    expect(result.priced).toBe(true);
    expect(result.inputCost).toBeCloseTo(0.0025, 10);
    expect(result.outputCost).toBeCloseTo(0.0050, 10);
    expect(result.totalCost).toBeCloseTo(0.0075, 10);
    expect(result.model).toBe('gpt-4o');
  });

  it('calculates correct cost for claude-sonnet-4-20250514', () => {
    // claude-sonnet: $3.00/M input, $15.00/M output
    // With 2000 input, 1000 output:
    // (2000/1_000_000 * 3.00) + (1000/1_000_000 * 15.00)
    // = 0.006 + 0.015 = 0.021
    const table = getDefaultPricing();
    const usage = makeTokenUsage('claude-sonnet-4-20250514', 2000, 1000);

    const result = calculateCost(usage, table);

    expect(result.priced).toBe(true);
    expect(result.inputCost).toBeCloseTo(0.006, 10);
    expect(result.outputCost).toBeCloseTo(0.015, 10);
    expect(result.totalCost).toBeCloseTo(0.021, 10);
  });

  it('returns totalCost 0 and priced false for unknown model', () => {
    const table = getDefaultPricing();
    const usage = makeTokenUsage('some-unknown-model-xyz', 1000, 500);

    const result = calculateCost(usage, table);

    expect(result.priced).toBe(false);
    expect(result.totalCost).toBe(0);
    expect(result.inputCost).toBe(0);
    expect(result.outputCost).toBe(0);
    expect(result.model).toBe('some-unknown-model-xyz');
  });

  it('logs a warning for unknown model', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = getDefaultPricing();
    const usage = makeTokenUsage('ghost-model-v1', 100, 50);

    calculateCost(usage, table);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown model "ghost-model-v1"')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unpriced'));

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// loadPricing tests
// ---------------------------------------------------------------------------

describe('loadPricing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns defaults when called with no config', () => {
    const table = loadPricing();

    expect(table.has('gpt-4o')).toBe(true);
    expect(table.has('claude-sonnet-4-20250514')).toBe(true);
    expect(table.size).toBeGreaterThan(0);
  });

  it('overrides default pricing for the same model name', () => {
    const table = loadPricing({
      'gpt-4o': { input: 99.00, output: 199.00 },
    });

    const pricing = table.get('gpt-4o');
    expect(pricing).not.toBeUndefined();
    expect(pricing!.inputPricePerMillion).toBe(99.00);
    expect(pricing!.outputPricePerMillion).toBe(199.00);
  });

  it('does not affect other default models when overriding one', () => {
    const table = loadPricing({
      'gpt-4o': { input: 0.01, output: 0.02 },
    });

    const claudePricing = table.get('claude-sonnet-4-20250514');
    expect(claudePricing).not.toBeUndefined();
    expect(claudePricing!.inputPricePerMillion).toBe(3.00);
    expect(claudePricing!.outputPricePerMillion).toBe(15.00);
  });

  it('adds new models from config that are not in defaults', () => {
    const table = loadPricing({
      'my-custom-model': { input: 1.00, output: 5.00 },
    });

    expect(table.has('my-custom-model')).toBe(true);
    const pricing = table.get('my-custom-model');
    expect(pricing!.inputPricePerMillion).toBe(1.00);
    expect(pricing!.outputPricePerMillion).toBe(5.00);
  });

  it('adds multiple new models from config', () => {
    const table = loadPricing({
      'model-a': { input: 0.50, output: 2.00 },
      'model-b': { input: 3.00, output: 12.00 },
    });

    expect(table.has('model-a')).toBe(true);
    expect(table.has('model-b')).toBe(true);
    expect(table.get('model-a')!.inputPricePerMillion).toBe(0.50);
    expect(table.get('model-b')!.outputPricePerMillion).toBe(12.00);
  });

  it('uses config-overridden pricing in cost calculation', () => {
    const table = loadPricing({
      'gpt-4o': { input: 100.00, output: 200.00 },
    });

    const usage = makeTokenUsage('gpt-4o', 1_000_000, 1_000_000);
    const result = calculateCost(usage, table);

    expect(result.priced).toBe(true);
    expect(result.inputCost).toBe(100.00);
    expect(result.outputCost).toBe(200.00);
    expect(result.totalCost).toBe(300.00);
  });
});
