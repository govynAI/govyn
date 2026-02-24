/**
 * Core type definitions for the Govyn proxy server.
 */

/**
 * Supported provider types for routing.
 */
export type ProviderType = 'openai' | 'anthropic' | 'custom';

/**
 * Configuration for an upstream API provider.
 */
export interface ProviderConfig {
  /** Unique name identifier for this provider */
  name: string;
  /** Base URL for the upstream API (e.g. https://api.openai.com) */
  baseUrl: string;
  /** Environment variable name to read the API key from, or null if not needed */
  apiKeyEnv: string | null;
  /** The type of provider */
  providerType: ProviderType;
}

/**
 * Result of matching a URL route to a provider.
 */
export interface RouteMatch {
  /** The resolved provider configuration */
  provider: ProviderConfig;
  /** The upstream path to forward to (e.g. /v1/chat/completions) */
  upstreamPath: string;
  /** The type of provider matched */
  providerType: ProviderType;
}

/**
 * Overall proxy server configuration.
 */
export interface ProxyConfig {
  /** TCP port to listen on */
  port: number;
  /** Host/address to bind to (e.g. 0.0.0.0) */
  host: string;
  /** Map of provider name to provider configuration */
  providers: Map<string, ProviderConfig>;
}
