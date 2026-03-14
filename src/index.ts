/**
 * Entry point for the Govyn proxy server.
 *
 * Loads configuration from govyn.config.yaml (or --config <path> CLI flag),
 * initializes persistence and policy/runtime services, then starts the HTTP proxy server.
 */

import { startProxyRuntime } from './runtime.js';

const configPath = process.argv.find((a, i) => process.argv[i - 1] === '--config');

startProxyRuntime(configPath).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[govyn] Failed to start: ${message}`);
  process.exit(1);
});
