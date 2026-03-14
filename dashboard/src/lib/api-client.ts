/**
 * Proxy API client for the Govyn dashboard.
 *
 * Provides a configurable base URL (stored in localStorage),
 * a health ping method, auth helpers, and a generic fetch wrapper for proxy API calls.
 */

const STORAGE_KEY = "govyn-proxy-url";
const CSRF_STORAGE_KEY = "govyn-csrf-token";
const PING_TIMEOUT_MS = 5_000;

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export interface AuthSessionResult {
  authenticated: boolean;
  auth_configured: boolean;
  username: string | null;
  csrf_token?: string | null;
  expires_at?: string | null;
}

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  data?: {
    status: string;
    version: string;
    uptime_seconds: number;
  };
}

export function normalizeProxyUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    const currentHostname = window.location.hostname;

    if (
      isLoopbackHostname(parsed.hostname) &&
      isLoopbackHostname(currentHostname) &&
      parsed.hostname !== currentHostname
    ) {
      parsed.hostname = currentHostname;
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/** Read the stored proxy URL from localStorage. */
export function getBaseUrl(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) {
      return null;
    }

    const normalized = normalizeProxyUrl(value);
    if (normalized !== value) {
      localStorage.setItem(STORAGE_KEY, normalized);
    }

    return normalized;
  } catch {
    return null;
  }
}

/** Write the proxy URL to localStorage. */
export function setBaseUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeProxyUrl(url));
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

export function getCsrfToken(): string | null {
  try {
    return sessionStorage.getItem(CSRF_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setCsrfToken(value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(CSRF_STORAGE_KEY, value);
    } else {
      sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

export function clearCsrfToken(): void {
  setCsrfToken("");
}

function isMutatingMethod(method?: string): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return (
    normalized === "POST" ||
    normalized === "PUT" ||
    normalized === "PATCH" ||
    normalized === "DELETE"
  );
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return fallback;
}

/**
 * Ping the proxy's /health endpoint.
 *
 * Returns timing and response data. On any failure (network error,
 * timeout, missing URL), returns `{ ok: false, latencyMs: -1 }`.
 */
export async function ping(baseUrl?: string | null): Promise<PingResult> {
  const url = baseUrl ?? getBaseUrl();
  if (!url) {
    return { ok: false, latencyMs: -1 };
  }

  const start = performance.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    const normalizedUrl = normalizeProxyUrl(url);
    const response = await fetch(`${normalizedUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Math.round(performance.now() - start);

    if (!response.ok) {
      return { ok: false, latencyMs };
    }

    const data = (await response.json()) as {
      status: string;
      version: string;
      uptime_seconds: number;
    };

    return { ok: true, latencyMs, data };
  } catch {
    return { ok: false, latencyMs: -1 };
  }
}

/**
 * Fetch wrapper that prepends the proxy base URL.
 *
 * Usage: `await apiFetch("/api/costs")` resolves to `GET {baseUrl}/api/costs`.
 * Returns the raw Response object. Throws if no base URL is configured.
 */
export async function apiFetch(
  path: string,
  options?: RequestInit,
  baseUrl?: string | null
): Promise<Response> {
  const url = baseUrl ?? getBaseUrl();
  if (!url) {
    throw new Error("Proxy URL not configured");
  }

  const normalizedBase = normalizeProxyUrl(url);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(options?.headers);
  if (options?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (isMutatingMethod(options?.method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-Govyn-CSRF", csrfToken);
    }
  }

  const response = await fetch(`${normalizedBase}${normalizedPath}`, {
    ...options,
    credentials: "include",
    headers,
  });

  if (response.status === 401 && !normalizedPath.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event("govyn-auth-required"));
  }

  return response;
}

export async function fetchAuthSession(
  baseUrl?: string | null
): Promise<AuthSessionResult> {
  const response = await apiFetch("/api/auth/session", { method: "GET" }, baseUrl);
  const data = (await response.json()) as AuthSessionResult;

  if (!response.ok) {
    throw new Error(parseErrorMessage(data, "Could not load dashboard session"));
  }

  if (data.authenticated && data.csrf_token) {
    setCsrfToken(data.csrf_token);
  } else {
    clearCsrfToken();
  }

  return data;
}

export async function loginWithPassword(
  username: string,
  password: string,
  baseUrl?: string | null
): Promise<AuthSessionResult> {
  const response = await apiFetch(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
    baseUrl
  );
  const data = (await response.json()) as AuthSessionResult;

  if (!response.ok) {
    throw new Error(parseErrorMessage(data, "Could not sign in"));
  }

  if (data.csrf_token) {
    setCsrfToken(data.csrf_token);
  }

  return data;
}

export async function logoutFromDashboard(baseUrl?: string | null): Promise<void> {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" }, baseUrl);
  } finally {
    clearCsrfToken();
  }
}

export async function changeDashboardPassword(
  currentPassword: string,
  newPassword: string,
  baseUrl?: string | null
): Promise<void> {
  const response = await apiFetch(
    "/api/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    },
    baseUrl
  );

  const data = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(parseErrorMessage(data, "Could not update password"));
  }

  clearCsrfToken();
}
