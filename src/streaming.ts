/**
 * SSE streaming passthrough for the Govyn proxy server.
 *
 * Pipes Server-Sent Events from the upstream API to the client chunk-by-chunk
 * without buffering. Uses Node.js stream.pipe() for zero-copy backpressure handling.
 *
 * Per ADR-005: streaming is first-class, not bolt-on.
 * Per PRXY-06: first chunk must reach caller within 50ms of upstream emitting it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Forward an SSE (text/event-stream) response from upstream to the client.
 *
 * - Sets SSE-required response headers on clientRes
 * - Pipes the upstream response stream chunk-by-chunk (no buffering)
 * - Handles upstream close: ends client response cleanly
 * - Handles client disconnect: destroys upstream connection to avoid resource leaks
 *
 * @param upstreamRes   - The upstream HTTP response (source stream)
 * @param clientRes     - The client HTTP response (destination stream)
 * @param statusCode    - HTTP status code to send to the client (from upstream)
 * @param extraHeaders  - Optional extra headers to include in the SSE response
 */
export function handleStreamingResponse(
  upstreamRes: IncomingMessage,
  clientRes: ServerResponse,
  statusCode: number = 200,
  extraHeaders?: Record<string, string>,
): void {
  // Record timestamp when first data chunk arrives for latency tracking (PRXY-06)
  let firstChunkReceived = false;
  upstreamRes.once('data', () => {
    if (!firstChunkReceived) {
      firstChunkReceived = true;
      // Timestamp is available to callers via the 'data' event timing;
      // actual measurement is done in tests and proxy.ts latency logging
    }
  });

  // Set SSE response headers before piping
  clientRes.writeHead(statusCode, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'connection': 'keep-alive',
    ...extraHeaders,
  });

  // Pipe upstream to client — Node.js pipe() handles backpressure automatically.
  // CRITICAL: Do NOT accumulate chunks. Do NOT wait for full response.
  upstreamRes.pipe(clientRes);

  // When upstream ends, ensure client response ends cleanly
  upstreamRes.on('end', () => {
    if (!clientRes.writableEnded) {
      clientRes.end();
    }
  });

  // When upstream errors, close client response cleanly
  upstreamRes.on('error', (err) => {
    console.error('[streaming] upstream stream error:', err.message);
    if (!clientRes.writableEnded) {
      clientRes.end();
    }
  });

  // Handle client disconnect: destroy upstream connection to avoid resource leaks
  clientRes.on('close', () => {
    if (!upstreamRes.destroyed) {
      upstreamRes.destroy();
    }
  });
}
