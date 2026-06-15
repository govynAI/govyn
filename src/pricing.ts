/**
 * Pricing table and cost calculation engine for the Govyn proxy server.
 *
 * Provides built-in default pricing for major models, config overrides,
 * and accurate cost calculation from token usage data.
 */

import type { TokenUsage } from './types.js';

/**
 * Pricing configuration for a single model.
 */
export interface ModelPricing {
  /** The model identifier */
  model: string;
  /** Price per 1,000,000 input tokens (USD) */
  inputPricePerMillion: number;
  /** Price per 1,000,000 output tokens (USD) */
  outputPricePerMillion: number;
}

/**
 * Pricing table: model name -> pricing configuration.
 */
export type PricingTable = Map<string, ModelPricing>;

/**
 * Result of a cost calculation.
 */
export interface CostResult {
  /** Cost for input tokens (USD) */
  inputCost: number;
  /** Cost for output tokens (USD) */
  outputCost: number;
  /** Total cost (inputCost + outputCost) in USD */
  totalCost: number;
  /** The model that was used */
  model: string;
  /** Whether the model was found in the pricing table */
  priced: boolean;
}

/**
 * Returns the built-in default pricing table for major models.
 *
 * All prices are per 1,000,000 tokens in USD.
 * Sources: Public pricing as of February 2026.
 */
export function getDefaultPricing(): PricingTable {
  const table = new Map<string, ModelPricing>();

  const defaults: Array<[string, number, number]> = [
    // [model, inputPricePerMillion, outputPricePerMillion]
    ['gpt-4o', 2.50, 10.00],
    ['gpt-4o-mini', 0.15, 0.60],
    ['gpt-4.1', 2.00, 8.00],
    ['gpt-4.1-mini', 0.40, 1.60],
    ['gpt-4.1-nano', 0.10, 0.40],
    ['o3', 2.00, 8.00],
    ['o3-mini', 1.10, 4.40],
    ['o4-mini', 1.10, 4.40],
    ['claude-sonnet-4-20250514', 3.00, 15.00],
    ['claude-haiku-3-5-20241022', 0.80, 4.00],
    ['claude-opus-4-20250514', 15.00, 75.00],
    ['claude-haiku-4-5', 1.00, 5.00],
    ['claude-sonnet-4-6', 3.00, 15.00],
    ['claude-opus-4-8', 5.00, 25.00],
    ['claude-fable-5', 10.00, 50.00],
    ['gpt-5.5', 5.00, 30.00],
    ['gpt-5.4', 2.50, 15.00],
    ['gpt-5.4-mini', 0.75, 4.50],
    ['gpt-5.4-nano', 0.20, 1.25],
  ];

  for (const [model, inputPricePerMillion, outputPricePerMillion] of defaults) {
    table.set(model, { model, inputPricePerMillion, outputPricePerMillion });
  }

  return table;
}

/**
 * Load a pricing table, starting from built-in defaults and applying config overrides.
 *
 * Config prices override defaults for the same model name, allowing users to:
 * - Override default pricing for known models
 * - Add pricing for custom/private models
 *
 * @param configPricing - Optional pricing from YAML config (per-million-token pricing)
 * @returns Complete pricing table with defaults and config overrides applied
 */
export function loadPricing(
  configPricing?: Record<string, { input: number; output: number }>
): PricingTable {
  const table = getDefaultPricing();

  if (configPricing) {
    for (const [model, prices] of Object.entries(configPricing)) {
      if (typeof model !== 'string') continue;
      if (typeof prices?.input !== 'number' || typeof prices?.output !== 'number') continue;
      table.set(model, {
        model,
        inputPricePerMillion: prices.input,
        outputPricePerMillion: prices.output,
      });
    }
  }

  return table;
}

/**
 * Calculate the cost of a request from token usage and a pricing table.
 *
 * For known models: computes cost = (tokens / 1,000,000) * pricePerMillion
 * For unknown models: logs a warning, returns totalCost 0 with priced = false
 *
 * @param usage - Token usage extracted from a provider response
 * @param pricingTable - Pricing table (from loadPricing)
 * @returns Cost result with breakdown and pricing status
 */
export function calculateCost(usage: TokenUsage, pricingTable: PricingTable): CostResult {
  const pricing = pricingTable.get(usage.model);

  if (!pricing) {
    console.warn(`[govyn] WARNING: Unknown model "${usage.model}" — cost marked as unpriced`);
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      model: usage.model,
      priced: false,
    };
  }

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMillion;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    model: usage.model,
    priced: true,
  };
}
