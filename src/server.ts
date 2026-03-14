/**
 * HTTP server for the Govyn proxy.
 *
 * Uses Node.js http.createServer() — NOT Express (per BUILD_ROADMAP and ADR-013).
 * Each incoming request is matched via matchRoute and forwarded via forwardRequest.
 * GET /health is served directly via handleHealth.
 * GET /api/costs is served via handleCostApi.
 * GET /api/budgets is served via handleBudgetApi.
 * Budget limits are enforced before forwarding: hard limits return 429, soft limits warn.
 * Unmatched routes return 404 JSON. Errors return appropriate status codes.
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { ProxyConfig, LoggingMode, LogEntry } from './types.js';
import { LocalAuthManager, LoginRateLimiter, SESSION_COOKIE_NAME } from './auth.js';
import { matchRoute } from './router.js';
import { forwardRequest } from './proxy.js';
import { handleHealth } from './health.js';
import { resolveAgentId } from './agents.js';
import { handleCostApi } from './cost-api.js';
import { handleBudgetApi } from './budget-api.js';
import { handleLogApi } from './log-api.js';
import { handlePolicyApi } from './policy-api.js';
import { handleApprovalApi } from './approval-api.js';
import { handleAlertApi } from './alert-api.js';
import { CostAggregator } from './cost-aggregator.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { LoopDetector } from './loop-detector.js';
import { govynEvents } from './events.js';
import type { PricingTable } from './pricing.js';
import type { ActionLogger } from './action-logger.js';
import type { PolicyEngine } from './policy-engine.js';
import type { PolicyRequestContext, PolicyEvaluationResult, ModelRouteResult, ApprovalPolicyResult } from './policy-types.js';
import type { DbWriter } from './db-writer.js';
import type { ApprovalManager } from './approval.js';
import { generateRequestSummary, hashApprovalRequest } from './approval.js';
import type { AlertManager } from './alert-manager.js';
import { authenticateManagementRequest, isAllowedOrigin, validateSessionCsrf } from './security.js';

/**
 * Send a JSON error response.
 */
function sendJsonError(
  res: http.ServerResponse,
  statusCode: number,
  message: string,
  code: string,
): void {
  const body = JSON.stringify({ error: { message, code } });
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders?: Record<string, string | string[]>,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
    ...(extraHeaders ?? {}),
  });
  res.end(body);
}

function appendVaryHeader(res: http.ServerResponse, value: string): void {
  const existing = res.getHeader('Vary');
  if (typeof existing === 'string' && existing.length > 0) {
    const values = existing.split(',').map((part) => part.trim());
    if (!values.includes(value)) {
      res.setHeader('Vary', `${existing}, ${value}`);
    }
    return;
  }

  res.setHeader('Vary', value);
}

function setStandardApiHeaders(res: http.ServerResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function isMutatingMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const ALERT_HISTORY_DEFAULT_LIMIT = 50;
const ALERT_HISTORY_MAX_LIMIT = 200;
const ALERTS_UNAVAILABLE_MESSAGE = 'Alerts are unavailable on this proxy';
const ALERTS_UNAVAILABLE_REASON = 'Alerts require persistent alert storage and are disabled for this proxy.';
const APPROVALS_DEFAULT_LIMIT = 50;
const APPROVALS_MAX_LIMIT = 200;
const APPROVALS_UNAVAILABLE_MESSAGE = 'Approvals are unavailable on this proxy';
const APPROVALS_UNAVAILABLE_REASON = 'Approvals require database-backed approval storage and are disabled for this proxy.';

function parseCookie(headerValue: string | string[] | undefined, name: string): string | null {
  const cookieHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    if (rawName.trim() !== name) continue;
    return decodeURIComponent(rawValue.join('=').trim());
  }

  return null;
}

function isSecureRequest(req: http.IncomingMessage): boolean {
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }

  return Boolean((req.socket as { encrypted?: boolean }).encrypted);
}

function buildSessionCookie(sessionId: string, secure: boolean, maxAgeSeconds: number): string {
  const sameSite = secure ? 'None' : 'Lax';
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function buildClearedSessionCookie(secure: boolean): string {
  const sameSite = secure ? 'None' : 'Lax';
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    'Max-Age=0',
  ];

  if (secure) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function getPathname(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}

function isApiOrHealthRequest(url: string): boolean {
  return url === '/health' || url.startsWith('/api/');
}

function isApprovalPollingRequest(url: string, method: string): boolean {
  if (method !== 'GET') return false;
  const pathname = getPathname(url);
  return /^\/api\/approvals\/[^/]+$/.test(pathname);
}

function sendAlertsUnavailable(
  res: http.ServerResponse,
  statusCode = 503,
): void {
  sendJson(res, statusCode, {
    error: {
      message: ALERTS_UNAVAILABLE_MESSAGE,
      code: 'alerts_unavailable',
    },
    available: false,
    reason: ALERTS_UNAVAILABLE_REASON,
  });
}

function handleUnavailableAlerts(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const method = req.method ?? 'GET';
  const parsed = new URL(req.url ?? '/api/alerts', 'http://localhost');
  const pathname = parsed.pathname;

  if (method === 'GET' && pathname === '/api/alerts/rules') {
    sendJson(res, 200, {
      rules: [],
      available: false,
      reason: ALERTS_UNAVAILABLE_REASON,
    });
    return true;
  }

  if (method === 'GET' && pathname === '/api/alerts/history') {
    const limitParam = parsed.searchParams.get('limit');
    let limit = ALERT_HISTORY_DEFAULT_LIMIT;
    if (limitParam !== null) {
      limit = Number.parseInt(limitParam, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > ALERT_HISTORY_MAX_LIMIT) {
        sendJsonError(
          res,
          400,
          `Invalid limit: must be between 1 and ${ALERT_HISTORY_MAX_LIMIT}`,
          'invalid_request',
        );
        return true;
      }
    }

    const offsetParam = parsed.searchParams.get('offset');
    let offset = 0;
    if (offsetParam !== null) {
      offset = Number.parseInt(offsetParam, 10);
      if (!Number.isInteger(offset) || offset < 0) {
        sendJsonError(res, 400, 'Invalid offset: must be >= 0', 'invalid_request');
        return true;
      }
    }

    sendJson(res, 200, {
      alerts: [],
      total: 0,
      limit,
      offset,
      available: false,
      reason: ALERTS_UNAVAILABLE_REASON,
    });
    return true;
  }

  if (
    pathname === '/api/alerts/rules' ||
    pathname.startsWith('/api/alerts/rules/') ||
    pathname === '/api/alerts/test'
  ) {
    sendAlertsUnavailable(res);
    return true;
  }

  return false;
}

function sendApprovalsUnavailable(
  res: http.ServerResponse,
  statusCode = 503,
): void {
  sendJson(res, statusCode, {
    error: {
      message: APPROVALS_UNAVAILABLE_MESSAGE,
      code: 'approvals_unavailable',
    },
    available: false,
    reason: APPROVALS_UNAVAILABLE_REASON,
  });
}

function handleUnavailableApprovals(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const method = req.method ?? 'GET';
  const parsed = new URL(req.url ?? '/api/approvals', 'http://localhost');
  const pathname = parsed.pathname;

  if (method === 'GET' && pathname === '/api/approvals') {
    const limitParam = parsed.searchParams.get('limit');
    let limit = APPROVALS_DEFAULT_LIMIT;
    if (limitParam !== null) {
      limit = Number.parseInt(limitParam, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > APPROVALS_MAX_LIMIT) {
        sendJsonError(
          res,
          400,
          `Invalid limit: must be between 1 and ${APPROVALS_MAX_LIMIT}`,
          'invalid_request',
        );
        return true;
      }
    }

    const offsetParam = parsed.searchParams.get('offset');
    let offset = 0;
    if (offsetParam !== null) {
      offset = Number.parseInt(offsetParam, 10);
      if (!Number.isInteger(offset) || offset < 0) {
        sendJsonError(res, 400, 'Invalid offset: must be >= 0', 'invalid_request');
        return true;
      }
    }

    sendJson(res, 200, {
      approvals: [],
      total: 0,
      limit,
      offset,
      available: false,
      reason: APPROVALS_UNAVAILABLE_REASON,
    });
    return true;
  }

  if (pathname.startsWith('/api/approvals/')) {
    sendApprovalsUnavailable(res);
    return true;
  }

  return false;
}

function requiresManagementAuth(url: string, method: string): boolean {
  if (!url.startsWith('/api/')) return false;
  if (url.startsWith('/api/auth/')) return false;
  return !isApprovalPollingRequest(url, method);
}

/**
 * Extract the model name from a JSON request body.
 * Returns undefined if body is missing, not JSON, or has no model field.
 */
function extractModelFromBody(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.model === 'string') return parsed.model;
  } catch {
    // Not JSON — no model to extract
  }
  return undefined;
}

/**
 * Extract routing context from a JSON request body for model routing evaluation.
 * Parses messages to extract system prompt, user prompt, tool presence,
 * conversation turns, and estimated token count.
 */
function extractRoutingContext(body: string | undefined): {
  inputTokensEstimate: number;
  systemPrompt?: string;
  userPrompt?: string;
  toolCallsPresent: boolean;
  conversationTurns: number;
} {
  const defaults = {
    inputTokensEstimate: 0,
    systemPrompt: undefined as string | undefined,
    userPrompt: undefined as string | undefined,
    toolCallsPresent: false,
    conversationTurns: 0,
  };
  if (!body) return defaults;

  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return defaults;

    // Estimate tokens: count total characters in string content / 4
    let totalChars = 0;

    // Extract system prompt (Anthropic: top-level `system`; OpenAI: messages[].role === "system")
    let systemPrompt: string | undefined;
    if (typeof parsed.system === 'string') {
      systemPrompt = parsed.system;
      totalChars += parsed.system.length;
    }

    // Extract from messages array
    let userPrompt: string | undefined;
    let conversationTurns = 0;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    conversationTurns = messages.length;

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const content = typeof msg.content === 'string' ? msg.content : '';
      totalChars += content.length;

      if (msg.role === 'system' && !systemPrompt) {
        systemPrompt = content;
      }
      if (msg.role === 'user') {
        userPrompt = content; // last user message wins
      }
    }

    // Check for tool/function definitions
    const toolCallsPresent =
      (Array.isArray(parsed.tools) && parsed.tools.length > 0) ||
      (Array.isArray(parsed.functions) && parsed.functions.length > 0);

    // Add tool definitions to char count for token estimate
    if (toolCallsPresent) {
      totalChars += JSON.stringify(parsed.tools ?? parsed.functions).length;
    }

    const inputTokensEstimate = Math.ceil(totalChars / 4);

    return {
      inputTokensEstimate,
      systemPrompt,
      userPrompt,
      toolCallsPresent,
      conversationTurns,
    };
  } catch {
    return defaults;
  }
}

/**
 * Create and start the Govyn HTTP proxy server.
 *
 * @param config - Proxy configuration (port, host, providers, agents, pricing, budgets)
 * @param aggregator - In-memory cost aggregator for tracking request costs
 * @param budgetEnforcer - Budget enforcer for per-agent spending limits (optional, defaults to empty)
 * @param loopDetector - Loop detector for detecting repeated identical requests (optional)
 * @param actionLogger - Action logger for structured request logging (optional)
 * @param policyEngine - Policy engine for evaluating request policies (optional)
 * @returns The created http.Server instance
 */
export function startServer(
  config: ProxyConfig,
  aggregator: CostAggregator,
  budgetEnforcer?: BudgetEnforcer,
  loopDetector?: LoopDetector,
  actionLogger?: ActionLogger,
  policyEngine?: PolicyEngine,
  dbWriter?: DbWriter,
  approvalManager?: ApprovalManager,
  policiesFile?: string,
  sql?: import('postgres').Sql,
  alertManager?: AlertManager,
): http.Server {
  // Cast pricing to PricingTable — ProxyConfig.pricing and PricingTable are structurally equivalent
  const pricingTable = config.pricing as PricingTable;

  // Use provided enforcer or create a default (no limits) enforcer
  const enforcer = budgetEnforcer ?? new BudgetEnforcer(config.budgets, aggregator);
  const authManager = config.security?.authFile
    ? new LocalAuthManager(config.security.authFile, config.security.sessionTtlHours)
    : undefined;
  const loginRateLimiter = new LoginRateLimiter();

  const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const url = req.url ?? '/';
      const method = req.method ?? 'GET';
      const isApiRequest = isApiOrHealthRequest(url);

      if (isApiRequest) {
        setStandardApiHeaders(res);
      }

      // CORS headers for dashboard/API consumers. Local origins are allowed by default;
      // remote origins must be explicitly configured in security.trusted_origins.
      const origin = req.headers.origin;
      if (origin && isApiRequest) {
        appendVaryHeader(res, 'Origin');

        if (isAllowedOrigin(origin, config.security)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Govyn-Approval, X-Agent-Id, X-Govyn-Admin-Key, X-Govyn-CSRF');
          res.setHeader('Access-Control-Max-Age', '86400');
        }

        if (method === 'OPTIONS') {
          if (isAllowedOrigin(origin, config.security)) {
            res.writeHead(204);
            res.end();
          } else {
            sendJsonError(res, 403, `Origin ${origin} is not allowed`, 'origin_not_allowed');
          }
          return;
        }
      }

      if (requiresManagementAuth(url, method)) {
        const authResult = authenticateManagementRequest(req, config.security, authManager);
        if (!authResult.ok) {
          sendJsonError(res, authResult.denial.statusCode, authResult.denial.message, authResult.denial.code);
          return;
        }

        if (authResult.identity.type === 'session' && isMutatingMethod(method) && authManager) {
          const csrfDenial = validateSessionCsrf(req, authManager);
          if (csrfDenial) {
            sendJsonError(res, csrfDenial.statusCode, csrfDenial.message, csrfDenial.code);
            return;
          }
        }
      }

      if (url.startsWith('/api/auth/')) {
        if (method === 'GET' && url === '/api/auth/session') {
          try {
            if (!authManager?.isConfigured()) {
              sendJson(res, 200, {
                authenticated: false,
                auth_configured: false,
                username: null,
                csrf_token: null,
              });
              return;
            }

            const sessionId = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
            const session = sessionId ? authManager.getSession(sessionId) : null;
            if (!session) {
              sendJson(res, 200, {
                authenticated: false,
                auth_configured: true,
                username: null,
                csrf_token: null,
              });
              return;
            }

            sendJson(res, 200, {
              authenticated: true,
              auth_configured: true,
              username: session.username,
              csrf_token: session.csrfToken,
              expires_at: session.expiresAt,
            });
          } catch {
            sendJsonError(res, 500, 'Local auth is misconfigured', 'auth_config_error');
          }
          return;
        }

        if (method === 'POST' && url === '/api/auth/login') {
          if (!authManager?.isConfigured()) {
            sendJsonError(res, 409, 'Local dashboard auth is not configured. Run `govyn admin setup`.', 'auth_not_configured');
            return;
          }

          readRequestBody(req).then((bodyBuffer) => {
            let parsed: { username?: string; password?: string };
            try {
              parsed = JSON.parse(bodyBuffer.toString('utf8')) as { username?: string; password?: string };
            } catch {
              sendJsonError(res, 400, 'Invalid JSON body', 'invalid_request');
              return;
            }

            if (!parsed.username || !parsed.password) {
              sendJsonError(res, 400, 'Missing username or password', 'invalid_request');
              return;
            }

            const remoteAddress = req.socket.remoteAddress ?? 'unknown';
            const loginKey = `${remoteAddress}:${parsed.username.trim().toLowerCase()}`;
            const retryAfter = loginRateLimiter.getRetryAfterSeconds(loginKey);
            if (retryAfter) {
              sendJson(res, 429, {
                error: {
                  message: 'Too many login attempts. Try again later.',
                  code: 'login_rate_limited',
                },
              }, {
                'retry-after': retryAfter.toString(),
              });
              return;
            }

            try {
              const loginResult = authManager.login(parsed.username, parsed.password);
              if (!loginResult) {
                const blockedFor = loginRateLimiter.recordFailure(loginKey);
                if (blockedFor) {
                  sendJson(res, 429, {
                    error: {
                      message: 'Too many login attempts. Try again later.',
                      code: 'login_rate_limited',
                    },
                  }, {
                    'retry-after': blockedFor.toString(),
                  });
                  return;
                }

                sendJsonError(res, 401, 'Invalid username or password', 'invalid_credentials');
                return;
              }

              loginRateLimiter.clear(loginKey);
              const secure = isSecureRequest(req);
              const expiresAtMs = Date.parse(loginResult.expiresAt);
              const maxAgeSeconds = Math.max(
                0,
                Math.floor((expiresAtMs - Date.now()) / 1000),
              );
              sendJson(res, 200, {
                authenticated: true,
                auth_configured: true,
                username: loginResult.username,
                csrf_token: loginResult.csrfToken,
                expires_at: loginResult.expiresAt,
              }, {
                'set-cookie': buildSessionCookie(loginResult.sessionId, secure, maxAgeSeconds),
              });
            } catch {
              sendJsonError(res, 500, 'Local auth is misconfigured', 'auth_config_error');
            }
          }).catch(() => {
            sendJsonError(res, 400, 'Invalid request body', 'invalid_request');
          });
          return;
        }

        if (method === 'POST' && url === '/api/auth/logout') {
          const secure = isSecureRequest(req);
          const sessionId = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);

          if (sessionId && authManager?.isConfigured()) {
            const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
            if (origin && !isAllowedOrigin(origin, config.security)) {
              sendJsonError(res, 403, `Origin ${origin} is not allowed`, 'origin_not_allowed');
              return;
            }

            const csrfDenial = validateSessionCsrf(req, authManager);
            if (csrfDenial) {
              sendJsonError(res, csrfDenial.statusCode, csrfDenial.message, csrfDenial.code);
              return;
            }

            try {
              authManager.logout(sessionId);
            } catch {
              sendJsonError(res, 500, 'Local auth is misconfigured', 'auth_config_error');
              return;
            }
          }

          sendJson(res, 200, { success: true }, {
            'set-cookie': buildClearedSessionCookie(secure),
          });
          return;
        }

        if (method === 'POST' && url === '/api/auth/change-password') {
          if (!authManager?.isConfigured()) {
            sendJsonError(res, 409, 'Local dashboard auth is not configured. Run `govyn admin setup`.', 'auth_not_configured');
            return;
          }

          const sessionId = parseCookie(req.headers.cookie, SESSION_COOKIE_NAME);
          const session = sessionId ? authManager.getSession(sessionId) : null;
          if (!sessionId || !session) {
            sendJsonError(res, 401, 'A valid dashboard session is required', 'dashboard_auth_required');
            return;
          }

          const csrfDenial = validateSessionCsrf(req, authManager);
          if (csrfDenial) {
            sendJsonError(res, csrfDenial.statusCode, csrfDenial.message, csrfDenial.code);
            return;
          }

          readRequestBody(req).then((bodyBuffer) => {
            let parsed: { current_password?: string; new_password?: string };
            try {
              parsed = JSON.parse(bodyBuffer.toString('utf8')) as { current_password?: string; new_password?: string };
            } catch {
              sendJsonError(res, 400, 'Invalid JSON body', 'invalid_request');
              return;
            }

            if (!parsed.current_password || !parsed.new_password) {
              sendJsonError(res, 400, 'Missing current_password or new_password', 'invalid_request');
              return;
            }

            try {
              authManager.changePassword(sessionId, parsed.current_password, parsed.new_password);
              sendJson(res, 200, {
                success: true,
                message: 'Password updated. Sign in again with the new password.',
              }, {
                'set-cookie': buildClearedSessionCookie(isSecureRequest(req)),
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Could not update password';
              sendJsonError(res, 400, message, 'invalid_request');
            }
          }).catch(() => {
            sendJsonError(res, 400, 'Invalid request body', 'invalid_request');
          });
          return;
        }

        sendJsonError(res, 404, `No route matched for: ${url}`, 'not_found');
        return;
      }

      // Health check endpoint — serve before proxy routing
      if (url === '/health' && method === 'GET') {
        handleHealth(req, res);
        return;
      }

      // Cost summary API endpoint
      if (url.startsWith('/api/costs') && method === 'GET') {
        handleCostApi(req, res, aggregator);
        return;
      }

      // Budget status API endpoint
      if (url.startsWith('/api/budgets')) {
        handleBudgetApi(req, res, enforcer);
        return;
      }

      // Agent unblock API endpoint: POST /api/agents/:agentId/unblock
      if (method === 'POST' && url.startsWith('/api/agents/') && url.endsWith('/unblock')) {
        // Extract agentId from URL: /api/agents/{agentId}/unblock
        const agentIdMatch = url.match(/^\/api\/agents\/(.+)\/unblock$/);
        const agentId = agentIdMatch ? agentIdMatch[1] : null;
        if (!agentId) {
          sendJsonError(res, 400, 'Invalid agent ID in URL', 'invalid_request');
          return;
        }
        const wasBlocked = enforcer.unblockAgent(agentId);
        if (wasBlocked) {
          const responseBody = JSON.stringify({ success: true, agent_id: agentId });
          res.writeHead(200, {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(responseBody).toString(),
          });
          res.end(responseBody);
        } else {
          sendJsonError(res, 404, `Agent ${agentId} is not currently blocked`, 'agent_not_blocked');
        }
        return;
      }

      // Logging mode toggle API: POST /api/logging/mode
      if (method === 'POST' && url === '/api/logging/mode') {
        if (!actionLogger) {
          sendJsonError(res, 503, 'Action logging is not enabled', 'logging_disabled');
          return;
        }

        // Read JSON body
        const bodyChunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
        req.on('end', () => {
          try {
            const bodyStr = Buffer.concat(bodyChunks).toString('utf8');
            const parsed = JSON.parse(bodyStr) as { agent_id?: string; mode?: string };

            if (!parsed.agent_id || typeof parsed.agent_id !== 'string') {
              sendJsonError(res, 400, 'Missing or invalid agent_id', 'invalid_request');
              return;
            }
            if (parsed.mode !== 'metadata' && parsed.mode !== 'full-payload') {
              sendJsonError(res, 400, 'Invalid mode: must be "metadata" or "full-payload"', 'invalid_request');
              return;
            }

            actionLogger.setMode(parsed.agent_id, parsed.mode as LoggingMode);

            const responseBody = JSON.stringify({
              success: true,
              agent_id: parsed.agent_id,
              mode: parsed.mode,
            });
            res.writeHead(200, {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(responseBody).toString(),
            });
            res.end(responseBody);
          } catch {
            sendJsonError(res, 400, 'Invalid JSON body', 'invalid_request');
          }
        });
        return;
      }

      // Log query/purge API endpoints: GET /api/logs, GET /api/logs/:id, GET /api/logs/:id/payload, DELETE /api/logs?before=DATE
      if (url.startsWith('/api/logs')) {
        if (!actionLogger) {
          sendJsonError(res, 503, 'Action logging is not enabled', 'logging_disabled');
          return;
        }
        handleLogApi(req, res, actionLogger);
        return;
      }

      // Alert management API endpoints
      if (url.startsWith('/api/alerts')) {
        if (alertManager) {
          handleAlertApi(req, res, alertManager);
          return;
        }

        if (handleUnavailableAlerts(req, res)) {
          return;
        }
      }

      if (url.startsWith('/api/approvals')) {
        // Approval list endpoint: GET /api/approvals (without trailing ID)
        if (method === 'GET' && /^\/api\/approvals(\?|$)/.test(url)) {
          if (approvalManager) {
            handleApprovalApi(req, res, approvalManager);
            return;
          }

          if (handleUnavailableApprovals(req, res)) {
            return;
          }
        }

        // Approval polling endpoint: GET /api/approvals/:id
        if (method === 'GET' && url.startsWith('/api/approvals/')) {
          if (!approvalManager) {
            if (handleUnavailableApprovals(req, res)) {
              return;
            }
          } else {
            const id = url.replace('/api/approvals/', '').split('?')[0];
            approvalManager.getApprovalStatus(id).then((status) => {
              if (!status) {
                sendJsonError(res, 404, 'Approval request not found', 'not_found');
                return;
              }
              const responseBody = JSON.stringify({
                id: status.id,
                status: status.status,
                approval_token: status.approvalToken ?? null,
                decided_at: status.decidedAt ?? null,
                expires_at: status.expiresAt,
              });
              res.writeHead(200, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(responseBody).toString(),
              });
              res.end(responseBody);
            }).catch(() => {
              sendJsonError(res, 500, 'Failed to fetch approval status', 'internal_error');
            });
            return;
          }
        }

        // Approval approve/deny endpoints: POST /api/approvals/:id/approve or /api/approvals/:id/deny
        if (method === 'POST' && url.startsWith('/api/approvals/')) {
          if (!approvalManager) {
            if (handleUnavailableApprovals(req, res)) {
              return;
            }
          }

          const approveMatch = url.match(/^\/api\/approvals\/([^/]+)\/(approve|deny)$/);
          if (approveMatch && approvalManager) {
            const requestId = approveMatch[1];
            const action = approveMatch[2] as 'approve' | 'deny';

            const apiBodyChunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => apiBodyChunks.push(chunk));
            req.on('end', () => {
              (async () => {
                try {
                  const apiBodyStr = Buffer.concat(apiBodyChunks).toString('utf8');
                  const parsed = apiBodyStr ? JSON.parse(apiBodyStr) as { decided_by?: string; notes?: string } : {};

                  const decidedBy = parsed.decided_by ?? 'api';

                  let success: boolean;
                  if (action === 'approve') {
                    success = await approvalManager.approveRequest(requestId, decidedBy, parsed.notes);
                  } else {
                    success = await approvalManager.denyRequest(requestId, decidedBy, parsed.notes);
                  }

                  if (success) {
                    const responseBody = JSON.stringify({ success: true, id: requestId, action });
                    res.writeHead(200, {
                      'content-type': 'application/json',
                      'content-length': Buffer.byteLength(responseBody).toString(),
                    });
                    res.end(responseBody);

                    // Audit trail (fire-and-forget)
                    dbWriter?.writeApprovalEvent({
                      requestId,
                      action: action === 'approve' ? 'approved' : 'denied',
                      decidedBy,
                      notes: parsed.notes,
                    }).catch(() => {});
                  } else {
                    sendJsonError(res, 404, `Approval request not found or not pending`, 'not_found');
                  }
                } catch {
                  sendJsonError(res, 400, 'Invalid JSON body', 'invalid_request');
                }
              })();
            });
            return;
          }
        }
      }

      // Policy management API endpoints
      if (url.startsWith('/api/policies') && policyEngine) {
        handlePolicyApi(req, res, policyEngine, policiesFile ?? '');
        return;
      }

      // Resolve agent identity before routing
      const agentIdentity = resolveAgentId(req, config.agents);

      if (!isApiRequest && config.security?.requireAgentApiKey && agentIdentity.source !== 'api-key') {
        sendJsonError(res, 401, 'Proxy requests require a valid agent API key', 'proxy_auth_required');
        return;
      }

      // Check budget before forwarding
      const budgetResult = enforcer.checkBudget(agentIdentity.agentId);

      if (!budgetResult.allowed) {
        // Hard limit exceeded — block with 429
        const resetTime = budgetResult.resetTime ?? new Date().toISOString();
        const resetDate = new Date(resetTime);
        const secondsUntilReset = Math.max(
          0,
          Math.ceil((resetDate.getTime() - Date.now()) / 1000),
        );

        const errorBody = JSON.stringify({
          error: {
            type: 'budget_error',
            code: budgetResult.code,
            message:
              budgetResult.code === 'budget_exceeded_daily'
                ? 'Agent has exceeded its daily budget limit'
                : 'Agent has exceeded its monthly budget limit',
            details: {
              limit_type: budgetResult.code === 'budget_exceeded_daily' ? 'daily' : 'monthly',
              limit_amount: budgetResult.limitAmount,
              current_spend: budgetResult.currentSpend,
              reset_time: resetTime,
              agent_id: agentIdentity.agentId,
            },
          },
        });

        res.writeHead(429, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(errorBody).toString(),
          'retry-after': secondsUntilReset.toString(),
        });
        res.end(errorBody);

        // Also emit internal event for monitoring/alerting
        govynEvents.emit('event', {
          type: 'budget_exceeded',
          agentId: agentIdentity.agentId,
          code: budgetResult.code ?? '',
          limitAmount: budgetResult.limitAmount ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          resetTime,
        });

        // Log budget-blocked requests so they appear in action logs
        if (actionLogger) {
          const logEntry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            agent_id: agentIdentity.agentId,
            provider: (matchRoute(url, config.providers)?.providerType ?? 'openai'),
            target: url ?? '/',
            model: null,
            input_tokens: null,
            output_tokens: null,
            cost: null,
            priced: false,
            latency_ms: 0,
            status: 429,
            has_payload: false,
            payload_id: null,
            storage_region: 'auto',
          };
          actionLogger.log(logEntry);
        }

        return;
      }

      // Build budget warning info if applicable
      let budgetWarning:
        | { percentUsed: number; currentSpend: number; limit: number; resetsAt: string }
        | undefined;

      if (budgetResult.warning && budgetResult.limitAmount !== undefined) {
        const limitPeriod = budgetResult.code?.includes('daily') ? 'daily' : 'monthly';
        budgetWarning = {
          percentUsed: budgetResult.percentUsed ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          limit: budgetResult.limitAmount,
          resetsAt: budgetResult.resetTime ?? new Date().toISOString(),
        };

        // Emit internal budget_warning event
        govynEvents.emit('event', {
          type: 'budget_warning',
          agentId: agentIdentity.agentId,
          percentUsed: budgetResult.percentUsed ?? 0,
          currentSpend: budgetResult.currentSpend ?? 0,
          limit: budgetResult.limitAmount,
          resetsAt: budgetResult.resetTime ?? new Date().toISOString(),
          limitPeriod,
        });
      }

      // Match the request URL to a provider
      const routeMatch = matchRoute(url, config.providers);

      if (!routeMatch) {
        sendJsonError(res, 404, `No route matched for: ${url}`, 'not_found');
        return;
      }

      // Buffer the request body for policy evaluation (content_filter needs body access).
      // The buffered body is then passed to forwardRequest to avoid re-reading the stream.
      const bodyChunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
      req.on('end', () => {
        // Wrap in async IIFE to support approval token validation (DB query)
        (async () => {
        const bodyBuffer = Buffer.concat(bodyChunks);
        const bodyString = bodyBuffer.length > 0 ? bodyBuffer.toString('utf8') : undefined;
        const requestHash = hashApprovalRequest(bodyBuffer);

        // Approval token bypass: if X-Govyn-Approval header is present, validate and skip policies
        const approvalToken = req.headers['x-govyn-approval'] as string | undefined;
        if (approvalToken && approvalManager) {
          try {
            const tokenResult = await approvalManager.validateAndConsumeToken(approvalToken, {
              agentId: agentIdentity.agentId,
              targetPath: routeMatch.upstreamPath,
              requestHash,
            });
            if (tokenResult) {
              // Token is valid — skip policy evaluation, forward request directly
              dbWriter?.writeApprovalEvent({
                requestId: approvalToken,
                action: 'token_consumed',
              }).catch(() => {});

              await forwardRequest(
                req,
                res,
                routeMatch,
                agentIdentity.agentId,
                pricingTable,
                aggregator,
                budgetWarning,
                loopDetector,
                enforcer,
                actionLogger,
                bodyBuffer,
                undefined,
                undefined,
                dbWriter,
              );
              return;
            } else {
              // Invalid/expired/used token
              sendJsonError(res, 403, 'Invalid or expired approval token', 'invalid_approval_token');
              return;
            }
          } catch {
            sendJsonError(res, 500, 'Failed to validate approval token', 'internal_error');
            return;
          }
        }

        // Evaluate policies (between route matching and forwarding)
        const requestedModel = extractModelFromBody(bodyString);
        let actualModel = requestedModel;
        let finalBodyBuffer = bodyBuffer;
        let policyResult: PolicyEvaluationResult | undefined;

        if (policyEngine && policyEngine.getPolicies().length > 0) {
          const routingCtx = extractRoutingContext(bodyString);
          const policyContext: PolicyRequestContext = {
            agentId: agentIdentity.agentId,
            provider: routeMatch.providerType,
            path: routeMatch.upstreamPath,
            method: method,
            body: bodyString,
            headers: req.headers as Record<string, string>,
            model: extractModelFromBody(bodyString),
            inputTokensEstimate: routingCtx.inputTokensEstimate,
            systemPrompt: routingCtx.systemPrompt,
            userPrompt: routingCtx.userPrompt,
            toolCallsPresent: routingCtx.toolCallsPresent,
            conversationTurns: routingCtx.conversationTurns,
          };

          policyResult = policyEngine.evaluate(policyContext);

          if (!policyResult.allowed && policyResult.denied) {
            // Policy denied — determine response code based on policy type
            const denied = policyResult.denied;
            const isRateLimit = denied.policyType === 'rate_limit';
            const statusCode = isRateLimit ? 429 : 403;
            const errorType = isRateLimit ? 'govyn_rate_limited' : 'govyn_policy_violation';

            const errorBody = JSON.stringify({
              error: {
                type: errorType,
                message: denied.message ?? denied.reason ?? `Request blocked by policy '${denied.policyName}'`,
                policy: denied.policyName,
                agent: agentIdentity.agentId,
                retry_after_seconds: denied.retryAfterSeconds ?? null,
              },
            });

            const responseHeaders: Record<string, string> = {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(errorBody).toString(),
            };
            if (isRateLimit && denied.retryAfterSeconds) {
              responseHeaders['retry-after'] = denied.retryAfterSeconds.toString();
            }

            res.writeHead(statusCode, responseHeaders);
            res.end(errorBody);

            // Emit policy_denied event
            govynEvents.emit('event', {
              type: 'policy_denied',
              agentId: agentIdentity.agentId,
              provider: routeMatch.providerType,
              path: routeMatch.upstreamPath,
              policyName: denied.policyName,
              policyType: denied.policyType,
              reason: denied.reason ?? '',
              evaluationTimeMs: policyResult.evaluationTimeMs,
              allowed: false,
            });

            // DB persistence for policy evaluation (fire-and-forget)
            dbWriter?.writePolicyEvaluation({
              agentId: agentIdentity.agentId,
              provider: routeMatch.providerType,
              path: routeMatch.upstreamPath,
              allowed: false,
              evaluatedCount: policyResult.evaluatedCount,
              matchedCount: policyResult.matchedCount,
              deniedBy: denied.policyName,
              deniedReason: denied.reason,
              evaluationTimeMs: policyResult.evaluationTimeMs,
            }).catch(() => {});

            // Log policy-denied request in action logs
            if (actionLogger) {
              const logEntry: LogEntry = {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                agent_id: agentIdentity.agentId,
                provider: routeMatch.providerType,
                target: routeMatch.upstreamPath,
                model: null,
                input_tokens: null,
                output_tokens: null,
                cost: null,
                priced: false,
                latency_ms: 0,
                status: statusCode,
                has_payload: false,
                payload_id: null,
                storage_region: 'auto',
                policy_result: {
                  allowed: false,
                  evaluated_count: policyResult.evaluatedCount,
                  matched_count: policyResult.matchedCount,
                  denied_by: denied.policyName,
                  evaluation_time_ms: policyResult.evaluationTimeMs,
                },
              };
              actionLogger.log(logEntry);
            }

            return;
          }

          // Policy allowed — emit enforced event
          govynEvents.emit('event', {
            type: 'policy_enforced',
            agentId: agentIdentity.agentId,
            provider: routeMatch.providerType,
            path: routeMatch.upstreamPath,
            policyCount: policyResult.matchedCount,
            evaluationTimeMs: policyResult.evaluationTimeMs,
            allowed: true,
          });

          // DB persistence for policy evaluation (fire-and-forget)
          dbWriter?.writePolicyEvaluation({
            agentId: agentIdentity.agentId,
            provider: routeMatch.providerType,
            path: routeMatch.upstreamPath,
            allowed: true,
            evaluatedCount: policyResult.evaluatedCount,
            matchedCount: policyResult.matchedCount,
            evaluationTimeMs: policyResult.evaluationTimeMs,
          }).catch(() => {});

          // Check for require_approval results (only if request would otherwise be allowed)
          const approvalResult = policyResult.results.find(
            (r) => r.policyType === 'require_approval' && (r as ApprovalPolicyResult).requiresApproval,
          ) as ApprovalPolicyResult | undefined;

          if (approvalResult && approvalManager) {
            try {
              // Check DB availability (approvals ALWAYS require DB, even in fail-open)
              const dbAvailable = await dbWriter?.isAvailable();
              if (!dbAvailable) {
                sendJsonError(res, 503, 'Approval required but database is unavailable', 'approval_db_unavailable');
                return;
              }

              // Generate request summary
              const summary = generateRequestSummary(bodyString, 500);

              // Create approval request in DB
              const approval = await approvalManager.createApprovalRequest({
                agentId: agentIdentity.agentId,
                provider: routeMatch.providerType,
                model: extractModelFromBody(bodyString),
                targetPath: routeMatch.upstreamPath,
                policyName: approvalResult.policyName,
                estimatedCost: undefined,
                requestSummary: summary,
                requestHash,
                requestPayload: approvalResult.storePayload ? JSON.parse(bodyString ?? '{}') : undefined,
                timeoutSeconds: approvalResult.timeoutSeconds,
              });

              // Return HTTP 202 Accepted with polling info
              const responseBody = JSON.stringify({
                status: 'approval_required',
                approval_id: approval.id,
                polling_url: approval.pollingUrl,
                expires_at: approval.expiresAt,
                message: approvalResult.message ?? `Request requires human approval (policy: ${approvalResult.policyName})`,
              });
              res.writeHead(202, {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(responseBody).toString(),
                'location': approval.pollingUrl,
              });
              res.end(responseBody);

              // Audit trail (fire-and-forget)
              dbWriter?.writeApprovalEvent({
                requestId: approval.id,
                action: 'created',
              }).catch(() => {});

              return;
            } catch {
              console.error('[server] failed to create approval request');
              sendJsonError(res, 500, 'Failed to create approval request', 'internal_error');
              return;
            }
          }

          // Check for model_route results with routeTo
          const routeResult = policyResult.results.find(
            (r) => r.policyType === 'model_route' && (r as ModelRouteResult).routeTo,
          ) as ModelRouteResult | undefined;

          if (routeResult?.routeTo) {
            // Rewrite the model field in the JSON body
            actualModel = routeResult.routeTo;
            try {
              const parsed = JSON.parse(bodyString ?? '{}');
              parsed.model = actualModel;
              const rewritten = JSON.stringify(parsed);
              finalBodyBuffer = Buffer.from(rewritten, 'utf8');
            } catch {
              // If body parse fails, skip rewriting (passthrough)
            }

            // Emit model_routed event for observability
            govynEvents.emit('event', {
              type: 'model_routed',
              agentId: agentIdentity.agentId,
              provider: routeMatch.providerType,
              requestedModel: requestedModel ?? 'unknown',
              actualModel,
              policyName: routeResult.policyName,
              matchedRuleIndex: routeResult.matchedRuleIndex,
            });
          }
        }

        // Forward the request to the upstream provider, attributing cost to the resolved agent.
        // Pass finalBodyBuffer (rewritten or original) to avoid re-reading the consumed stream.
        // Pass requestedModel so cost tracking records original model before routing.
        await forwardRequest(
          req,
          res,
          routeMatch,
          agentIdentity.agentId,
          pricingTable,
          aggregator,
          budgetWarning,
          loopDetector,
          enforcer,
          actionLogger,
          finalBodyBuffer,
          requestedModel !== actualModel ? requestedModel : undefined,
          policyResult,  // pass the evaluation result for action log enrichment
          dbWriter,
        );
        })().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error('[server] unhandled forwarding error:', message);
          if (!res.headersSent) {
            sendJsonError(res, 500, 'Internal proxy error', 'internal_error');
          } else if (!res.writableEnded) {
            res.end();
          }
        });
      });
    },
  );

  server.listen(config.port, config.host, () => {
    console.log(`[govyn] Proxy server listening on ${config.host}:${config.port}`);
  });

  return server;
}
