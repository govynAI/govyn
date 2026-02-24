/**
 * Tests for the agent identification module (src/agents.ts).
 */

import { describe, it, expect } from 'vitest';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { resolveAgentId } from '../src/agents.js';
import type { AgentConfig } from '../src/types.js';

/**
 * Create a minimal IncomingMessage-like object with the given headers.
 */
function makeRequest(headers: Record<string, string | string[]>): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  // Normalize headers to lowercase (Node.js HTTP does this automatically)
  for (const [key, value] of Object.entries(headers)) {
    req.headers[key.toLowerCase()] = value;
  }
  return req;
}

/**
 * Build a sample agents map for testing.
 */
function makeAgents(
  entries: Array<{ name: string; apiKeys?: string[] }>
): Map<string, AgentConfig> {
  const map = new Map<string, AgentConfig>();
  for (const entry of entries) {
    map.set(entry.name, { name: entry.name, apiKeys: entry.apiKeys });
  }
  return map;
}

describe('resolveAgentId', () => {
  it('resolves agent from X-Govyn-Agent header', () => {
    const req = makeRequest({ 'x-govyn-agent': 'research-agent' });
    const agents = makeAgents([]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('research-agent');
    expect(result.source).toBe('header');
  });

  it('resolves agent from X-GOVYN-AGENT header (uppercase — headers are case-insensitive)', () => {
    // Node.js lowercases all incoming headers, but simulate the lowercased result
    const req = makeRequest({ 'x-govyn-agent': 'sales-bot' });
    const agents = makeAgents([]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('sales-bot');
    expect(result.source).toBe('header');
  });

  it('resolves agent from API key matching an agent apiKeys array', () => {
    const req = makeRequest({ authorization: 'Bearer gvn_ra_xxxx' });
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
      { name: 'sales-bot', apiKeys: ['gvn_sb_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('research-agent');
    expect(result.source).toBe('api-key');
  });

  it('resolves to unknown when API key does not match any agent', () => {
    const req = makeRequest({ authorization: 'Bearer gvn_unknown_key' });
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('unknown');
    expect(result.source).toBe('default');
  });

  it('resolves to unknown with source default when no header and no matching key', () => {
    const req = makeRequest({});
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('unknown');
    expect(result.source).toBe('default');
  });

  it('prefers header over API key when both are present', () => {
    const req = makeRequest({
      'x-govyn-agent': 'header-agent',
      authorization: 'Bearer gvn_ra_xxxx',
    });
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('header-agent');
    expect(result.source).toBe('header');
  });

  it('resolves header-based agent even with empty agents map', () => {
    const req = makeRequest({ 'x-govyn-agent': 'some-agent' });
    const agents = makeAgents([]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('some-agent');
    expect(result.source).toBe('header');
  });

  it('resolves to unknown with empty agents map and no header', () => {
    const req = makeRequest({ authorization: 'Bearer gvn_anything' });
    const agents = makeAgents([]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('unknown');
    expect(result.source).toBe('default');
  });

  it('does not validate header value against agents config (any string is accepted)', () => {
    const req = makeRequest({ 'x-govyn-agent': 'non-existent-agent' });
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    // Header value is accepted as-is, even if not in config
    expect(result.agentId).toBe('non-existent-agent');
    expect(result.source).toBe('header');
  });

  it('resolves correct agent when multiple agents share similar API key prefixes', () => {
    const req = makeRequest({ authorization: 'Bearer gvn_sb_xxxx' });
    const agents = makeAgents([
      { name: 'research-agent', apiKeys: ['gvn_ra_xxxx'] },
      { name: 'sales-bot', apiKeys: ['gvn_sb_xxxx'] },
    ]);

    const result = resolveAgentId(req, agents);

    expect(result.agentId).toBe('sales-bot');
    expect(result.source).toBe('api-key');
  });
});
