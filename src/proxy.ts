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
 * - After each response completes, extracts tokens and records cost (non-blocking)
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteMatch, LogEntry } from './types.js';
import { mapOpenAIHeaders } from './providers/openai.js';
import { mapAnthropicHeaders } from './providers/anthropic.js';
import { mapCustomHeaders } from './providers/custom.js';
import { handleStreamingResponse } from './streaming.js';
import { extractTokenUsage, extractTokenUsageFromSSE } from './tokens.js';
import { calculateCost } from './pricing.js';
import type { PricingTable } from './pricing.js';
import { CostAggregator } from './cost-aggregator.js';
import type { LoopDetector } from './loop-detector.js';
import type { BudgetEnforcer } from './budget-enforcer.js';
import type { ActionLogger } from './action-logger.js';
import { govynEvents } from './events.js';
import type { DbWriter } from './db-writer.js';

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
 * Send a loop_detected 429 response in Govyn-native format.
 *
 * @param res - The outgoing client response
 * @param agentId - The agent that triggered loop detection
 * @param cooldownSeconds - How long the agent will be blocked
 */
function sendLoopDetectedError(
  res: ServerResponse,
  agentId: string,
  cooldownSeconds: number,
): void {
  const cooldownExpiresAt = new Date(Date.now() + cooldownSeconds * 1000).toISOString();
  const body = JSON.stringify({
    error: {
      type: 'loop_error',
      code: 'loop_detected',
      message: 'Agent blocked: repeated identical requests detected',
      details: {
        agent_id: agentId,
        cooldown_seconds: cooldownSeconds,
        cooldown_expires_at: cooldownExpiresAt,
      },
    },
  });
  res.writeHead(429, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
    'retry-after': cooldownSeconds.toString(),
  });
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
 * - After response completes, extracts token usage and records cost (non-blocking)
 * - If loopDetector provided: checks for repeated identical requests before forwarding
 *
 * @param req - The incoming client request
 * @param res - The outgoing client response
 * @param routeMatch - The matched route (provider, path, type)
 * @param agentId - The resolved agent identifier for this request
 * @param pricingTable - Pricing table for cost calculation
 * @param aggregator - Cost aggregator to record results
 * @param budgetWarning - Optional budget warning info to add as response header
 * @param loopDetector - Optional loop detector for detecting repeated identical requests
 * @param budgetEnforcer - Optional budget enforcer for triggering loop block on detection
 * @param actionLogger - Optional action logger for structured request logging
 */
export async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  routeMatch: RouteMatch,
  agentId: string,
  pricingTable: PricingTable,
  aggregator: CostAggregator,
  budgetWarning?: { percentUsed: number; currentSpend: number; limit: number; resetsAt: string },
  loopDetector?: LoopDetector,
  budgetEnforcer?: BudgetEnforcer,
  actionLogger?: ActionLogger,
  bufferedBody?: Buffer,
  requestedModel?: string,
  policyResult?: { allowed: boolean; evaluatedCount: number; matchedCount: number; evaluationTimeMs: number },
  dbWriter?: DbWriter,
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

  // Use pre-buffered body if provided (from server.ts policy evaluation flow),
  // otherwise read from the request stream directly (backward compat)
  let body: Buffer;
  if (bufferedBody !== undefined) {
    body = bufferedBody;
  } else {
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
    body = Buffer.concat(bodyChunks);
  }

  // Loop detection: check for repeated identical requests before forwarding
  if (loopDetector && budgetEnforcer) {
    const bodyHash = loopDetector.getRequestHash(body);
    loopDetector.recordRequest(agentId, routeMatch.upstreamPath, bodyHash);
    if (loopDetector.isLooping(agentId, routeMatch.upstreamPath, bodyHash)) {
      // Get agent-specific cooldown (or default 300s)
      const agentLoopConfig = loopDetector.getAgentConfig(agentId);
      const cooldownSeconds = agentLoopConfig.cooldownSeconds;
      budgetEnforcer.blockAgent(agentId, 'loop_detected', cooldownSeconds);
      console.warn(
        `[govyn] Loop detected: agent=${agentId} path=${routeMatch.upstreamPath} bodyHash=${bodyHash} cooldown=${cooldownSeconds}s`,
      );

      govynEvents.emit('event', {
        type: 'loop_detected',
        agentId,
        cooldownSeconds,
      });

      // Log the loop_detected event
      if (actionLogger) {
        const logEntry: LogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          agent_id: agentId,
          provider: routeMatch.providerType,
          target: routeMatch.upstreamPath,
          model: null,
          input_tokens: null,
          output_tokens: null,
          cost: null,
          priced: false,
          latency_ms: Date.now() - requestStart,
          status: 429,
          has_payload: false,
          payload_id: null,
          storage_region: 'auto',
        };
        actionLogger.log(logEntry);
      }

      sendLoopDetectedError(res, agentId, cooldownSeconds);
      return;
    }
  }

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

      // Build budget warning header value if applicable
      const budgetWarningHeaderValue = budgetWarning
        ? JSON.stringify({
            percent_used: budgetWarning.percentUsed,
            current_spend: budgetWarning.currentSpend,
            limit: budgetWarning.limit,
            resets_at: budgetWarning.resetsAt,
          })
        : undefined;

      // Check if the upstream response is SSE (text/event-stream)
      const contentType = upstreamRes.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');

      if (isSSE) {
        // Accumulate SSE chunks for token extraction (concurrent with piping to client)
        const sseChunks: string[] = [];
        upstreamRes.on('data', (chunk: Buffer) => {
          sseChunks.push(chunk.toString('utf8'));
        });

        // Build extra headers for SSE response (budget warning if applicable)
        const sseExtraHeaders: Record<string, string> | undefined = budgetWarningHeaderValue
          ? { 'x-govyn-budget-warning': budgetWarningHeaderValue }
          : undefined;

        // Delegate to streaming handler — sets its own headers (content-type, cache-control, connection)
        // and pipes chunks without buffering
        handleStreamingResponse(upstreamRes, res, statusCode, sseExtraHeaders);

        // After the stream ends, extract tokens and record cost
        // (happens after all data has been piped to client)
        upstreamRes.on('end', () => {
          const usage = extractTokenUsageFromSSE(sseChunks, routeMatch.providerType);
          let costResult: { inputCost: number; outputCost: number; totalCost: number; priced: boolean } | undefined;
          if (usage) {
            costResult = calculateCost(usage, pricingTable);
            const costRecord = {
              agentId,
              model: usage.model,
              provider: routeMatch.providerType,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              inputCost: costResult.inputCost,
              outputCost: costResult.outputCost,
              totalCost: costResult.totalCost,
              priced: costResult.priced,
              timestamp: Date.now(),
              requestedModel: requestedModel ?? undefined,
            };
            aggregator.recordCost(costRecord);

            // DB persistence (fire-and-forget, parallel with in-memory + JSONL)
            dbWriter?.writeCostRecord(costRecord).catch(() => {});

            const totalTokens = usage.inputTokens + usage.outputTokens;
            console.log(
              `[govyn] Cost: agent=${agentId} model=${usage.model} tokens=${totalTokens} cost=$${costResult.totalCost.toFixed(6)} priced=${costResult.priced}`,
            );
          }

          // Action logging (SSE path)
          if (actionLogger) {
            const mode = actionLogger.getMode(agentId);
            const logId = crypto.randomUUID();
            const payloadId = mode === 'full-payload' ? crypto.randomUUID() : null;

            const logEntry: LogEntry = {
              id: logId,
              timestamp: new Date().toISOString(),
              agent_id: agentId,
              provider: routeMatch.providerType,
              target: routeMatch.upstreamPath,
              model: usage?.model ?? null,
              input_tokens: usage?.inputTokens ?? null,
              output_tokens: usage?.outputTokens ?? null,
              cost: costResult?.totalCost ?? null,
              priced: costResult?.priced ?? false,
              latency_ms: Date.now() - requestStart,
              status: statusCode,
              has_payload: payloadId !== null,
              payload_id: payloadId,
              storage_region: 'auto',
              requested_model: requestedModel ?? null,
              actual_model: usage?.model ?? null,
              policy_result: policyResult ? {
                allowed: policyResult.allowed,
                evaluated_count: policyResult.evaluatedCount,
                matched_count: policyResult.matchedCount,
                evaluation_time_ms: policyResult.evaluationTimeMs,
              } : undefined,
            };

            actionLogger.log(logEntry);

            if (payloadId) {
              const sseResBody = Buffer.from(sseChunks.join(''), 'utf8');
              const maxSize = actionLogger.config.maxBodySize;
              const truncated = (body.length > maxSize) || (sseResBody.length > maxSize);
              actionLogger.storePayload(payloadId, body, sseResBody, truncated);
            }
          }
        });

        // Resolve when the pipe ends (client close or upstream end)
        res.on('finish', resolve);
        res.on('close', resolve);
        upstreamRes.on('error', resolve);
      } else {
        // Non-streaming: forward status + all headers + body verbatim
        // Add budget warning header if applicable
        if (budgetWarningHeaderValue) {
          responseHeaders['x-govyn-budget-warning'] = budgetWarningHeaderValue;
        }
        res.writeHead(statusCode, responseHeaders);
        upstreamRes.pipe(res);

        // Accumulate body for token extraction (concurrent with piping to client)
        const responseBodyChunks: Buffer[] = [];
        upstreamRes.on('data', (chunk: Buffer) => {
          responseBodyChunks.push(chunk);
        });

        upstreamRes.on('end', () => {
          // Extract tokens from the buffered response body
          const responseBody = Buffer.concat(responseBodyChunks);
          const responseBodyStr = responseBody.toString('utf8');
          const usage = extractTokenUsage(responseBodyStr, routeMatch.providerType);
          let costResult: { inputCost: number; outputCost: number; totalCost: number; priced: boolean } | undefined;
          if (usage) {
            costResult = calculateCost(usage, pricingTable);
            const costRecord = {
              agentId,
              model: usage.model,
              provider: routeMatch.providerType,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              inputCost: costResult.inputCost,
              outputCost: costResult.outputCost,
              totalCost: costResult.totalCost,
              priced: costResult.priced,
              timestamp: Date.now(),
              requestedModel: requestedModel ?? undefined,
            };
            aggregator.recordCost(costRecord);

            // DB persistence (fire-and-forget, parallel with in-memory + JSONL)
            dbWriter?.writeCostRecord(costRecord).catch(() => {});

            const totalTokens = usage.inputTokens + usage.outputTokens;
            console.log(
              `[govyn] Cost: agent=${agentId} model=${usage.model} tokens=${totalTokens} cost=$${costResult.totalCost.toFixed(6)} priced=${costResult.priced}`,
            );
          }

          // Action logging (non-SSE path)
          if (actionLogger) {
            const mode = actionLogger.getMode(agentId);
            const logId = crypto.randomUUID();
            const payloadId = mode === 'full-payload' ? crypto.randomUUID() : null;

            const logEntry: LogEntry = {
              id: logId,
              timestamp: new Date().toISOString(),
              agent_id: agentId,
              provider: routeMatch.providerType,
              target: routeMatch.upstreamPath,
              model: usage?.model ?? null,
              input_tokens: usage?.inputTokens ?? null,
              output_tokens: usage?.outputTokens ?? null,
              cost: costResult?.totalCost ?? null,
              priced: costResult?.priced ?? false,
              latency_ms: Date.now() - requestStart,
              status: statusCode,
              has_payload: payloadId !== null,
              payload_id: payloadId,
              storage_region: 'auto',
              requested_model: requestedModel ?? null,
              actual_model: usage?.model ?? null,
              policy_result: policyResult ? {
                allowed: policyResult.allowed,
                evaluated_count: policyResult.evaluatedCount,
                matched_count: policyResult.matchedCount,
                evaluation_time_ms: policyResult.evaluationTimeMs,
              } : undefined,
            };

            actionLogger.log(logEntry);

            if (payloadId) {
              const maxSize = actionLogger.config.maxBodySize;
              const truncated = (body.length > maxSize) || (responseBody.length > maxSize);
              actionLogger.storePayload(payloadId, body, responseBody, truncated);
            }
          }

          resolve();
        });

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

      // Log the connection error
      if (actionLogger) {
        const logEntry: LogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          agent_id: agentId,
          provider: routeMatch.providerType,
          target: routeMatch.upstreamPath,
          model: null,
          input_tokens: null,
          output_tokens: null,
          cost: null,
          priced: false,
          latency_ms: Date.now() - requestStart,
          status: 502,
          has_payload: false,
          payload_id: null,
          storage_region: 'auto',
        };
        actionLogger.log(logEntry);
      }

      sendErrorResponse(
        res,
        502,
        `Upstream connection failed: ${err.message}`,
        'upstream_connection_error',
      );
      resolve();
    });

    upstreamReq.on('timeout', () => {
      // Log the timeout error
      if (actionLogger) {
        const logEntry: LogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          agent_id: agentId,
          provider: routeMatch.providerType,
          target: routeMatch.upstreamPath,
          model: null,
          input_tokens: null,
          output_tokens: null,
          cost: null,
          priced: false,
          latency_ms: Date.now() - requestStart,
          status: 502,
          has_payload: false,
          payload_id: null,
          storage_region: 'auto',
        };
        actionLogger.log(logEntry);
      }

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
