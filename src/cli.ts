#!/usr/bin/env node

/**
 * CLI entry point for the Govyn proxy server.
 *
 * Supports subcommands:
 *   govyn          - Start the proxy server (default)
 *   govyn start    - Start the proxy server
 *   govyn init     - Interactive setup wizard
 *   govyn --help   - Show usage information
 *   govyn --version - Show version number
 */

import { startServer } from './server.js';
import { loadConfig } from './config.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import { ActionLogger } from './action-logger.js';
import type { LoopDetectionConfig, LoggingConfig } from './types.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

/**
 * Read version from package.json.
 */
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Walk up from dist/ to project root
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Print usage information.
 */
function printHelp(): void {
  console.log(`Usage: govyn [command]

Commands:
  start   Start the proxy server (default)
  init    Interactive setup wizard

Options:
  --config <path>  Path to config file (default: govyn.config.yaml)
  --help           Show this help message
  --version        Show version number`);
}

/**
 * Start the proxy server (same logic as src/index.ts).
 */
function startProxy(): void {
  // Extract --config flag
  const configIdx = args.indexOf('--config');
  const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined;

  try {
    const config = loadConfig(configPath);

    // Create shared cost aggregator
    const aggregator = new CostAggregator();
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

    // Create action logger from config (or apply defaults)
    const loggingConfig: LoggingConfig = config.logging ?? {
      enabled: true,
      directory: './logs',
      defaultMode: 'metadata' as const,
      stdout: true,
      file: true,
      maxBodySize: 1048576,
      rotationMaxSizeMb: 50,
      rotationIntervalHours: 24,
      retentionDays: 30,
      payloadRetentionDays: 7,
      agentModes: new Map(),
      storageRegion: 'auto',
    };

    let actionLogger: ActionLogger | undefined;
    if (loggingConfig.enabled) {
      actionLogger = new ActionLogger(loggingConfig);
      console.log(`[govyn] Action logging enabled: dir=${loggingConfig.directory} mode=${loggingConfig.defaultMode} stdout=${loggingConfig.stdout} file=${loggingConfig.file}`);
    }

    startServer(config, aggregator, budgetEnforcer, loopDetector, actionLogger);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[govyn] Failed to start: ${message}`);
    process.exit(1);
  }
}

// --- Main dispatch ---

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(getVersion());
  process.exit(0);
}

const command = args[0];

if (command === 'init') {
  // Dynamic import to avoid loading readline unless needed
  import('./init-wizard.js').then(({ runInitWizard }) => {
    runInitWizard().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[govyn] Init wizard failed: ${message}`);
      process.exit(1);
    });
  });
} else if (command === 'start' || command === undefined) {
  startProxy();
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
