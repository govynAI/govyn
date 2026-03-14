/**
 * Custom provider configuration and header mapping.
 */

import type { ProviderConfig } from '../types.js';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Create a custom provider config from a name and partial config.
 */
export function createCustomProvider(
  name: string,
  options: {
    baseUrl: string;
    apiKeyEnv?: string | null;
  },
): ProviderConfig {
  return {
    name,
    baseUrl: options.baseUrl,
    apiKeyEnv: options.apiKeyEnv ?? null,
    providerType: 'custom',
  };
}

/**
 * Map incoming request headers for a custom provider upstream request.
 *
 * - Forwards the API key from the configured env var (if set)
 * - Passes through all headers except Host
 */
export function mapCustomHeaders(
  incomingHeaders: IncomingHttpHeaders,
  apiKeyEnv: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Never forward hop-by-hop or Govyn-internal auth headers to upstreams.
  const skipHeaders = new Set([
    'authorization',
    'connection',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'x-govyn-admin-key',
    'x-govyn-approval',
  ]);

  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (skipHeaders.has(key.toLowerCase())) continue;
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  // Override authorization from env var if configured
  if (apiKeyEnv) {
    const apiKey = process.env[apiKeyEnv];
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
  }

  return headers;
}
