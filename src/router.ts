/**
 * URL routing module for the Govyn proxy server.
 *
 * Parses incoming request URLs and matches them to provider configurations.
 * Supported patterns:
 *   /v1/openai/*          -> OpenAI provider
 *   /v1/anthropic/*       -> Anthropic provider
 *   /v1/custom/:name/*    -> Custom provider by name
 */

import type { ProviderConfig, RouteMatch } from './types.js';

/**
 * Route prefixes for versioned API routing.
 */
const ROUTE_OPENAI = '/v1/openai';
const ROUTE_ANTHROPIC = '/v1/anthropic';
const ROUTE_CUSTOM_PREFIX = '/v1/custom/';

/**
 * Parse a request URL and match it against configured providers.
 *
 * @param url - The incoming request URL (path + query string)
 * @param providers - Map of provider name to ProviderConfig
 * @returns RouteMatch if a provider is found, null otherwise
 */
export function matchRoute(
  url: string,
  providers: Map<string, ProviderConfig>,
): RouteMatch | null {
  // Normalize: strip query string for routing, keep for upstream path
  const questionMarkIdx = url.indexOf('?');
  const path = questionMarkIdx >= 0 ? url.slice(0, questionMarkIdx) : url;
  const queryString = questionMarkIdx >= 0 ? url.slice(questionMarkIdx) : '';

  // Match /v1/openai/*
  if (path.startsWith(ROUTE_OPENAI + '/') || path === ROUTE_OPENAI) {
    const provider = providers.get('openai');
    if (!provider) return null;

    // Strip /v1/openai prefix, keep the rest as upstream path
    const upstreamPath = path.slice(ROUTE_OPENAI.length) + queryString;

    return {
      provider,
      upstreamPath: upstreamPath || '/',
      providerType: 'openai',
    };
  }

  // Match /v1/anthropic/*
  if (path.startsWith(ROUTE_ANTHROPIC + '/') || path === ROUTE_ANTHROPIC) {
    const provider = providers.get('anthropic');
    if (!provider) return null;

    // Strip /v1/anthropic prefix, keep the rest as upstream path
    const upstreamPath = path.slice(ROUTE_ANTHROPIC.length) + queryString;

    return {
      provider,
      upstreamPath: upstreamPath || '/',
      providerType: 'anthropic',
    };
  }

  // Match /v1/custom/:name/*
  if (path.startsWith(ROUTE_CUSTOM_PREFIX)) {
    const afterPrefix = path.slice(ROUTE_CUSTOM_PREFIX.length);
    const slashIdx = afterPrefix.indexOf('/');

    // Extract provider name and remaining path
    let providerName: string;
    let remainingPath: string;

    if (slashIdx >= 0) {
      providerName = afterPrefix.slice(0, slashIdx);
      remainingPath = afterPrefix.slice(slashIdx) + queryString;
    } else {
      providerName = afterPrefix;
      remainingPath = '/' + queryString;
    }

    if (!providerName) return null;

    const provider = providers.get(providerName);
    if (!provider) return null;

    return {
      provider,
      upstreamPath: remainingPath || '/',
      providerType: 'custom',
    };
  }

  return null;
}

/**
 * Create a router function bound to a specific providers map.
 * Returns a function that takes a URL and returns a RouteMatch or null.
 */
export function createRouter(
  providers: Map<string, ProviderConfig>,
): (url: string) => RouteMatch | null {
  return (url: string) => matchRoute(url, providers);
}
