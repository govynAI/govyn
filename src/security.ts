import * as crypto from 'node:crypto';
import * as dns from 'node:dns/promises';
import * as httpRequest from 'node:http';
import * as httpsRequest from 'node:https';
import * as net from 'node:net';
import type * as http from 'node:http';
import ipaddr from 'ipaddr.js';
import type { LocalAuthManager, AuthSession } from './auth.js';
import { SESSION_COOKIE_NAME } from './auth.js';
import type { SecurityConfig } from './types.js';

/**
 * IP ranges that must be blocked for SSRF protection.
 * Covers IPv4 private/reserved and IPv6 equivalents including ULA, link-local,
 * documentation ranges, and carrier-grade NAT.
 */
const BLOCKED_IP_RANGES: ReadonlySet<string> = new Set([
  'loopback',
  'uniqueLocal',
  'linkLocal',
  'private',
  'carrierGradeNat',
  'unspecified',
  'reserved',
]);

/**
 * Hostnames that resolve to cloud metadata services or other internal endpoints.
 * These must be blocked regardless of what IP they resolve to.
 */
const BLOCKED_METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata.google.internal',
]);

/** DNS error codes that mean "no records of this type" (not a real failure) */
const BENIGN_DNS_ERRORS: ReadonlySet<string> = new Set(['ENODATA', 'ENOTFOUND']);

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
  try {
    const addr = ipaddr.parse(normalizeIp(ip));

    // Handle IPv4-mapped IPv6 loopback (e.g. ::ffff:127.0.0.1)
    if (addr.kind() === 'ipv6') {
      const v6 = addr as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) {
        return v6.toIPv4Address().range() === 'loopback';
      }
    }

    return addr.range() === 'loopback';
  } catch {
    return false;
  }
}

export function isPrivateOrReservedIp(ip: string): boolean {
  try {
    const addr = ipaddr.parse(normalizeIp(ip));

    // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:10.0.0.1, ::ffff:192.168.1.1)
    // These must be unwrapped and checked against IPv4 private ranges.
    if (addr.kind() === 'ipv6') {
      const v6 = addr as ipaddr.IPv6;
      if (v6.isIPv4MappedAddress()) {
        const v4 = v6.toIPv4Address();
        return BLOCKED_IP_RANGES.has(v4.range());
      }
    }

    return BLOCKED_IP_RANGES.has(addr.range());
  } catch {
    // Unparseable IP = reject (fail closed)
    return true;
  }
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

  if (BLOCKED_METADATA_HOSTNAMES.has(normalized)) {
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

/**
 * Async SSRF check with DNS rebinding defense.
 *
 * First runs a synchronous check on the URL (protocol, hostname patterns, IP literals).
 * If the hostname is not an IP literal, resolves both A (IPv4) and AAAA (IPv6) DNS records
 * and checks ALL resolved addresses against private/reserved ranges.
 *
 * Returns true if the URL should be blocked.
 *
 * Behavior:
 * - If the hostname is an IP literal already checked by sync path, skips DNS
 * - Resolves A and AAAA records in parallel
 * - ENODATA/ENOTFOUND per record type means "no records" (not a failure)
 * - If both lookups fail with real errors, returns true (fail closed)
 * - If ANY resolved IP is private/reserved, returns true
 */
export async function resolveAndCheckUrl(urlStr: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return true; // Unparseable URL = fail closed
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return true;
  }

  const hostname = normalizeHost(parsed.hostname);

  // Check blocked hostnames (localhost, metadata endpoints, etc.)
  if (isBlockedWebhookHostname(hostname)) {
    return true;
  }

  // If hostname is an IP literal, just check the IP directly
  if (net.isIP(hostname)) {
    return isPrivateOrReservedIp(hostname);
  }

  // Resolve DNS (both A and AAAA) and check all results
  const [v4Result, v6Result] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);

  const allIps: string[] = [];
  let v4Benign = false;
  let v6Benign = false;

  if (v4Result.status === 'fulfilled') {
    allIps.push(...v4Result.value);
  } else {
    const err = v4Result.reason as NodeJS.ErrnoException;
    v4Benign = BENIGN_DNS_ERRORS.has(err.code ?? '');
  }

  if (v6Result.status === 'fulfilled') {
    allIps.push(...v6Result.value);
  } else {
    const err = v6Result.reason as NodeJS.ErrnoException;
    v6Benign = BENIGN_DNS_ERRORS.has(err.code ?? '');
  }

  // If both failed with real errors (not ENODATA/ENOTFOUND), fail closed
  if (allIps.length === 0) {
    const bothFailed = v4Result.status === 'rejected' && v6Result.status === 'rejected';
    if (bothFailed && !v4Benign && !v6Benign) {
      return true;
    }
    // Both returned ENODATA/ENOTFOUND: hostname has no records -- allow
    // (will fail at the actual fetch anyway)
    return false;
  }

  // If ANY resolved IP is private/reserved, block
  return allIps.some((ip) => isPrivateOrReservedIp(ip));
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
