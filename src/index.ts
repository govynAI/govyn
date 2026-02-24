/**
 * Entry point for the Govyn proxy server.
 *
 * Uses a hardcoded default configuration for now.
 * YAML config loading is added in Plan 01-02.
 */

import { startServer } from './server.js';
import { openaiProvider } from './providers/openai.js';
import { anthropicProvider } from './providers/anthropic.js';
import type { ProxyConfig } from './types.js';

const config: ProxyConfig = {
  port: parseInt(process.env['PORT'] ?? '4000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  providers: new Map([
    ['openai', openaiProvider],
    ['anthropic', anthropicProvider],
  ]),
};

startServer(config);
