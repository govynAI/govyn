import { startServer } from './server.js';
import { loadConfig } from './config.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import { ActionLogger } from './action-logger.js';
import { PolicyEngine } from './policy-engine.js';
import { ensurePolicyFile } from './policy-file.js';
import { PolicyWatcher } from './policy-watcher.js';
import { DbWriter } from './db-writer.js';
import { RetentionManager } from './db-retention.js';
import { ApprovalManager } from './approval.js';
import { ApprovalTimeoutChecker } from './approval-timeout.js';
import { AlertManager } from './alert-manager.js';
import { createPersistenceBackend } from './persistence.js';
import { isLoopbackHost } from './security.js';
import type { LoopDetectionConfig, LoggingConfig } from './types.js';

export async function startProxyRuntime(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const hasAgentApiKeys = [...config.agents.values()].some(
    (agent) => (agent.apiKeys?.length ?? 0) > 0,
  );

  if (config.security?.requireAgentApiKey) {
    if (!hasAgentApiKeys) {
      throw new Error(
        'Proxy request authentication is enabled, but no agents.api_keys are configured. Add at least one agent API key or set security.require_agent_api_key: false explicitly.',
      );
    }
    console.log('[govyn] Proxy request authentication enabled: valid agent API key required for proxied model traffic');
  } else if (!isLoopbackHost(config.host)) {
    console.warn(
      `[govyn] Warning: proxy is listening on ${config.host} without agent API key enforcement. This exposes an unauthenticated upstream-spending surface.`,
    );
  }

  const aggregator = new CostAggregator();
  console.log(`[govyn] Cost tracking enabled with ${config.pricing.size} model prices`);

  const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
  budgetEnforcer.startCleanup();
  if (config.budgets.size > 0) {
    console.log(`[govyn] Budget enforcement enabled for ${config.budgets.size} agent(s)`);
  }

  const defaultLoopConfig: LoopDetectionConfig = {
    threshold: 10,
    windowSeconds: 60,
    cooldownSeconds: 300,
  };
  const loopDetector = new LoopDetector(defaultLoopConfig, config.agents);
  console.log(`[govyn] Loop detection enabled (default: ${defaultLoopConfig.threshold} identical calls in ${defaultLoopConfig.windowSeconds}s)`);

  const loggingConfig: LoggingConfig = config.logging ?? {
    enabled: true,
    directory: './logs',
    defaultMode: 'metadata',
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

  const policyEngine = new PolicyEngine();
  policyEngine.setCostAggregator(aggregator);

  if (config.policiesFile) {
    const ensuredPolicyFile = ensurePolicyFile(config.policiesFile);
    if (ensuredPolicyFile.created) {
      console.log(`[govyn] Created local policy file at ${ensuredPolicyFile.path}`);
    }

    const policyResult = policyEngine.loadFromFile(config.policiesFile);
    if (policyResult.success) {
      console.log(`[govyn] Loaded ${policyResult.policies.length} policies from ${config.policiesFile}`);
    } else {
      console.error(`[govyn] Failed to load policies from ${config.policiesFile}:`);
      for (const err of policyResult.errors) {
        const loc = err.line ? ` (line ${err.line})` : '';
        console.error(`  - ${err.message}${loc}`);
      }
    }
  }

  if (config.policiesFile) {
    const watcher = new PolicyWatcher(policyEngine, config.policiesFile);
    watcher.start();
    console.log(`[govyn] Watching policy file for changes: ${config.policiesFile}`);
  }

  let dbWriter: DbWriter | undefined;
  let approvalManager: ApprovalManager | undefined;
  let approvalTimeoutChecker: ApprovalTimeoutChecker | undefined;
  let alertManager: AlertManager | undefined;
  let closePersistence: (() => Promise<void>) | undefined;

  if (config.database) {
    try {
      const persistence = await createPersistenceBackend(config.database);
      closePersistence = () => persistence.close();
      console.log(`[govyn] ${persistence.kind === 'sqlite' ? 'SQLite' : 'PostgreSQL'} persistence ready: ${config.database.url}`);

      dbWriter = new DbWriter(persistence, config.database.failOpen);

      approvalManager = new ApprovalManager(persistence);
      approvalTimeoutChecker = new ApprovalTimeoutChecker(persistence);
      approvalTimeoutChecker.start();
      console.log('[govyn] Approval queue enabled');

      alertManager = new AlertManager(persistence);
      await alertManager.start();
      console.log('[govyn] Alert manager started');

      const retentionManager = new RetentionManager(
        persistence,
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

  const handleShutdown = async () => {
    approvalTimeoutChecker?.stop();
    alertManager?.stop();
    try {
      await closePersistence?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Failed to close persistence cleanly: ${message}\n`);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => { void handleShutdown(); });
  process.on('SIGINT', () => { void handleShutdown(); });

  startServer(
    config,
    aggregator,
    budgetEnforcer,
    loopDetector,
    actionLogger,
    policyEngine,
    dbWriter,
    approvalManager,
    config.policiesFile,
    undefined,
    alertManager,
  );
}
