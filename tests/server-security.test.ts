import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { ApprovalManager } from '../src/approval.js';
import type { ProxyConfig } from '../src/types.js';

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once('listening', resolve);
  });
}

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function createConfig(): ProxyConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    providers: new Map(),
    agents: new Map(),
    pricing: new Map(),
    budgets: new Map(),
    security: {
      adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
      allowedOrigins: ['https://dashboard.example.com'],
      allowLocalAdmin: true,
      requireAgentApiKey: false,
    },
  };
}

describe('server security controls', () => {
  let server: http.Server | undefined;

  beforeEach(() => {
    process.env.TEST_GOVYN_ADMIN_KEY = 'server-admin-key';
  });

  afterEach(() => {
    delete process.env.TEST_GOVYN_ADMIN_KEY;
    server?.close();
    server = undefined;
  });

  it('requires an admin API key for protected management endpoints', async () => {
    server = startServer(createConfig(), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const unauthorized = await httpRequest({ port, path: '/api/budgets' });
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await httpRequest({
      port,
      path: '/api/budgets',
      headers: { 'x-govyn-admin-key': 'server-admin-key' },
    });
    expect(authorized.statusCode).toBe(200);
  });

  it('allows only trusted origins in CORS preflight responses', async () => {
    server = startServer(createConfig(), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const allowed = await httpRequest({
      port,
      path: '/api/budgets',
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const blocked = await httpRequest({
      port,
      path: '/api/budgets',
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(blocked.statusCode).toBe(403);
  });

  it('blocks local management POSTs from untrusted browser origins', async () => {
    delete process.env.TEST_GOVYN_ADMIN_KEY;

    server = startServer(createConfig(), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const response = await httpRequest({
      port,
      path: '/api/agents/test-agent/unblock',
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('origin_not_allowed');
  });

  it('requires agent API keys for proxied requests when enabled', async () => {
    const config = createConfig();
    config.host = '0.0.0.0';
    config.security = {
      ...config.security!,
      requireAgentApiKey: true,
    };

    server = startServer(config, new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const response = await httpRequest({
      port,
      path: '/v1/openai/v1/chat/completions',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body) as { error: { code: string } };
    expect(body.error.code).toBe('proxy_auth_required');
  });

  it('does not require admin auth for approval polling endpoints', async () => {
    const approvalManager: ApprovalManager = {
      createApprovalRequest: async () => {
        throw new Error('not used');
      },
      getApprovalStatus: async () => ({
        id: 'approval-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      validateAndConsumeToken: async () => null,
      approveRequest: async () => false,
      denyRequest: async () => false,
    } as ApprovalManager;

    server = startServer(createConfig(), new CostAggregator(), undefined, undefined, undefined, undefined, undefined, approvalManager);
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const response = await httpRequest({
      port,
      path: '/api/approvals/approval-1',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; approval_token: null };
    expect(body.status).toBe('pending');
    expect(body.approval_token).toBeNull();
  });
});
