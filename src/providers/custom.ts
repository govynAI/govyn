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

  // Forward all headers except host
  const skipHeaders = new Set(['host', 'connection', 'transfer-encoding']);

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
