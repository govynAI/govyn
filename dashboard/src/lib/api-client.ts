/**
 * Proxy API client for the Govyn dashboard.
 *
 * Provides a configurable base URL (stored in localStorage),
 * a health ping method, and a generic fetch wrapper for proxy API calls.
 */

const STORAGE_KEY = "govyn-proxy-url";
const PING_TIMEOUT_MS = 5_000;

export interface PingResult {
  ok: boolean;
  latencyMs: number;
  data?: {
    status: string;
    version: string;
    uptime_seconds: number;
  };
}

/** Read the stored proxy URL from localStorage. */
export function getBaseUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Write the proxy URL to localStorage. */
export function setBaseUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // localStorage may be unavailable in some contexts
  }
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

    const normalizedUrl = url.replace(/\/+$/, "");
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
  options?: RequestInit
): Promise<Response> {
  const url = getBaseUrl();
  if (!url) {
    throw new Error("Proxy URL not configured");
  }

  const normalizedBase = url.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return fetch(`${normalizedBase}${normalizedPath}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
}
