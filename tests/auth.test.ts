import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalAuthManager, LoginRateLimiter, DEFAULT_AUTH_FILE, DEFAULT_SESSION_TTL_HOURS } from '../src/auth.js';
import { startServer } from '../src/server.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type { ProxyConfig } from '../src/types.js';

const TEST_ADMIN_ENV = 'TEST_GOVYN_LOCAL_ADMIN_KEY';
const ORIGINAL_PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'new secure battery staple';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-auth-test-'));
}

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
  body?: string;
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
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function getCookieHeader(headers: http.IncomingHttpHeaders): string {
  const setCookie = headers['set-cookie'];
  const firstCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!firstCookie) {
    throw new Error('Missing Set-Cookie header');
  }

  return firstCookie.split(';')[0] ?? firstCookie;
}

function createConfig(authFile: string): ProxyConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    providers: new Map(),
    agents: new Map(),
    pricing: new Map(),
    budgets: new Map(),
    security: {
      adminApiKeyEnv: TEST_ADMIN_ENV,
      allowedOrigins: ['https://dashboard.example.com'],
      allowLocalAdmin: true,
      requireAgentApiKey: false,
      authFile,
      sessionTtlHours: DEFAULT_SESSION_TTL_HOURS,
    },
  };
}

describe('local dashboard auth', () => {
  let tempDir = '';
  let authFile = '';
  let server: http.Server | undefined;

  beforeEach(() => {
    tempDir = makeTempDir();
    authFile = path.join(tempDir, 'govyn.auth.json');
    delete process.env[TEST_ADMIN_ENV];
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env[TEST_ADMIN_ENV];
  });

  it('creates a single-admin auth file and validates session tokens', () => {
    const authManager = new LocalAuthManager(authFile);

    expect(authManager.isConfigured()).toBe(false);
    expect(path.basename(authManager.authFile)).toBe(path.basename(DEFAULT_AUTH_FILE));

    const username = authManager.setupAdmin('Admin', ORIGINAL_PASSWORD);
    expect(username).toBe('admin');
    expect(authManager.getStatus()).toEqual({
      configured: true,
      username: 'admin',
    });

    const sessionTokens = authManager.login('admin', ORIGINAL_PASSWORD);
    expect(sessionTokens).not.toBeNull();
    expect(sessionTokens!.csrfToken.length).toBeGreaterThan(10);

    const session = authManager.getSession(sessionTokens!.sessionId);
    expect(session).toEqual({
      username: 'admin',
      sessionId: sessionTokens!.sessionId,
      csrfToken: sessionTokens!.csrfToken,
      expiresAt: sessionTokens!.expiresAt,
    });
    expect(authManager.validateCsrfToken(sessionTokens!.sessionId, sessionTokens!.csrfToken)).toBe(true);
    expect(authManager.validateCsrfToken(sessionTokens!.sessionId, 'bad-token')).toBe(false);

    authManager.logout(sessionTokens!.sessionId);
    expect(authManager.getSession(sessionTokens!.sessionId)).toBeNull();
  });

  it('changes the password and invalidates existing sessions', () => {
    const authManager = new LocalAuthManager(authFile);
    authManager.setupAdmin('admin', ORIGINAL_PASSWORD);

    const sessionTokens = authManager.login('admin', ORIGINAL_PASSWORD);
    expect(sessionTokens).not.toBeNull();

    authManager.changePassword(sessionTokens!.sessionId, ORIGINAL_PASSWORD, NEW_PASSWORD);

    expect(authManager.getSession(sessionTokens!.sessionId)).toBeNull();
    expect(authManager.login('admin', ORIGINAL_PASSWORD)).toBeNull();
    expect(authManager.login('admin', NEW_PASSWORD)).not.toBeNull();
  });

  it('rate-limits repeated login failures', () => {
    const limiter = new LoginRateLimiter(2, 60_000, 120_000);

    expect(limiter.getRetryAfterSeconds('127.0.0.1:admin')).toBeNull();
    expect(limiter.recordFailure('127.0.0.1:admin')).toBeNull();

    const blockedFor = limiter.recordFailure('127.0.0.1:admin');
    expect(blockedFor).toBeGreaterThan(0);
    expect(limiter.getRetryAfterSeconds('127.0.0.1:admin')).toBeGreaterThan(0);

    limiter.clear('127.0.0.1:admin');
    expect(limiter.getRetryAfterSeconds('127.0.0.1:admin')).toBeNull();
  });

  it('reports when dashboard auth has not been configured yet', async () => {
    server = startServer(createConfig(authFile), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const response = await httpRequest({
      port,
      path: '/api/auth/session',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      authenticated: false,
      auth_configured: false,
      username: null,
      csrf_token: null,
    });
  });

  it('supports session-based dashboard auth and enforces csrf on mutating requests', async () => {
    const authManager = new LocalAuthManager(authFile);
    authManager.setupAdmin('admin', ORIGINAL_PASSWORD);

    server = startServer(createConfig(authFile), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const initialSession = await httpRequest({
      port,
      path: '/api/auth/session',
    });
    expect(JSON.parse(initialSession.body)).toEqual({
      authenticated: false,
      auth_configured: true,
      username: null,
      csrf_token: null,
    });

    const loginResponse = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: ORIGINAL_PASSWORD,
      }),
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginBody = JSON.parse(loginResponse.body) as {
      authenticated: boolean;
      username: string;
      csrf_token: string;
    };
    const sessionCookie = getCookieHeader(loginResponse.headers);

    expect(loginBody.authenticated).toBe(true);
    expect(loginBody.username).toBe('admin');
    expect(sessionCookie).toMatch(/^govyn_session=/);

    const sessionResponse = await httpRequest({
      port,
      path: '/api/auth/session',
      headers: {
        Cookie: sessionCookie,
      },
    });
    const sessionBody = JSON.parse(sessionResponse.body) as {
      authenticated: boolean;
      auth_configured: boolean;
      username: string;
      csrf_token: string;
    };
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.auth_configured).toBe(true);
    expect(sessionBody.username).toBe('admin');
    expect(sessionBody.csrf_token).toBe(loginBody.csrf_token);

    const managementGet = await httpRequest({
      port,
      path: '/api/budgets',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(managementGet.statusCode).toBe(200);

    const missingCsrf = await httpRequest({
      port,
      path: '/api/agents/test-agent/unblock',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(missingCsrf.statusCode).toBe(403);
    expect(JSON.parse(missingCsrf.body)).toMatchObject({
      error: {
        code: 'csrf_invalid',
      },
    });

    const validCsrf = await httpRequest({
      port,
      path: '/api/agents/test-agent/unblock',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'x-govyn-csrf': loginBody.csrf_token,
      },
    });
    expect(validCsrf.statusCode).toBe(404);
    expect(JSON.parse(validCsrf.body)).toMatchObject({
      error: {
        code: 'agent_not_blocked',
      },
    });

    const logoutMissingCsrf = await httpRequest({
      port,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(logoutMissingCsrf.statusCode).toBe(403);
    expect(JSON.parse(logoutMissingCsrf.body)).toMatchObject({
      error: {
        code: 'csrf_invalid',
      },
    });

    const logoutBadOrigin = await httpRequest({
      port,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        Origin: 'https://evil.example.com',
        'x-govyn-csrf': loginBody.csrf_token,
      },
    });
    expect(logoutBadOrigin.statusCode).toBe(403);
    expect(JSON.parse(logoutBadOrigin.body)).toMatchObject({
      error: {
        code: 'origin_not_allowed',
      },
    });

    const stillAuthenticated = await httpRequest({
      port,
      path: '/api/auth/session',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(JSON.parse(stillAuthenticated.body)).toMatchObject({
      authenticated: true,
      username: 'admin',
    });

    const logoutSuccess = await httpRequest({
      port,
      path: '/api/auth/logout',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        Origin: 'https://dashboard.example.com',
        'x-govyn-csrf': loginBody.csrf_token,
      },
    });
    expect(logoutSuccess.statusCode).toBe(200);
    expect(JSON.parse(logoutSuccess.body)).toMatchObject({
      success: true,
    });

    const loggedOutSession = await httpRequest({
      port,
      path: '/api/auth/session',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(JSON.parse(loggedOutSession.body)).toEqual({
      authenticated: false,
      auth_configured: true,
      username: null,
      csrf_token: null,
    });

    const reloginResponse = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: ORIGINAL_PASSWORD,
      }),
    });
    expect(reloginResponse.statusCode).toBe(200);
    const reloginBody = JSON.parse(reloginResponse.body) as {
      csrf_token: string;
    };
    const reloginCookie = getCookieHeader(reloginResponse.headers);

    const changePassword = await httpRequest({
      port,
      path: '/api/auth/change-password',
      method: 'POST',
      headers: {
        Cookie: reloginCookie,
        'content-type': 'application/json',
        'x-govyn-csrf': reloginBody.csrf_token,
      },
      body: JSON.stringify({
        current_password: ORIGINAL_PASSWORD,
        new_password: NEW_PASSWORD,
      }),
    });
    expect(changePassword.statusCode).toBe(200);
    expect(JSON.parse(changePassword.body)).toMatchObject({
      success: true,
    });

    const oldPasswordLogin = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: ORIGINAL_PASSWORD,
      }),
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: NEW_PASSWORD,
      }),
    });
    expect(newPasswordLogin.statusCode).toBe(200);
  });

  it('returns an explicit unavailable state for alerts when alert storage is disabled', async () => {
    const authManager = new LocalAuthManager(authFile);
    authManager.setupAdmin('admin', ORIGINAL_PASSWORD);

    server = startServer(createConfig(authFile), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const loginResponse = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: ORIGINAL_PASSWORD,
      }),
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginBody = JSON.parse(loginResponse.body) as { csrf_token: string };
    const sessionCookie = getCookieHeader(loginResponse.headers);

    const rulesResponse = await httpRequest({
      port,
      path: '/api/alerts/rules',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(rulesResponse.statusCode).toBe(200);
    expect(JSON.parse(rulesResponse.body)).toEqual({
      rules: [],
      available: false,
      reason: 'Alerts require persistent alert storage and are disabled for this proxy.',
    });

    const historyResponse = await httpRequest({
      port,
      path: '/api/alerts/history?limit=25&offset=10',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(historyResponse.statusCode).toBe(200);
    expect(JSON.parse(historyResponse.body)).toEqual({
      alerts: [],
      total: 0,
      limit: 25,
      offset: 10,
      available: false,
      reason: 'Alerts require persistent alert storage and are disabled for this proxy.',
    });

    const createResponse = await httpRequest({
      port,
      path: '/api/alerts/rules',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'content-type': 'application/json',
        'x-govyn-csrf': loginBody.csrf_token,
      },
      body: JSON.stringify({
        name: 'Daily budget',
      }),
    });
    expect(createResponse.statusCode).toBe(503);
    expect(JSON.parse(createResponse.body)).toEqual({
      error: {
        message: 'Alerts are unavailable on this proxy',
        code: 'alerts_unavailable',
      },
      available: false,
      reason: 'Alerts require persistent alert storage and are disabled for this proxy.',
    });
  });

  it('returns an explicit unavailable state for approvals when approval storage is disabled', async () => {
    const authManager = new LocalAuthManager(authFile);
    authManager.setupAdmin('admin', ORIGINAL_PASSWORD);

    server = startServer(createConfig(authFile), new CostAggregator());
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    const loginResponse = await httpRequest({
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: ORIGINAL_PASSWORD,
      }),
    });

    expect(loginResponse.statusCode).toBe(200);
    const loginBody = JSON.parse(loginResponse.body) as { csrf_token: string };
    const sessionCookie = getCookieHeader(loginResponse.headers);

    const listResponse = await httpRequest({
      port,
      path: '/api/approvals?status=pending&limit=25&offset=10',
      headers: {
        Cookie: sessionCookie,
      },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.parse(listResponse.body)).toEqual({
      approvals: [],
      total: 0,
      limit: 25,
      offset: 10,
      available: false,
      reason: 'Approvals require database-backed approval storage and are disabled for this proxy.',
    });

    const actionResponse = await httpRequest({
      port,
      path: '/api/approvals/request-123/approve',
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'content-type': 'application/json',
        'x-govyn-csrf': loginBody.csrf_token,
      },
      body: JSON.stringify({
        decided_by: 'dashboard',
      }),
    });
    expect(actionResponse.statusCode).toBe(503);
    expect(JSON.parse(actionResponse.body)).toEqual({
      error: {
        message: 'Approvals are unavailable on this proxy',
        code: 'approvals_unavailable',
      },
      available: false,
      reason: 'Approvals require database-backed approval storage and are disabled for this proxy.',
    });
  });
});
