/**
 * Request forwarding logic for the Govyn proxy server.
 *
 * Uses Node.js built-in http/https module for zero-dependency,
 * low-latency request forwarding (per ADR-013).
 *
 * - Forwards ALL upstream response headers verbatim, including rate-limit headers
 *   (Retry-After, x-ratelimit-*) — per ADR-016: 429s are passed through, not retried
 * - Delegates SSE responses to handleStreamingResponse for chunk-by-chunk piping
 * - Returns 502 only for proxy-own errors (upstream unreachable, connection timeout)
 */

import * as http from 'node:http';
import * as https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteMatch } from './types.js';
import { mapOpenAIHeaders } from './providers/openai.js';
import { mapAnthropicHeaders } from './providers/anthropic.js';
import { mapCustomHeaders } from './providers/custom.js';
import { handleStreamingResponse } from './streaming.js';

/**
 * Select the appropriate header mapping function based on provider type.
 */
function mapHeaders(
  incomingHeaders: http.IncomingHttpHeaders,
  routeMatch: RouteMatch,
): Record<string, string> {
  const { provider, providerType } = routeMatch;

  switch (providerType) {
    case 'openai':
      return mapOpenAIHeaders(incomingHeaders, provider.apiKeyEnv);
    case 'anthropic':
      return mapAnthropicHeaders(incomingHeaders, provider.apiKeyEnv);
    case 'custom':
      return mapCustomHeaders(incomingHeaders, provider.apiKeyEnv);
    default: {
      // Exhaustive check
      const _exhaustive: never = providerType;
      throw new Error(`Unknown provider type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Send a JSON error response to the client.
 * Only used for proxy-own errors (upstream unreachable, timeout, etc.).
 * Upstream error responses (4xx, 5xx) are forwarded verbatim.
 */
function sendErrorResponse(
  res: ServerResponse,
  statusCode: number,
  message: string,
  code: string,
): void {
  const body = JSON.stringify({ error: { message, code } });
  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    });
  }
  res.end(body);
}

/**
 * Forward an incoming HTTP request to the upstream provider API.
 *
 * - Uses Node.js http/https module (NOT node-fetch, NOT axios)
 * - Reads request body from incoming stream
 * - Maps headers for the target provider
 * - Forwards ALL upstream response headers verbatim (including rate-limit headers)
 * - For SSE responses: delegates to handleStreamingResponse for chunk-by-chunk piping
 * - For non-SSE responses: pipes upstream response body to client directly
 * - For upstream errors (4xx, 5xx): forwards status code + headers + body verbatim
 * - For proxy errors (upstream unreachable, timeout): returns 502 with Govyn error format
 * - Logs time from request start to first upstream byte
 */
export async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routeMatch: RouteMatch,
): Promise<void> {
  const requestStart = Date.now();
  const { provider, upstreamPath } = routeMatch;

  // Parse the upstream base URL
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(provider.baseUrl);
  } catch {
    sendErrorResponse(res, 502, 'Invalid upstream base URL configured', 'invalid_config');
    return;
  }

  // Build upstream request options
  const upstreamHost = upstreamUrl.hostname;
  const upstreamPort =
    upstreamUrl.port
      ? parseInt(upstreamUrl.port, 10)
      : upstreamUrl.protocol === 'https:'
        ? 443
        : 80;
  const isHttps = upstreamUrl.protocol === 'https:';

  // Map headers for the upstream provider
  const mappedHeaders = mapHeaders(req.headers, routeMatch);

  // Read request body
  const bodyChunks: Buffer[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
      req.on('end', resolve);
      req.on('error', reject);
    });
  } catch {
    sendErrorResponse(res, 500, 'Error reading request body', 'request_read_error');
    return;
  }

  const body = Buffer.concat(bodyChunks);

  // Update content-length to match actual body
  if (body.length > 0) {
    mappedHeaders['content-length'] = body.length.toString();
  } else {
    delete mappedHeaders['content-length'];
  }

  const requestOptions: http.RequestOptions = {
    hostname: upstreamHost,
    port: upstreamPort,
    path: upstreamPath,
    method: req.method ?? 'GET',
    headers: mappedHeaders,
  };

  // Make the upstream request
  return new Promise<void>((resolve) => {
    const transport = isHttps ? https : http;

    const upstreamReq = transport.request(requestOptions, (upstreamRes) => {
      const firstByteTime = Date.now();
      const latency = firstByteTime - requestStart;
      const statusCode = upstreamRes.statusCode ?? 200;

      console.log(
        `[proxy] ${req.method} ${upstreamPath} -> ${provider.baseUrl} | status=${statusCode} | latency=${latency}ms`,
      );

      // Build response headers — forward ALL upstream headers verbatim.
      // This is critical for rate-limit headers (Retry-After, x-ratelimit-*) per ADR-016.
      // Upstream errors (4xx, 5xx) are passed through without modification.
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) {
          responseHeaders[key] = value;
        }
      }

      // Check if the upstream response is SSE (text/event-stream)
      const contentType = upstreamRes.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');

      if (isSSE) {
        // Delegate to streaming handler — sets its own headers (content-type, cache-control, connection)
        // and pipes chunks without buffering
        handleStreamingResponse(upstreamRes, res, statusCode);
        // Resolve when the pipe ends (client close or upstream end)
        res.on('finish', resolve);
        res.on('close', resolve);
        upstreamRes.on('error', resolve);
      } else {
        // Non-streaming: forward status + all headers + body verbatim
        res.writeHead(statusCode, responseHeaders);
        upstreamRes.pipe(res);

        upstreamRes.on('end', resolve);
        upstreamRes.on('error', (err) => {
          console.error('[proxy] upstream response error:', err.message);
          if (!res.writableEnded) {
            res.end();
          }
          resolve();
        });
      }
    });

    upstreamReq.on('error', (err) => {
      console.error(`[proxy] upstream connection error: ${err.message}`);
      sendErrorResponse(
        res,
        502,
        `Upstream connection failed: ${err.message}`,
        'upstream_connection_error',
      );
      resolve();
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      sendErrorResponse(res, 502, 'Upstream request timed out', 'upstream_timeout');
      resolve();
    });

    // Write request body to upstream
    if (body.length > 0) {
      upstreamReq.write(body);
    }
    upstreamReq.end();
  });
}
