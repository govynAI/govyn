import * as crypto from 'node:crypto';
import * as dns from 'node:dns/promises';
import * as httpRequest from 'node:http';
import * as httpsRequest from 'node:https';
import * as net from 'node:net';
import type * as http from 'node:http';
import type { LocalAuthManager, AuthSession } from './auth.js';
import { SESSION_COOKIE_NAME } from './auth.js';
import type { SecurityConfig } from './types.js';

export const DEFAULT_ADMIN_API_KEY_ENV = 'GOVYN_ADMIN_API_KEY';

function unwrapHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' ? value : null;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function normalizeIp(ip: string): string {
  const withoutZone = ip.split('%')[0] ?? ip;
  const normalized = withoutZone.toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}

function parseIpv4(ip: string): number[] | null {
  const parts = normalizeIp(ip).split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match ? match[1] ?? null : null;
}

function parseCookies(headerValue: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!headerValue) return cookies;

  for (const part of headerValue.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;

    const name = rawName.trim();
    const value = rawValue.join('=').trim();
    if (!name || !value) continue;

    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  return leftBuf.length === rightBuf.length && crypto.timingSafeEqual(leftBuf, rightBuf);
}

export function normalizeOrigin(origin: string): string | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.search || parsed.hash) return null;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (normalized === '::1') return true;

  const octets = parseIpv4(normalized);
  if (!octets) return false;
  return octets[0] === 127;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (normalized === '::' || normalized === '0.0.0.0') return true;
  if (isLoopbackIp(normalized)) return true;

  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }

  if (!net.isIPv6(normalized)) return false;

  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return (
    (firstHextet & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (firstHextet & 0xffc0) === 0xfe80 || // fe80::/10 link local
    normalized === '::1'
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = normalizeHost(hostname);
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'host.docker.internal'
  ) {
    return true;
  }

  if (net.isIP(normalized)) {
    return isLoopbackIp(normalized);
  }

  return false;
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHost(hostname);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  if (!net.isIP(normalized)) {
    return false;
  }

  return isLoopbackIp(normalized);
}

function isBlockedWebhookHostname(hostname: string): boolean {
  const normalized = normalizeHost(hostname);

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'host.docker.internal' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true;
  }

  return net.isIP(normalized) ? isPrivateOrReservedIp(normalized) : false;
}

export function isAllowedOrigin(origin: string, security?: SecurityConfig): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const parsed = new URL(normalized);
  if (isLocalHostname(parsed.hostname)) {
    return true;
  }

  return (security?.allowedOrigins ?? []).includes(normalized);
}

export function isLocalRequest(req: http.IncomingMessage): boolean {
  const remoteAddress = req.socket.remoteAddress;
  if (!remoteAddress) return false;

  const normalized = normalizeHost(remoteAddress);
  if (net.isIP(normalized)) {
    return isLoopbackIp(normalized);
  }

  return isLocalHostname(normalized);
}

function requireAllowedOrigin(
  req: http.IncomingMessage,
  security?: SecurityConfig,
): { statusCode: number; message: string; code: string } | null {
  const origin = unwrapHeader(req.headers.origin);
  if (!origin) {
    return null;
  }

  if (isAllowedOrigin(origin, security)) {
    return null;
  }

  return {
    statusCode: 403,
    message: `Origin ${origin} is not allowed`,
    code: 'origin_not_allowed',
  };
}

export interface ManagementAuthIdentity {
  type: 'session' | 'admin-key' | 'local';
  username?: string;
  session?: AuthSession;
}

function extractAdminApiKey(req: http.IncomingMessage): string | null {
  const providedViaHeader = unwrapHeader(req.headers['x-govyn-admin-key']);
  const providedViaBearer = extractBearerToken(unwrapHeader(req.headers['authorization']));
  return providedViaHeader ?? providedViaBearer;
}

function getSessionFromRequest(
  req: http.IncomingMessage,
  authManager?: LocalAuthManager,
): AuthSession | null {
  if (!authManager?.isConfigured()) {
    return null;
  }

  const cookies = parseCookies(unwrapHeader(req.headers.cookie));
  const sessionId = cookies.get(SESSION_COOKIE_NAME);
  if (!sessionId) {
    return null;
  }

  return authManager.getSession(sessionId);
}

export function authenticateManagementRequest(
  req: http.IncomingMessage,
  security?: SecurityConfig,
  authManager?: LocalAuthManager,
): { ok: true; identity: ManagementAuthIdentity } | { ok: false; denial: { statusCode: number; message: string; code: string } } {
  const originDenial = requireAllowedOrigin(req, security);
  if (originDenial) {
    return { ok: false, denial: originDenial };
  }

  try {
    const session = getSessionFromRequest(req, authManager);
    if (session) {
      return {
        ok: true,
        identity: {
          type: 'session',
          username: session.username,
          session,
        },
      };
    }
  } catch {
    return {
      ok: false,
      denial: {
        statusCode: 500,
        message: 'Local auth is misconfigured',
        code: 'auth_config_error',
      },
    };
  }

  const adminApiKeyEnv = security?.adminApiKeyEnv;
  const expectedApiKey = adminApiKeyEnv ? process.env[adminApiKeyEnv] : undefined;
  const providedApiKey = extractAdminApiKey(req);

  if (expectedApiKey && expectedApiKey.length > 0) {
    if (providedApiKey && timingSafeEqual(expectedApiKey, providedApiKey)) {
      return {
        ok: true,
        identity: {
          type: 'admin-key',
        },
      };
    }

    return {
      ok: false,
      denial: {
        statusCode: 401,
        message: 'Management API requires a valid dashboard session or admin API key',
        code: 'admin_auth_required',
      },
    };
  }

  if (authManager?.isConfigured()) {
    return {
      ok: false,
      denial: {
        statusCode: 401,
        message: 'Management API requires a valid dashboard session',
        code: 'dashboard_auth_required',
      },
    };
  }

  if (security?.allowLocalAdmin !== false && isLocalRequest(req)) {
    return {
      ok: true,
      identity: {
        type: 'local',
      },
    };
  }

  return {
    ok: false,
    denial: {
      statusCode: 403,
      message: `${adminApiKeyEnv ?? DEFAULT_ADMIN_API_KEY_ENV} is not configured; management API access is limited to local requests`,
      code: 'management_api_forbidden',
    },
  };
}

export function authorizeManagementRequest(
  req: http.IncomingMessage,
  security?: SecurityConfig,
  authManager?: LocalAuthManager,
): { statusCode: number; message: string; code: string } | null {
  const result = authenticateManagementRequest(req, security, authManager);
  return result.ok ? null : result.denial;
}

export function validateSessionCsrf(
  req: http.IncomingMessage,
  authManager: LocalAuthManager,
): { statusCode: number; message: string; code: string } | null {
  const cookies = parseCookies(unwrapHeader(req.headers.cookie));
  const sessionId = cookies.get(SESSION_COOKIE_NAME);
  const csrfHeader = unwrapHeader(req.headers['x-govyn-csrf']);

  if (!sessionId || !csrfHeader) {
    return {
      statusCode: 403,
      message: 'A valid CSRF token is required',
      code: 'csrf_invalid',
    };
  }

  try {
    if (authManager.validateCsrfToken(sessionId, csrfHeader)) {
      return null;
    }
  } catch {
    return {
      statusCode: 500,
      message: 'Local auth is misconfigured',
      code: 'auth_config_error',
    };
  }

  return {
    statusCode: 403,
    message: 'A valid CSRF token is required',
    code: 'csrf_invalid',
  };
}

export function validateWebhookUrl(
  value: string,
): { ok: true; normalizedUrl: string } | { ok: false; error: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, error: 'Missing or invalid webhook_url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return { ok: false, error: 'Invalid webhook_url: must be a valid absolute URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Invalid webhook_url: only http:// and https:// are supported' };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Invalid webhook_url: embedded credentials are not allowed' };
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'Invalid webhook_url: hostname is required' };
  }

  if (isBlockedWebhookHostname(parsed.hostname)) {
    return {
      ok: false,
      error: 'Invalid webhook_url: private, loopback, or local-network destinations are not allowed',
    };
  }

  return { ok: true, normalizedUrl: parsed.toString() };
}

export interface ResolvedWebhookTarget {
  normalizedUrl: string;
  address: string;
  family: 4 | 6;
  hostHeader: string;
  hostname: string;
  pathname: string;
  port: number;
  protocol: 'http:' | 'https:';
  search: string;
}

async function resolvePublicAddress(
  hostname: string,
): Promise<{ ok: true; address: string; family: 4 | 6 } | { ok: false; error: string }> {
  if (net.isIP(hostname)) {
    return { ok: true, address: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: 'Invalid webhook_url: hostname could not be resolved' };
  }

  if (answers.length === 0) {
    return { ok: false, error: 'Invalid webhook_url: hostname could not be resolved' };
  }

  const normalizedAnswers = answers.map((answer) => ({
    address: normalizeIp(answer.address),
    family: answer.family === 6 ? 6 as const : 4 as const,
  }));

  if (normalizedAnswers.some((answer) => isPrivateOrReservedIp(answer.address))) {
    return {
      ok: false,
      error: 'Invalid webhook_url: hostname resolves to a private, loopback, or local-network address',
    };
  }

  return { ok: true, address: normalizedAnswers[0].address, family: normalizedAnswers[0].family };
}

export async function resolveWebhookTarget(
  value: string,
): Promise<{ ok: true; target: ResolvedWebhookTarget } | { ok: false; error: string }> {
  const validated = validateWebhookUrl(value);
  if (!validated.ok) {
    return validated;
  }

  const parsed = new URL(validated.normalizedUrl);
  const resolved = await resolvePublicAddress(parsed.hostname);
  if (!resolved.ok) {
    return resolved;
  }

  const port = parsed.port
    ? Number.parseInt(parsed.port, 10)
    : parsed.protocol === 'https:'
      ? 443
      : 80;
  const defaultPort = (parsed.protocol === 'https:' && port === 443)
    || (parsed.protocol === 'http:' && port === 80);

  return {
    ok: true,
    target: {
      normalizedUrl: validated.normalizedUrl,
      address: resolved.address,
      family: resolved.family,
      hostHeader: defaultPort ? parsed.hostname : `${parsed.hostname}:${port}`,
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      port,
      protocol: parsed.protocol as 'http:' | 'https:',
      search: parsed.search,
    },
  };
}

export async function deliverWebhookJson(
  target: ResolvedWebhookTarget,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<{ status: number }> {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: target.address,
        port: target.port,
        method: 'POST',
        path: `${target.pathname}${target.search}`,
        servername: target.protocol === 'https:' ? target.hostname : undefined,
        timeout: timeoutMs,
        headers: {
          'content-type': 'application/json',
          'content-length': body.byteLength.toString(),
          'host': target.hostHeader,
          'user-agent': 'Govyn-Alerts/1.0',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        res.on('end', () => {
          if (status >= 300 && status < 400) {
            reject(new Error('Webhook redirects are not allowed'));
            return;
          }

          resolve({ status });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error('Webhook request timed out'));
    });
    req.on('error', reject);
    req.end(body);
  });
}
