/**
 * HTTP handler for the GET /api/costs endpoint.
 *
 * Returns per-agent, per-model, and per-period cost summaries from the
 * in-memory CostAggregator. Supports query parameters for filtering:
 *   ?agent=<agentId>   — filter to a specific agent
 *   ?period=<period>   — 'hour', 'day'/'today', 'week', 'month', 'all' (default: 'all')
 *
 * Also serves GET /api/costs/timeseries for chart-ready bucketed spend history.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { TimePeriod } from './types.js';
import { CostAggregator } from './cost-aggregator.js';

/**
 * Handle GET /api/costs requests.
 *
 * - Returns 405 for non-GET methods.
 * - Returns 200 JSON with cost data for GET.
 *
 * Response shape:
 * {
 *   "period": "all",
 *   "generated_at": "2026-02-24T12:00:00Z",
 *   "agents": [ CostSummary... ],
 *   "models": { model: { cost, requests, inputTokens, outputTokens }, ... },
 *   "unpriced_models": ["unknown-model-xyz"],
 *   "totals": { cost, requests, input_tokens, output_tokens }
 * }
 */
export function handleCostApi(
  req: IncomingMessage,
  res: ServerResponse,
  aggregator: CostAggregator,
): void {
  // Only allow GET
  if (req.method !== 'GET') {
    const body = JSON.stringify({ error: { message: 'Method not allowed', code: 'method_not_allowed' } });
    res.writeHead(405, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
      'allow': 'GET',
    });
    res.end(body);
    return;
  }

  // Parse query parameters from the request URL
  // Use a dummy base to parse relative URLs
  const baseUrl = `http://localhost`;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(req.url ?? '/api/costs', baseUrl);
  } catch {
    parsedUrl = new URL('/api/costs', baseUrl);
  }

  const agentParam = parsedUrl.searchParams.get('agent') ?? undefined;
  const periodParam = parsedUrl.searchParams.get('period') ?? 'all';

  // Map 'today' to 'day' for convenience
  let period: TimePeriod;
  switch (periodParam) {
    case 'today':
      period = 'day';
      break;
    case 'hour':
    case 'day':
    case 'week':
    case 'month':
    case 'all':
      period = periodParam;
      break;
    default:
      period = 'all';
      break;
  }

  if (parsedUrl.pathname === '/api/costs/timeseries') {
    const timeseries = aggregator.getTimeSeries({ agentId: agentParam, period });
    const body = JSON.stringify({
      period,
      bucket: timeseries.bucket,
      generated_at: new Date().toISOString(),
      points: timeseries.points,
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    });
    res.end(body);
    return;
  }

  if (parsedUrl.pathname !== '/api/costs') {
    const body = JSON.stringify({ error: { message: 'Not found', code: 'not_found' } });
    res.writeHead(404, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    });
    res.end(body);
    return;
  }

  // Query the aggregator
  const agents = aggregator.getSummary({ agentId: agentParam, period });
  const models = aggregator.getModelSummary({ period });
  const unpricedModels = aggregator.getUnpricedModels();

  // Compute totals by summing across all agent summaries
  let totalCost = 0;
  let totalRequests = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const summary of agents) {
    totalCost += summary.totalCost;
    totalRequests += summary.requestCount;
    totalInputTokens += summary.totalInputTokens;
    totalOutputTokens += summary.totalOutputTokens;
  }

  const responseData = {
    period,
    generated_at: new Date().toISOString(),
    agents,
    models,
    unpriced_models: unpricedModels,
    totals: {
      cost: totalCost,
      requests: totalRequests,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    },
  };

  const body = JSON.stringify(responseData);
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}
