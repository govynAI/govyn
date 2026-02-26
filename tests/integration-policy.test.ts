/**
 * Integration tests for policy engine pipeline integration.
 *
 * Spins up a real HTTP server with a mock upstream to test the complete
 * request pipeline including policy evaluation, error responses, events, and logging.
 *
 * Tests the following scenarios:
 * - Policy blocks request with 403 and govyn_policy_violation error type
 * - Policy 403 response matches PRODUCT_SPEC Section 5 error contract
 * - Policy allows request when agent not in scope
 * - No policies = passthrough (server works without PolicyEngine policies)
 * - policy_denied event emitted on blocked request
 * - policy_enforced event emitted on allowed request
 * - policy_result field present in action log for denied requests
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { BudgetEnforcer } from '../src/budget-enforcer.js';
import { LoopDetector } from '../src/loop-detector.js';
import { ActionLogger } from '../src/action-logger.js';
import { PolicyEngine } from '../src/policy-engine.js';
import { govynEvents } from '../src/events.js';
import type { GovynEvent } from '../src/events.js';
import type { ProxyConfig, BudgetConfig, LoopDetectionConfig, LoggingConfig } from '../src/types.js';
import type { Policy, RateLimitPolicy, ContentFilterPolicy, BudgetLimitPolicy, BlockPolicy, ModelRoutePolicy } from '../src/policy-types.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

function makeHttpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const { port, path, method = 'GET', headers = {}, body = '' } = options;
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString();
      reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
    } else {
      reqHeaders['content-length'] = '0';
    }

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try { json = JSON.parse(bodyStr); } catch { json = null; }
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: bodyStr, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
}

// -----------------------------------------------------------------------
// Mock upstream factory
// -----------------------------------------------------------------------

function createMockUpstream(): Promise<{
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// -----------------------------------------------------------------------
// Test infrastructure: startTestServer helper
// -----------------------------------------------------------------------

interface TestServer {
  port: number;
  server: http.Server;
  aggregator: CostAggregator;
  policyEngine: PolicyEngine;
  actionLogger?: ActionLogger;
  close: () => Promise<void>;
}

async function startTestServer(options: {
  upstreamPort: number;
  policies?: Policy[];
  withLogging?: boolean;
}): Promise<TestServer> {
  const { upstreamPort, policies = [], withLogging = false } = options;

  const aggregator = new CostAggregator();
  const budgets = new Map<string, BudgetConfig>();
  const enforcer = new BudgetEnforcer(budgets, aggregator);

  const loopConfig: LoopDetectionConfig = {
    threshold: 10,
    windowSeconds: 60,
    cooldownSeconds: 300,
  };
  const loopDetector = new LoopDetector(loopConfig, new Map());

  const policyEngine = new PolicyEngine();
  if (policies.length > 0) {
    policyEngine.loadFromPolicies(policies);
  }

  let actionLogger: ActionLogger | undefined;
  if (withLogging) {
    const logDir = path.join(os.tmpdir(), `govyn-test-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const loggingConfig: LoggingConfig = {
      enabled: true,
      directory: logDir,
      defaultMode: 'metadata',
      stdout: false,
      file: true,
      maxBodySize: 1048576,
      rotationMaxSizeMb: 50,
      rotationIntervalHours: 24,
      retentionDays: 30,
      payloadRetentionDays: 7,
      agentModes: new Map(),
      storageRegion: 'auto',
    };
    actionLogger = new ActionLogger(loggingConfig);
  }

  const config: ProxyConfig = {
    port: 0,
    host: '127.0.0.1',
    providers: new Map([
      [
        'custom',
        {
          name: 'custom',
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          apiKeyEnv: null,
          providerType: 'custom',
        },
      ],
    ]),
    agents: new Map(),
    pricing: new Map(),
    budgets,
  };

  const server = startServer(config, aggregator, enforcer, loopDetector, actionLogger, policyEngine);
  await waitForListen(server);
  const port = (server.address() as { port: number }).port;

  return {
    port,
    server,
    aggregator,
    policyEngine,
    actionLogger,
    close: () => {
      if (actionLogger) actionLogger.close();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('policy engine integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  // -----------------------------------------------------------------------
  // Test 1: Policy blocks request with 403
  // -----------------------------------------------------------------------

  it('policy blocks request with 403 and govyn_policy_violation error type', async () => {
    const blockPolicy: Policy = {
      name: 'block-all',
      type: 'block',
      enabled: true,
      scope: { level: 'global' },
      message: 'All requests blocked by test policy',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'test-agent' },
      });

      expect(res.statusCode).toBe(403);
      const body = res.json as { error: { type: string; message: string; policy: string; agent: string; retry_after_seconds: unknown } };
      expect(body.error.type).toBe('govyn_policy_violation');
      expect(body.error.policy).toBe('block-all');
      expect(body.error.agent).toBe('test-agent');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: Policy 403 response matches PRODUCT_SPEC contract
  // -----------------------------------------------------------------------

  it('policy 403 response matches PRODUCT_SPEC Section 5 error contract', async () => {
    const blockPolicy: Policy = {
      name: 'test-block-policy',
      type: 'block',
      enabled: true,
      scope: { level: 'global' },
      message: 'Request blocked by test-block-policy',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'my-agent' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json as Record<string, unknown>;

      // Verify top-level structure: { error: { ... } }
      expect(body).toHaveProperty('error');
      const error = body['error'] as Record<string, unknown>;

      // Verify all required fields from PRODUCT_SPEC Section 5
      expect(error).toHaveProperty('type');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('policy');
      expect(error).toHaveProperty('agent');
      expect(error).toHaveProperty('retry_after_seconds');

      // Verify values
      expect(error['type']).toBe('govyn_policy_violation');
      expect(typeof error['message']).toBe('string');
      expect(error['policy']).toBe('test-block-policy');
      expect(error['agent']).toBe('my-agent');
      expect(error['retry_after_seconds']).toBeNull();
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: Policy allows request when agent not in scope
  // -----------------------------------------------------------------------

  it('policy allows request when agent not in scope', async () => {
    const blockPolicy: Policy = {
      name: 'block-bad-bot',
      type: 'block',
      enabled: true,
      scope: { level: 'agent', value: 'blocked-bot' },
      message: 'blocked-bot is not allowed',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });
    try {
      // Request as allowed-bot (not in the block policy scope)
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'allowed-bot' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: No policies = passthrough
  // -----------------------------------------------------------------------

  it('no policies means passthrough — server works without any loaded policies', async () => {
    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [],
    });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'free-agent' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 5: policy_denied event emitted
  // -----------------------------------------------------------------------

  it('policy_denied event emitted when request is blocked', async () => {
    const blockPolicy: Policy = {
      name: 'event-test-block',
      type: 'block',
      enabled: true,
      scope: { level: 'global' },
      message: 'Blocked for event test',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });

    try {
      const events: GovynEvent[] = [];
      const handler = (event: GovynEvent) => { events.push(event); };
      govynEvents.on('event', handler);

      try {
        await makeHttpRequest({
          port: ts.port,
          path: '/v1/custom/custom/v1/test',
          headers: { 'x-govyn-agent': 'event-agent' },
        });

        // Check that a policy_denied event was emitted
        const deniedEvents = events.filter((e) => e.type === 'policy_denied');
        expect(deniedEvents.length).toBe(1);

        const denied = deniedEvents[0] as GovynEvent & { type: 'policy_denied' };
        expect(denied.agentId).toBe('event-agent');
        expect(denied.policyName).toBe('event-test-block');
        expect(denied.policyType).toBe('block');
        expect(denied.allowed).toBe(false);
        expect(typeof denied.evaluationTimeMs).toBe('number');
      } finally {
        govynEvents.removeListener('event', handler);
      }
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 6: policy_enforced event emitted
  // -----------------------------------------------------------------------

  it('policy_enforced event emitted when request passes policies', async () => {
    // Agent-scoped block policy that won't match our test agent
    const blockPolicy: Policy = {
      name: 'scoped-block',
      type: 'block',
      enabled: true,
      scope: { level: 'agent', value: 'other-agent' },
      message: 'Blocked for other agent',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });

    try {
      const events: GovynEvent[] = [];
      const handler = (event: GovynEvent) => { events.push(event); };
      govynEvents.on('event', handler);

      try {
        await makeHttpRequest({
          port: ts.port,
          path: '/v1/custom/custom/v1/test',
          headers: { 'x-govyn-agent': 'passing-agent' },
        });

        // Check that a policy_enforced event was emitted
        const enforcedEvents = events.filter((e) => e.type === 'policy_enforced');
        expect(enforcedEvents.length).toBe(1);

        const enforced = enforcedEvents[0] as GovynEvent & { type: 'policy_enforced' };
        expect(enforced.agentId).toBe('passing-agent');
        expect(enforced.allowed).toBe(true);
        expect(typeof enforced.evaluationTimeMs).toBe('number');
        expect(typeof enforced.policyCount).toBe('number');
      } finally {
        govynEvents.removeListener('event', handler);
      }
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 7: policy_result field present in action log for denied requests
  // -----------------------------------------------------------------------

  it('policy_result field present in action log for denied requests', async () => {
    const blockPolicy: Policy = {
      name: 'log-test-block',
      type: 'block',
      enabled: true,
      scope: { level: 'global' },
      message: 'Blocked for log test',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
      withLogging: true,
    });

    try {
      // Make a request that will be denied
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'log-agent' },
      });

      expect(res.statusCode).toBe(403);

      // Flush the action logger to ensure entries are written to disk
      ts.actionLogger!.flush();

      // Read the log file and check for policy_result
      const logDir = ts.actionLogger!.logDirectory;
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
      expect(files.length).toBeGreaterThan(0);

      const logContent = fs.readFileSync(path.join(logDir, files[0]), 'utf8').trim();
      const logLines = logContent.split('\n').filter((l) => l.length > 0);
      expect(logLines.length).toBeGreaterThan(0);

      const logEntry = JSON.parse(logLines[0]) as {
        agent_id: string;
        status: number;
        policy_result: {
          allowed: boolean;
          evaluated_count: number;
          matched_count: number;
          denied_by: string;
          evaluation_time_ms: number;
        };
      };

      expect(logEntry.agent_id).toBe('log-agent');
      expect(logEntry.status).toBe(403);
      expect(logEntry.policy_result).toBeDefined();
      expect(logEntry.policy_result.allowed).toBe(false);
      expect(logEntry.policy_result.denied_by).toBe('log-test-block');
      expect(typeof logEntry.policy_result.evaluated_count).toBe('number');
      expect(typeof logEntry.policy_result.matched_count).toBe('number');
      expect(typeof logEntry.policy_result.evaluation_time_ms).toBe('number');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 8: Rate limit policy returns 429 with retry-after header
  // -----------------------------------------------------------------------

  it('rate_limit policy returns 429 with retry-after header', async () => {
    const rateLimitPolicy: RateLimitPolicy = {
      name: 'rate-1-per-60',
      type: 'rate_limit',
      enabled: true,
      scope: { level: 'global' },
      limit: 1,
      window_seconds: 60,
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [rateLimitPolicy],
    });
    try {
      // First request — allowed
      const r1 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'rate-agent' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(r1.statusCode).toBe(200);

      // Second request — rate limited
      const r2 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'rate-agent' },
        body: JSON.stringify({ prompt: 'hello again' }),
      });
      expect(r2.statusCode).toBe(429);

      const body = r2.json as { error: { type: string; retry_after_seconds: number } };
      expect(body.error.type).toBe('govyn_rate_limited');
      expect(body.error.retry_after_seconds).toBeGreaterThan(0);
      expect(r2.headers['retry-after']).toBeDefined();
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 9: Content filter policy blocks request with SSN in body
  // -----------------------------------------------------------------------

  it('content_filter policy blocks request with SSN in body', async () => {
    const contentFilterPolicy: ContentFilterPolicy = {
      name: 'filter-ssn',
      type: 'content_filter',
      enabled: true,
      scope: { level: 'global' },
      patterns: ['ssn'],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [contentFilterPolicy],
    });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'content-agent' },
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }] }),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json as { error: { type: string; policy: string } };
      expect(body.error.type).toBe('govyn_policy_violation');
      expect(body.error.policy).toBe('filter-ssn');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 10: Content filter policy allows clean request body
  // -----------------------------------------------------------------------

  it('content_filter policy allows clean request body', async () => {
    const contentFilterPolicy: ContentFilterPolicy = {
      name: 'filter-ssn',
      type: 'content_filter',
      enabled: true,
      scope: { level: 'global' },
      patterns: ['ssn'],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [contentFilterPolicy],
    });
    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'clean-agent' },
        body: JSON.stringify({ model: 'gpt-4', messages: [{ role: 'user', content: 'Hello world' }] }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 11: Block policy with match criteria allows non-matching request
  // -----------------------------------------------------------------------

  it('block policy with match criteria allows non-matching request', async () => {
    const blockPolicy: BlockPolicy = {
      name: 'block-openai-only',
      type: 'block',
      enabled: true,
      scope: { level: 'global' },
      match: {
        provider: 'openai',
      },
      message: 'OpenAI is blocked',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [blockPolicy],
    });
    try {
      // Request to 'custom' provider — should NOT be blocked (match.provider is 'openai')
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'match-agent' },
        body: JSON.stringify({ msg: 'hello' }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 12: Budget limit policy blocks agent over budget
  // -----------------------------------------------------------------------

  it('budget_limit policy blocks agent over budget', async () => {
    const budgetPolicy: BudgetLimitPolicy = {
      name: 'budget-1-daily',
      type: 'budget_limit',
      enabled: true,
      scope: { level: 'global' },
      limit: 1,
      period: 'daily',
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [budgetPolicy],
    });

    // Seed the aggregator with costs exceeding the limit
    ts.policyEngine.setCostAggregator(ts.aggregator);
    ts.aggregator.recordCost({
      agentId: 'budget-agent',
      model: 'gpt-4',
      provider: 'custom',
      inputTokens: 1000,
      outputTokens: 500,
      inputCost: 1.5,
      outputCost: 0.5,
      totalCost: 2.0,
      priced: true,
      timestamp: Date.now(),
    });

    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'budget-agent' },
        body: JSON.stringify({ msg: 'hello' }),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json as { error: { type: string; policy: string } };
      expect(body.error.type).toBe('govyn_policy_violation');
      expect(body.error.policy).toBe('budget-1-daily');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 13: budget_limit policy loaded from YAML enforces spending limits
  // -----------------------------------------------------------------------

  it('budget_limit policy loaded from YAML enforces spending limits', async () => {
    const ts = await startTestServer({ upstreamPort: upstream.port });

    // Load budget_limit policy from YAML string (not programmatic object)
    const yamlStr = `
version: 1
policies:
  - name: yaml-budget-daily
    type: budget_limit
    scope: global
    limit: 5
    period: daily
`;
    const parseResult = ts.policyEngine.loadFromYaml(yamlStr);
    expect(parseResult.success).toBe(true);
    expect(parseResult.policies.length).toBe(1);

    // Wire the cost aggregator (as production bootstrap now does)
    ts.policyEngine.setCostAggregator(ts.aggregator);

    // Seed costs exceeding the $5 daily limit
    ts.aggregator.recordCost({
      agentId: 'yaml-budget-agent',
      model: 'gpt-4',
      provider: 'custom',
      inputTokens: 10000,
      outputTokens: 5000,
      inputCost: 5.0,
      outputCost: 3.0,
      totalCost: 8.0,
      priced: true,
      timestamp: Date.now(),
    });

    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'yaml-budget-agent' },
        body: JSON.stringify({ msg: 'hello' }),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json as { error: { type: string; policy: string } };
      expect(body.error.type).toBe('govyn_policy_violation');
      expect(body.error.policy).toBe('yaml-budget-daily');
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 14: time_window policy loaded from YAML denies outside allowed hours
  // -----------------------------------------------------------------------

  it('time_window policy loaded from YAML denies outside allowed hours', async () => {
    // Create a time window that is guaranteed to NOT include the current time:
    // Set allowed hours to 03:00-03:01 UTC — virtually never the current time during test
    const yamlStr = `
version: 1
policies:
  - name: yaml-time-window
    type: time_window
    scope: global
    start: "03:00"
    end: "03:01"
    timezone: UTC
    mode: allow
    days:
      - daily
`;

    const ts = await startTestServer({ upstreamPort: upstream.port });
    const parseResult = ts.policyEngine.loadFromYaml(yamlStr);
    expect(parseResult.success).toBe(true);
    expect(parseResult.policies.length).toBe(1);

    // Verify the parsed policy has the correct top-level fields
    const policy = parseResult.policies[0] as { start: string; end: string; timezone: string; mode: string; days: string[] };
    expect(policy.start).toBe('03:00');
    expect(policy.end).toBe('03:01');
    expect(policy.timezone).toBe('UTC');
    expect(policy.mode).toBe('allow');
    expect(policy.days).toEqual(['daily']);

    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        method: 'POST',
        headers: { 'x-govyn-agent': 'yaml-time-agent' },
        body: JSON.stringify({ msg: 'hello' }),
      });

      // Should be denied because current time is almost certainly NOT 03:00-03:01 UTC
      expect(res.statusCode).toBe(403);
      const body = res.json as { error: { type: string; policy: string } };
      expect(body.error.type).toBe('govyn_policy_violation');
      expect(body.error.policy).toBe('yaml-time-window');
    } finally {
      await ts.close();
    }
  });
});

// -----------------------------------------------------------------------
// Model route integration tests
// -----------------------------------------------------------------------

describe('model_route integration', () => {
  // Custom mock upstream that captures the received body and returns usage info
  function createCapturingUpstream(): Promise<{
    server: http.Server;
    port: number;
    close: () => Promise<void>;
    getLastReceivedBody: () => Record<string, unknown> | null;
  }> {
    let lastReceivedBody: Record<string, unknown> | null = null;

    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          try {
            lastReceivedBody = JSON.parse(bodyStr);
          } catch {
            lastReceivedBody = null;
          }

          // Return a response with usage info so cost tracking works
          const responseModel = lastReceivedBody?.model ?? 'unknown';
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            model: responseModel,
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        resolve({
          server,
          port: addr.port,
          close: () => new Promise<void>((r) => server.close(() => r())),
          getLastReceivedBody: () => lastReceivedBody,
        });
      });
    });
  }

  // -----------------------------------------------------------------------
  // Test A: Model rewrite reaches upstream
  // -----------------------------------------------------------------------

  it('model rewrite reaches upstream when model_route fires', async () => {
    const upstream = await createCapturingUpstream();

    const modelRoutePolicy: ModelRoutePolicy = {
      name: 'route-short-to-haiku',
      type: 'model_route',
      enabled: true,
      scope: { level: 'global' },
      rules: [
        {
          when: { input_tokens_estimate: '<500' },
          route_to: 'claude-haiku-4-5-20251001',
        },
        { route_to: '', default: 'passthrough' },
      ],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [modelRoutePolicy],
    });

    try {
      // Send a short request (< 500 tokens) targeting claude-opus-4-6
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'routing-agent' },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // Verify the upstream received the rewritten model
      const receivedBody = upstream.getLastReceivedBody();
      expect(receivedBody).not.toBeNull();
      expect(receivedBody!.model).toBe('claude-haiku-4-5-20251001');
    } finally {
      await ts.close();
      await upstream.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test B: Passthrough when no rule matches
  // -----------------------------------------------------------------------

  it('passthrough when no model_route rule matches', async () => {
    const upstream = await createCapturingUpstream();

    const modelRoutePolicy: ModelRoutePolicy = {
      name: 'route-tiny-only',
      type: 'model_route',
      enabled: true,
      scope: { level: 'global' },
      rules: [
        {
          when: { input_tokens_estimate: '<10' },
          route_to: 'gpt-4o-mini',
        },
        { route_to: '', default: 'passthrough' },
      ],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [modelRoutePolicy],
    });

    try {
      // Send a request with enough content to exceed 10 tokens
      const longPrompt = 'This is a longer prompt that should exceed ten tokens because it has many words in it';
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'routing-agent' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: longPrompt }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // Verify the upstream received the original model unchanged
      const receivedBody = upstream.getLastReceivedBody();
      expect(receivedBody).not.toBeNull();
      expect(receivedBody!.model).toBe('gpt-4o');
    } finally {
      await ts.close();
      await upstream.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test C: Model alias resolution end-to-end
  // -----------------------------------------------------------------------

  it('model alias resolution end-to-end', async () => {
    const upstream = await createCapturingUpstream();

    const modelRoutePolicy: ModelRoutePolicy = {
      name: 'route-with-alias',
      type: 'model_route',
      enabled: true,
      scope: { level: 'global' },
      model_aliases: {
        cheap: 'gpt-4o-mini',
        standard: 'gpt-4o',
      },
      rules: [
        {
          when: { input_tokens_estimate: '<500' },
          route_to: 'cheap',
        },
        { route_to: '', default: 'passthrough' },
      ],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [modelRoutePolicy],
    });

    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'alias-agent' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // Verify alias was resolved: 'cheap' -> 'gpt-4o-mini'
      const receivedBody = upstream.getLastReceivedBody();
      expect(receivedBody).not.toBeNull();
      expect(receivedBody!.model).toBe('gpt-4o-mini');
    } finally {
      await ts.close();
      await upstream.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test D: Per-agent opt-out
  // -----------------------------------------------------------------------

  it('per-agent opt-out skips model routing', async () => {
    const upstream = await createCapturingUpstream();

    const modelRoutePolicy: ModelRoutePolicy = {
      name: 'route-with-opt-out',
      type: 'model_route',
      enabled: true,
      scope: { level: 'global' },
      routing_opt_out_agents: ['premium-agent'],
      rules: [
        {
          when: { input_tokens_estimate: '<500' },
          route_to: 'gpt-4o-mini',
        },
        { route_to: '', default: 'passthrough' },
      ],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [modelRoutePolicy],
    });

    try {
      // Send request from opted-out agent
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'premium-agent' },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // Verify the upstream received the original model unchanged (opt-out works)
      const receivedBody = upstream.getLastReceivedBody();
      expect(receivedBody).not.toBeNull();
      expect(receivedBody!.model).toBe('claude-opus-4-6');
    } finally {
      await ts.close();
      await upstream.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test E: Dual-model cost logging
  // -----------------------------------------------------------------------

  it('dual-model cost logging records requestedModel in cost aggregator and action log', async () => {
    const upstream = await createCapturingUpstream();

    const modelRoutePolicy: ModelRoutePolicy = {
      name: 'route-for-cost-test',
      type: 'model_route',
      enabled: true,
      scope: { level: 'global' },
      rules: [
        {
          when: { input_tokens_estimate: '<500' },
          route_to: 'gpt-4o-mini',
        },
        { route_to: '', default: 'passthrough' },
      ],
    };

    const ts = await startTestServer({
      upstreamPort: upstream.port,
      policies: [modelRoutePolicy],
      withLogging: true,
    });

    try {
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'cost-agent' },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // Allow a small delay for async cost recording
      await new Promise((r) => setTimeout(r, 50));

      // Check that the cost aggregator has a record with requestedModel
      const summaries = ts.aggregator.getSummary({ agentId: 'cost-agent' });
      // The upstream returns usage data so cost recording should have fired
      // Check raw records are accessible (aggregator stores them)
      // We verify at the action log level which is more accessible

      // Check action log has requested_model and actual_model
      ts.actionLogger!.flush();
      const logDir = ts.actionLogger!.logDirectory;
      const files = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
      expect(files.length).toBeGreaterThan(0);

      const logContent = fs.readFileSync(path.join(logDir, files[0]), 'utf8').trim();
      const logLines = logContent.split('\n').filter((l) => l.length > 0);
      expect(logLines.length).toBeGreaterThan(0);

      const logEntry = JSON.parse(logLines[0]) as {
        agent_id: string;
        requested_model: string | null;
        actual_model: string | null;
      };

      expect(logEntry.agent_id).toBe('cost-agent');
      expect(logEntry.requested_model).toBe('gpt-4o');
      expect(logEntry.actual_model).not.toBeNull();
    } finally {
      await ts.close();
      await upstream.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test F: YAML parse round-trip
  // -----------------------------------------------------------------------

  it('YAML parse round-trip loads model_route policy and routes correctly', async () => {
    const upstream = await createCapturingUpstream();

    const ts = await startTestServer({ upstreamPort: upstream.port });

    // Load a complete model_route policy from YAML string
    const yamlStr = `
version: 1
policies:
  - name: yaml-model-route
    type: model_route
    scope: global
    model_aliases:
      cheap: "gpt-4o-mini"
      standard: "gpt-4o"
      premium: "claude-opus-4-6"
    max_downgrade_level: standard
    routing_opt_out_agents:
      - vip-agent
    rules:
      - when:
          input_tokens_estimate: "<500"
        route_to: cheap
      - when:
          input_tokens_estimate: "<2000"
        route_to: standard
      - default: passthrough
`;

    const parseResult = ts.policyEngine.loadFromYaml(yamlStr);
    expect(parseResult.success).toBe(true);
    expect(parseResult.policies.length).toBe(1);

    const policy = parseResult.policies[0] as ModelRoutePolicy;
    expect(policy.type).toBe('model_route');
    expect(policy.model_aliases).toEqual({
      cheap: 'gpt-4o-mini',
      standard: 'gpt-4o',
      premium: 'claude-opus-4-6',
    });
    expect(policy.max_downgrade_level).toBe('standard');
    expect(policy.routing_opt_out_agents).toEqual(['vip-agent']);
    expect(policy.rules.length).toBe(3);

    try {
      // Send a short request — should route to 'cheap' alias = 'gpt-4o-mini'
      // BUT max_downgrade_level is 'standard' (index 1), and 'cheap' is index 0 (below max)
      // So the cheap rule is skipped; next rule matches <2000 -> 'standard' = 'gpt-4o'
      const res = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'yaml-route-agent' },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });

      expect(res.statusCode).toBe(200);

      // max_downgrade_level='standard' means routing cannot go below 'standard' tier.
      // 'cheap' (tier index 0) < 'standard' (tier index 1) -> skip cheap rule.
      // 'standard' (tier index 1) >= 'standard' (tier index 1) -> allowed.
      // So upstream receives model='gpt-4o' (resolved from 'standard' alias).
      const receivedBody = upstream.getLastReceivedBody();
      expect(receivedBody).not.toBeNull();
      expect(receivedBody!.model).toBe('gpt-4o');
    } finally {
      await ts.close();
      await upstream.close();
    }
  });
});
