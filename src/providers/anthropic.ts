/**
 * Anthropic provider configuration and header mapping.
 */

import type { ProviderConfig } from '../types.js';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Default Anthropic provider configuration.
 */
export const anthropicProvider: ProviderConfig = {
  name: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  providerType: 'anthropic',
};

/**
 * Map incoming request headers for Anthropic upstream requests.
 *
 * - Sets x-api-key: {ANTHROPIC_API_KEY} from env var
 * - Sets anthropic-version header if not already present
 * - Forwards Content-Type and other relevant headers
 * - Does NOT forward the Host header (uses upstream host)
 */
export function mapAnthropicHeaders(
  incomingHeaders: IncomingHttpHeaders,
  apiKeyEnv: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Forward relevant headers, excluding host
  const forwardHeaders = [
    'content-type',
    'content-length',
    'accept',
    'user-agent',
    'x-govyn-agent',
  ];

  for (const key of forwardHeaders) {
    const value = incomingHeaders[key];
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  // Forward anthropic-specific headers if present
  const anthropicHeaders = [
    'anthropic-version',
    'anthropic-beta',
  ];
  for (const key of anthropicHeaders) {
    const value = incomingHeaders[key];
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  // Set default anthropic-version if not provided
  if (!headers['anthropic-version']) {
    headers['anthropic-version'] = '2023-06-01';
  }

  // Set x-api-key header from env var
  if (apiKeyEnv) {
    const apiKey = process.env[apiKeyEnv];
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
  }

  return headers;
}
