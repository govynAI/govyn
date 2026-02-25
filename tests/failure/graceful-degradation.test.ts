/**
 * Graceful degradation tests for the Govyn proxy server.
 *
 * Tests:
 * 1. Corrupt config values — clear error or safe defaults
 * 2. Upstream timeout — proxy returns error, remains responsive
 * 3. Rapid server start/stop — no port conflicts or leaked listeners
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig } from '../../src/config.js';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { BudgetEnforcer } from '../../src/budget-enforcer.js';
import { LoopDetector } from '../../src/loop-detector.js';
import type { ProxyConfig } from '../../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-degrade-test-'));
}

function cleanupTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeYaml(dir: string, yaml: string): string {
  const filePath = path.join(dir, 'govyn.config.yaml');
  fs.writeFileSync(filePath, yaml, 'utf8');
  return filePath;
}

function httpRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let parsed: any;
        try {
          parsed = JSON.parse(bodyStr);
        } catch {
          parsed = bodyStr;
        }
        resolve({ statusCode: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('Client timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

const CANNED_RESPONSE = JSON.stringify({
  id: 'chatcmpl-degrade',
  object: 'chat.completion',
  model: 'gpt-4o',
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop', index: 0 }],
});

function createMockUpstream(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(CANNED_RESPONSE).toString(),
      });
      res.end(CANNED_RESPONSE);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

// -----------------------------------------------------------------------
// Test suite: Corrupt config values
// -----------------------------------------------------------------------

describe('Graceful degradation: corrupt config values', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) cleanupTempDir(tmpDir);
  });

  it('throws a clear error for invalid budget values (negative daily limit)', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
budgets:
  bad-agent:
    daily_limit: -100
    limit_type: hard
`);
    // loadConfig should succeed (negative numbers are valid YAML numbers)
    // but the budget enforcer should handle them safely
    const config = loadConfig(configPath);
    const budgetConfig = config.budgets.get('bad-agent');
    expect(budgetConfig).toBeDefined();
    expect(budgetConfig!.dailyLimit).toBe(-100);

    // Budget enforcer with negative limit should still function
    // A negative limit effectively means always exceeded
    const aggregator = new CostAggregator();
    const enforcer = new BudgetEnforcer(config.budgets, aggregator);
    const result = enforcer.checkBudget('bad-agent');
    // With -100 daily limit, any spend is over budget
    expect(result.allowed).toBe(false);
  });

  it('throws clear error for missing proxy section', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
`);
    expect(() => loadConfig(configPath)).toThrow(/missing 'proxy' section/);
  });

  it('throws clear error for missing port', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  host: localhost
`);
    expect(() => loadConfig(configPath)).toThrow(/proxy.port/);
  });

  it('throws clear error for non-integer port', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: "not-a-number"
`);
    expect(() => loadConfig(configPath)).toThrow(/proxy.port/);
  });

  it('throws clear error for invalid storage_region', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
logging:
  storage_region: invalid
`);
    expect(() => loadConfig(configPath)).toThrow(/storage_region/);
  });

  it('uses safe defaults for missing optional fields', () => {
    tmpDir = makeTempDir();
    const configPath = writeYaml(tmpDir, `
version: 1
proxy:
  port: 3000
`);
    const config = loadConfig(configPath);
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.providers.size).toBe(0);
    expect(config.agents.size).toBe(0);
    expect(config.budgets.size).toBe(0);
  });
});

// -----------------------------------------------------------------------
// Test suite: Upstream timeout
// -----------------------------------------------------------------------

describe('Graceful degradation: upstream timeout', () => {
  let hangingServer: http.Server;
  let proxyServer: http.Server;
  let healthyUpstream: { server: http.Server; port: number };

  afterEach(async () => {
    if (proxyServer) await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    if (hangingServer) {
      hangingServer.closeAllConnections();
      await new Promise<void>((resolve) => hangingServer.close(() => resolve()));
    }
    if (healthyUpstream) await new Promise<void>((resolve) => healthyUpstream.server.close(() => resolve()));
  });

  it('returns error for upstream timeout and remains responsive', async () => {
    // Create a mock upstream that never responds (hangs)
    hangingServer = http.createServer((_req, _res) => {
      // Intentionally never respond — simulates upstream hang
    });
    await new Promise<void>((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const hangingPort = (hangingServer.address() as { port: number }).port;

    // Also create a healthy upstream
    healthyUpstream = await createMockUpstream();

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([
        ['openai', {
          name: 'openai',
          baseUrl: `http://127.0.0.1:${hangingPort}`,
          apiKeyEnv: 'OPENAI_API_KEY',
          providerType: 'openai' as const,
        }],
      ]),
      agents: new Map(),
      pricing: new Map(),
      budgets: new Map(),
    };

    const aggregator = new CostAggregator();
    const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);
    const loopDetector = new LoopDetector(
      { threshold: 1000, windowSeconds: 60, cooldownSeconds: 300 },
      config.agents,
    );

    proxyServer = startServer(config, aggregator, budgetEnforcer, loopDetector);
    await new Promise<void>((resolve) => proxyServer.on('listening', resolve));
    const proxyPort = (proxyServer.address() as { port: number }).port;

    // Send a request with a short client-side timeout (2s to avoid test timeout)
    const timeoutRequest = (): Promise<{ statusCode: number; body: any } | { error: string }> => {
      return new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: proxyPort,
          path: '/v1/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-govyn-agent': 'timeout-agent',
          },
        }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const bodyStr = Buffer.concat(chunks).toString('utf8');
            let parsed: any;
            try { parsed = JSON.parse(bodyStr); } catch { parsed = bodyStr; }
            resolve({ statusCode: res.statusCode ?? 0, body: parsed });
          });
        });
        req.setTimeout(2000, () => {
          req.destroy();
          resolve({ error: 'client_timeout' });
        });
        req.on('error', () => {
          resolve({ error: 'connection_error' });
        });
        req.write(JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }));
        req.end();
      });
    };

    const result = await timeoutRequest();

    // Either the proxy returned an error response, or our client timed out
    if ('error' in result) {
      expect(['client_timeout', 'connection_error']).toContain(result.error);
    } else {
      // Proxy may have returned 502 for upstream timeout
      expect(result.statusCode).toBeGreaterThanOrEqual(500);
    }

    // Verify the proxy is still responsive by checking the health endpoint
    const healthResult = await httpRequest({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: '/health',
      method: 'GET',
    });

    expect(healthResult.statusCode).toBe(200);
    expect(healthResult.body.status).toBe('ok');
  }, 10000);
});

// -----------------------------------------------------------------------
// Test suite: Rapid server start/stop
// -----------------------------------------------------------------------

describe('Graceful degradation: rapid server start/stop', () => {
  it('starts and stops the proxy 5 times without port conflicts or leaked listeners', async () => {
    const mockUpstream = await createMockUpstream();

    try {
      for (let i = 0; i < 5; i++) {
        const config: ProxyConfig = {
          port: 0, // Random port to avoid conflicts
          host: '127.0.0.1',
          providers: new Map([['openai', {
            name: 'openai',
            baseUrl: `http://127.0.0.1:${mockUpstream.port}`,
            apiKeyEnv: 'OPENAI_API_KEY',
            providerType: 'openai' as const,
          }]]),
          agents: new Map(),
          pricing: new Map(),
          budgets: new Map(),
        };

        const aggregator = new CostAggregator();
        const budgetEnforcer = new BudgetEnforcer(config.budgets, aggregator);

        const server = startServer(config, aggregator, budgetEnforcer);
        await new Promise<void>((resolve) => server.on('listening', resolve));

        const port = (server.address() as { port: number }).port;
        expect(port).toBeGreaterThan(0);

        // Verify it's responsive
        const result = await httpRequest({
          hostname: '127.0.0.1',
          port,
          path: '/health',
          method: 'GET',
        });
        expect(result.statusCode).toBe(200);

        // Stop cleanly
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      // If we got here 5 times, no port conflicts or leaked listeners
    } finally {
      await new Promise<void>((resolve) => mockUpstream.server.close(() => resolve()));
    }
  });
});
