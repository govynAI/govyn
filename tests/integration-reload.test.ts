/**
 * Integration tests for hot reload through the proxy pipeline.
 *
 * Tests that policy file changes take effect on a running server:
 * 1. Hot reload end-to-end: block policy removed -> request passes through
 * 2. Invalid reload preserves policies: invalid YAML -> original block still active
 * 3. Reload latency under 1 second: file change reflected in engine within 1000ms
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import { BudgetEnforcer } from '../src/budget-enforcer.js';
import { LoopDetector } from '../src/loop-detector.js';
import { PolicyEngine } from '../src/policy-engine.js';
import { PolicyWatcher } from '../src/policy-watcher.js';
import { govynEvents } from '../src/events.js';
import type { GovynEvent } from '../src/events.js';
import type { ProxyConfig, BudgetConfig, LoopDetectionConfig } from '../src/types.js';

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
// Test infrastructure
// -----------------------------------------------------------------------

const BLOCK_POLICY_YAML = `version: 1
policies:
  - name: block-all
    type: block
    scope: global
    enabled: true
`;

const EMPTY_POLICIES_YAML = `version: 1
policies: []
`;

const INVALID_YAML = `version: 1
policies:
  - name: broken
    type: totally_invalid_type
    scope: global
    enabled: true
`;

interface ReloadTestServer {
  port: number;
  server: http.Server;
  policyEngine: PolicyEngine;
  watcher: PolicyWatcher;
  policyFilePath: string;
  tmpDir: string;
  close: () => Promise<void>;
}

async function startReloadTestServer(options: {
  upstreamPort: number;
  initialYaml: string;
}): Promise<ReloadTestServer> {
  const { upstreamPort, initialYaml } = options;

  // Create temp policy file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-reload-test-'));
  const policyFilePath = path.join(tmpDir, 'policies.yaml');
  fs.writeFileSync(policyFilePath, initialYaml, 'utf8');

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
  policyEngine.setCostAggregator(aggregator);
  policyEngine.loadFromFile(policyFilePath);

  // Start watcher with fast debounce for tests
  const watcher = new PolicyWatcher(policyEngine, policyFilePath, { debounceMs: 50 });
  watcher.start();

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

  const server = startServer(config, aggregator, enforcer, loopDetector, undefined, policyEngine);
  await waitForListen(server);
  const port = (server.address() as { port: number }).port;

  return {
    port,
    server,
    policyEngine,
    watcher,
    policyFilePath,
    tmpDir,
    close: async () => {
      watcher.stop();
      await new Promise<void>((r) => server.close(() => r()));
      // Clean up temp files
      try {
        const files = fs.readdirSync(tmpDir);
        for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
        fs.rmdirSync(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('hot reload integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
    govynEvents.removeAllListeners();
  });

  // -----------------------------------------------------------------------
  // Test 1: Hot reload end-to-end
  // -----------------------------------------------------------------------

  it('hot reload: removing block policy allows previously-blocked requests', async () => {
    const ts = await startReloadTestServer({
      upstreamPort: upstream.port,
      initialYaml: BLOCK_POLICY_YAML,
    });

    try {
      // Verify request is blocked initially
      const res1 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'test-agent' },
      });
      expect(res1.statusCode).toBe(403);

      // Now remove the block policy by writing empty policies
      const reloadPromise = new Promise<GovynEvent>((resolve) => {
        govynEvents.on('event', (evt: GovynEvent) => {
          if (evt.type === 'policy_reloaded') resolve(evt);
        });
      });

      fs.writeFileSync(ts.policyFilePath, EMPTY_POLICIES_YAML, 'utf8');

      // Wait for reload event (should be < 1 second)
      await reloadPromise;

      // Request should now pass through
      const res2 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'test-agent' },
      });
      expect(res2.statusCode).toBe(200);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: Invalid reload preserves policies
  // -----------------------------------------------------------------------

  it('invalid reload preserves existing policies', async () => {
    const ts = await startReloadTestServer({
      upstreamPort: upstream.port,
      initialYaml: BLOCK_POLICY_YAML,
    });

    try {
      // Verify request is blocked initially
      const res1 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'test-agent' },
      });
      expect(res1.statusCode).toBe(403);

      // Write invalid YAML
      const failPromise = new Promise<GovynEvent>((resolve) => {
        govynEvents.on('event', (evt: GovynEvent) => {
          if (evt.type === 'policy_reload_failed') resolve(evt);
        });
      });

      fs.writeFileSync(ts.policyFilePath, INVALID_YAML, 'utf8');

      // Wait for reload failure event
      await failPromise;

      // Request should still be blocked (original policies preserved)
      const res2 = await makeHttpRequest({
        port: ts.port,
        path: '/v1/custom/custom/v1/test',
        headers: { 'x-govyn-agent': 'test-agent' },
      });
      expect(res2.statusCode).toBe(403);
    } finally {
      await ts.close();
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: Reload latency under 1 second
  // -----------------------------------------------------------------------

  it('reload latency is under 1 second', async () => {
    const ts = await startReloadTestServer({
      upstreamPort: upstream.port,
      initialYaml: BLOCK_POLICY_YAML,
    });

    try {
      const reloadPromise = new Promise<void>((resolve) => {
        govynEvents.on('event', (evt: GovynEvent) => {
          if (evt.type === 'policy_reloaded') resolve();
        });
      });

      const startTime = Date.now();

      // Write a valid change
      fs.writeFileSync(ts.policyFilePath, EMPTY_POLICIES_YAML, 'utf8');

      // Wait for reload
      await reloadPromise;

      const elapsed = Date.now() - startTime;

      // Assert reload happened within 1 second
      expect(elapsed).toBeLessThan(1000);

      // Verify engine reflects new state
      expect(ts.policyEngine.getPolicies()).toHaveLength(0);
    } finally {
      await ts.close();
    }
  });
});
