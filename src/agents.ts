/**
 * Agent identification module for the Govyn proxy server.
 *
 * Resolves the identity of the agent making a request using:
 * 1. X-Govyn-Agent header (self-identified, highest priority)
 * 2. API key scoped to an agent (from Authorization Bearer token)
 * 3. Default 'unknown' agent
 */

import type { IncomingMessage } from 'node:http';
import type { AgentConfig, AgentIdentity } from './types.js';

/**
 * Resolve the agent identity from an incoming HTTP request.
 *
 * Resolution order (per ADR-014):
 * 1. X-Govyn-Agent header — any string is accepted (agents self-identify; no config lookup)
 * 2. Authorization Bearer token — looked up in the agents map for API key scoping
 * 3. Default — returns { agentId: 'unknown', source: 'default' }
 *
 * @param req - Incoming HTTP request
 * @param agents - Map of agent name to AgentConfig (from ProxyConfig)
 * @returns Resolved AgentIdentity
 */
export function resolveAgentId(
  req: IncomingMessage,
  agents: Map<string, AgentConfig>
): AgentIdentity {
  // Priority 1: X-Govyn-Agent header (case-insensitive — Node.js lowercases all headers)
  const agentHeader = req.headers['x-govyn-agent'];
  if (agentHeader) {
    const agentId = Array.isArray(agentHeader) ? agentHeader[0] : agentHeader;
    if (agentId && agentId.trim().length > 0) {
      return { agentId: agentId.trim(), source: 'header' };
    }
  }

  // Priority 2: Authorization Bearer token matched against agent API keys
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const token = extractBearerToken(authHeader);
    if (token) {
      for (const [agentName, agentConfig] of agents) {
        if (agentConfig.apiKeys && agentConfig.apiKeys.includes(token)) {
          return { agentId: agentName, source: 'api-key' };
        }
      }
    }
  }

  // Priority 3: Default unknown agent
  return { agentId: 'unknown', source: 'default' };
}

/**
 * Extract Bearer token from an Authorization header value.
 *
 * @param authHeader - Raw Authorization header value (e.g. "Bearer gvn_ra_xxxx")
 * @returns The token string, or null if not a Bearer token
 */
function extractBearerToken(authHeader: string | string[]): string | null {
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] ?? null) : null;
}
