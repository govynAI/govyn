/**
 * Entry point for the Govyn proxy server.
 *
 * Loads configuration from govyn.config.yaml (or --config <path> CLI flag),
 * creates the cost aggregator, then starts the HTTP proxy server.
 */

import { startServer } from './server.js';
import { loadConfig } from './config.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import type { LoopDetectionConfig } from './types.js';

// Support --config <path> CLI flag
const configPath = process.argv.find((a, i) => process.argv[i - 1] === '--config');

try {
  const config = loadConfig(configPath);

  // Create shared cost aggregator (in-memory for Phase 2)
  const aggregator = new CostAggregator();

  // Log how many model prices are loaded
  const pricingSize = config.pricing.size;
  console.log(`[govyn] Cost tracking enabled with ${pricingSize} model prices`);

  // Create budget enforcer from config
  const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
  budgetEnforcer.startCleanup();
  const budgetCount = config.budgets.size;
  if (budgetCount > 0) {
    console.log(`[govyn] Budget enforcement enabled for ${budgetCount} agent(s)`);
  }

  // Create loop detector with default config and per-agent overrides
  const defaultLoopConfig: LoopDetectionConfig = {
    threshold: 10,
    windowSeconds: 60,
    cooldownSeconds: 300,
  };
  const loopDetector = new LoopDetector(defaultLoopConfig, config.agents);
  console.log(`[govyn] Loop detection enabled (default: ${defaultLoopConfig.threshold} identical calls in ${defaultLoopConfig.windowSeconds}s)`);

  startServer(config, aggregator, budgetEnforcer, loopDetector);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[govyn] Failed to start: ${message}`);
  process.exit(1);
}
