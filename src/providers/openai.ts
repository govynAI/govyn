/**
 * OpenAI provider configuration and header mapping.
 */

import type { ProviderConfig } from '../types.js';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Default OpenAI provider configuration.
 */
export const openaiProvider: ProviderConfig = {
  name: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKeyEnv: 'OPENAI_API_KEY',
  providerType: 'openai',
};

/**
 * Map incoming request headers for OpenAI upstream requests.
 *
 * - Sets Authorization: Bearer {OPENAI_API_KEY} from env var
 * - Forwards Content-Type and other relevant headers
 * - Does NOT forward the Host header (uses upstream host)
 */
export function mapOpenAIHeaders(
  incomingHeaders: IncomingHttpHeaders,
  apiKeyEnv: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // Forward relevant headers, excluding host
  const forwardHeaders = [
    'content-type',
    'content-length',
    'accept',
    'accept-encoding',
    'user-agent',
    'openai-organization',
    'openai-project',
    'x-govyn-agent',
  ];

  for (const key of forwardHeaders) {
    const value = incomingHeaders[key];
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  // Set Authorization header from env var
  if (apiKeyEnv) {
    const apiKey = process.env[apiKeyEnv];
    if (apiKey) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
  }

  return headers;
}
