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
import { ActionLogger } from './action-logger.js';
import { PolicyEngine } from './policy-engine.js';
import { PolicyWatcher } from './policy-watcher.js';
import { createPool, runMigrations } from './db.js';
import { DbWriter } from './db-writer.js';
import { RetentionManager } from './db-retention.js';
import { ApprovalManager } from './approval.js';
import { ApprovalTimeoutChecker } from './approval-timeout.js';
import { AlertManager } from './alert-manager.js';
import type { LoopDetectionConfig, LoggingConfig } from './types.js';

// Support --config <path> CLI flag
const configPath = process.argv.find((a, i) => process.argv[i - 1] === '--config');

async function main(): Promise<void> {
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

  // Create policy engine
  const policyEngine = new PolicyEngine();
  policyEngine.setCostAggregator(aggregator);

  // Load policies from file if configured
  if (config.policiesFile) {
    const policyResult = policyEngine.loadFromFile(config.policiesFile);
    if (policyResult.success) {
      console.log(`[govyn] Loaded ${policyResult.policies.length} policies from ${config.policiesFile}`);
    } else {
      console.error(`[govyn] Failed to load policies from ${config.policiesFile}:`);
      for (const err of policyResult.errors) {
        const loc = err.line ? ` (line ${err.line})` : '';
        console.error(`  - ${err.message}${loc}`);
      }
      // Continue without policies — fail-open per ADR-002
    }
  }

  // Start policy file watcher for hot reload
  if (config.policiesFile) {
    const watcher = new PolicyWatcher(policyEngine, config.policiesFile);
    watcher.start();
    console.log(`[govyn] Watching policy file for changes: ${config.policiesFile}`);
  }

  // Initialize database persistence (optional — proxy runs without DB if not configured)
  let dbWriter: DbWriter | undefined;
  let approvalManager: ApprovalManager | undefined;
  let approvalTimeoutChecker: ApprovalTimeoutChecker | undefined;
  let alertManager: AlertManager | undefined;
  let sql: ReturnType<typeof createPool> | undefined;
  if (config.database) {
    try {
      sql = createPool(config.database.url);
      await runMigrations(sql);
      console.log('[govyn] Database connected and migrations applied');

      dbWriter = new DbWriter(sql, config.database.failOpen);

      // Create approval manager and timeout checker
      approvalManager = new ApprovalManager(sql);
      approvalTimeoutChecker = new ApprovalTimeoutChecker(sql);
      approvalTimeoutChecker.start();
      console.log('[govyn] Approval queue enabled (timeout checker running)');

      // Create and start alert manager
      alertManager = new AlertManager(sql);
      await alertManager.start();
      console.log('[govyn] Alert manager started');

      // Start retention cleanup on an interval (every 6 hours, unref'd)
      const retentionManager = new RetentionManager(
        sql,
        config.database.retentionDays,
        config.database.approvalRetentionDays,
      );
      const retentionInterval = setInterval(() => {
        retentionManager.runAll().catch(() => {});
      }, 6 * 60 * 60 * 1000);
      retentionInterval.unref();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (config.database.failOpen) {
        console.error(`[govyn] Database connection failed (fail-open, continuing without persistence): ${message}`);
      } else {
        throw new Error(`Database connection failed (fail-closed): ${message}`);
      }
    }
  } else {
    console.log('[govyn] No database configured — running without persistence');
  }

  // Graceful shutdown: stop the approval timeout checker on process exit
  const handleShutdown = () => {
    approvalTimeoutChecker?.stop();
    alertManager?.stop();
    process.exit(0);
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);

  startServer(config, aggregator, budgetEnforcer, loopDetector, actionLogger, policyEngine, dbWriter, approvalManager, config.policiesFile, sql, alertManager);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[govyn] Failed to start: ${message}`);
  process.exit(1);
});
