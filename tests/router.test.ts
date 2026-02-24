/**
 * Tests for the URL routing module.
 */

import { describe, it, expect } from 'vitest';
import { matchRoute, createRouter } from '../src/router.js';
import type { ProviderConfig } from '../src/types.js';

// Build a test providers map
const openaiConfig: ProviderConfig = {
  name: 'openai',
  baseUrl: 'https://api.openai.com',
  apiKeyEnv: 'OPENAI_API_KEY',
  providerType: 'openai',
};

const anthropicConfig: ProviderConfig = {
  name: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  providerType: 'anthropic',
};

const myLlmConfig: ProviderConfig = {
  name: 'my-llm',
  baseUrl: 'https://my-llm.example.com',
  apiKeyEnv: 'MY_LLM_API_KEY',
  providerType: 'custom',
};

const providers = new Map<string, ProviderConfig>([
  ['openai', openaiConfig],
  ['anthropic', anthropicConfig],
  ['my-llm', myLlmConfig],
]);

describe('matchRoute', () => {
  it('matches /v1/openai/* and strips the prefix', () => {
    const result = matchRoute('/v1/openai/v1/chat/completions', providers);

    expect(result).not.toBeNull();
    expect(result!.provider).toEqual(openaiConfig);
    expect(result!.upstreamPath).toBe('/v1/chat/completions');
    expect(result!.providerType).toBe('openai');
  });

  it('matches /v1/anthropic/* and strips the prefix', () => {
    const result = matchRoute('/v1/anthropic/v1/messages', providers);

    expect(result).not.toBeNull();
    expect(result!.provider).toEqual(anthropicConfig);
    expect(result!.upstreamPath).toBe('/v1/messages');
    expect(result!.providerType).toBe('anthropic');
  });

  it('matches /v1/custom/:name/* and strips the prefix', () => {
    const result = matchRoute('/v1/custom/my-llm/v1/chat/completions', providers);

    expect(result).not.toBeNull();
    expect(result!.provider).toEqual(myLlmConfig);
    expect(result!.upstreamPath).toBe('/v1/chat/completions');
    expect(result!.providerType).toBe('custom');
  });

  it('returns null for unmatched routes', () => {
    const result = matchRoute('/unknown/path', providers);
    expect(result).toBeNull();
  });

  it('returns null for /v1/custom/:name when provider is not configured', () => {
    const result = matchRoute('/v1/custom/nonexistent/path', providers);
    expect(result).toBeNull();
  });

  it('preserves query strings in the upstream path', () => {
    const result = matchRoute('/v1/openai/v1/models?limit=10', providers);

    expect(result).not.toBeNull();
    expect(result!.upstreamPath).toBe('/v1/models?limit=10');
  });

  it('returns null when openai provider is not in the map', () => {
    const limitedProviders = new Map<string, ProviderConfig>();
    const result = matchRoute('/v1/openai/v1/chat/completions', limitedProviders);
    expect(result).toBeNull();
  });

  it('returns null when anthropic provider is not in the map', () => {
    const limitedProviders = new Map<string, ProviderConfig>();
    const result = matchRoute('/v1/anthropic/v1/messages', limitedProviders);
    expect(result).toBeNull();
  });
});

describe('createRouter', () => {
  it('creates a bound router function', () => {
    const router = createRouter(providers);
    const result = router('/v1/openai/v1/chat/completions');

    expect(result).not.toBeNull();
    expect(result!.providerType).toBe('openai');
  });

  it('returns null for unmatched routes', () => {
    const router = createRouter(providers);
    expect(router('/api/v2/unknown')).toBeNull();
  });
});
