/**
 * Entry point for the Govyn proxy server.
 *
 * Loads configuration from govyn.config.yaml (or --config <path> CLI flag),
 * then starts the HTTP proxy server.
 */

import { startServer } from './server.js';
import { loadConfig } from './config.js';

// Support --config <path> CLI flag
const configPath = process.argv.find((a, i) => process.argv[i - 1] === '--config');

try {
  const config = loadConfig(configPath);
  startServer(config);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[govyn] Failed to start: ${message}`);
  process.exit(1);
}
