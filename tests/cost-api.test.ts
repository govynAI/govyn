/**
 * Tests for the handleCostApi endpoint.
 *
 * Integration-style tests using a real minimal HTTP server with a pre-populated
 * CostAggregator. Tests cover filtering, method validation, and response shape.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { CostAggregator } from '../src/cost-aggregator.js';
import { handleCostApi } from '../src/cost-api.js';
import type { CostRecord } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeRecord(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    agentId: 'research-agent',
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    inputCost: 0.00025,
    outputCost: 0.0005,
    totalCost: 0.00075,
    priced: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

interface TestResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: unknown;
}

function makeRequest(
  server: http.Server,
  path: string,
  method: string = 'GET',
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method,
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
          json,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// -----------------------------------------------------------------------
// Test setup: minimal server that routes /api/costs to handleCostApi
// -----------------------------------------------------------------------

describe('handleCostApi', () => {
  let server: http.Server;
  let aggregator: CostAggregator;

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      aggregator = new CostAggregator();
      server = http.createServer((req, res) => {
        handleCostApi(req, res, aggregator);
      });
      server.listen(0, '127.0.0.1', resolve);
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    aggregator.clear();
  });

  // -----------------------------------------------------------------------
  // Basic GET
  // -----------------------------------------------------------------------

  it('GET /api/costs returns 200 with all cost data', async () => {
    aggregator.recordCost(makeRecord({ agentId: 'research-agent', totalCost: 0.001 }));
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot', totalCost: 0.002 }));

    const res = await makeRequest(server, '/api/costs');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    expect(data['agents']).toBeDefined();
    expect(Array.isArray(data['agents'])).toBe(true);
    expect((data['agents'] as unknown[]).length).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Agent filter
  // -----------------------------------------------------------------------

  it('GET /api/costs?agent=research-agent returns filtered data for that agent only', async () => {
    aggregator.recordCost(makeRecord({ agentId: 'research-agent', totalCost: 0.001 }));
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot', totalCost: 0.002 }));

    const res = await makeRequest(server, '/api/costs?agent=research-agent');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string }>;
    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('research-agent');
  });

  // -----------------------------------------------------------------------
  // Period filter: today
  // -----------------------------------------------------------------------

  it('GET /api/costs?period=today returns data filtered to current day', async () => {
    // Add a record from yesterday
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    aggregator.recordCost(makeRecord({ timestamp: yesterday, agentId: 'old-agent' }));

    // Add a record from today
    aggregator.recordCost(makeRecord({ agentId: 'today-agent' }));

    const res = await makeRequest(server, '/api/costs?period=today');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    expect(data['period']).toBe('day');

    const agents = data['agents'] as Array<{ agentId: string }>;
    // Only today's record
    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('today-agent');
  });

  // -----------------------------------------------------------------------
  // Combined agent + period filter
  // -----------------------------------------------------------------------

  it('GET /api/costs?agent=sales-bot&period=month returns combined filter', async () => {
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot' }));
    aggregator.recordCost(makeRecord({ agentId: 'research-agent' }));
    const lastMonth = Date.now() - 35 * 24 * 60 * 60 * 1000;
    aggregator.recordCost(makeRecord({ agentId: 'sales-bot', timestamp: lastMonth }));

    const res = await makeRequest(server, '/api/costs?agent=sales-bot&period=month');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    const agents = data['agents'] as Array<{ agentId: string; requestCount: number }>;
    // sales-bot: 1 in this month (the one from lastMonth is excluded)
    expect(agents.length).toBe(1);
    expect(agents[0]!.agentId).toBe('sales-bot');
    expect(agents[0]!.requestCount).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 405 Method Not Allowed
  // -----------------------------------------------------------------------

  it('POST /api/costs returns 405 Method Not Allowed', async () => {
    const res = await makeRequest(server, '/api/costs', 'POST');
    expect(res.statusCode).toBe(405);

    const data = res.json as Record<string, unknown>;
    expect(data['error']).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Content-Type header
  // -----------------------------------------------------------------------

  it('response has correct Content-Type: application/json', async () => {
    const res = await makeRequest(server, '/api/costs');
    expect(res.headers['content-type']).toContain('application/json');
  });

  // -----------------------------------------------------------------------
  // Response shape
  // -----------------------------------------------------------------------

  it('response includes totals, agents array, models object, unpriced_models array', async () => {
    aggregator.recordCost(makeRecord());

    const res = await makeRequest(server, '/api/costs');
    const data = res.json as Record<string, unknown>;

    expect(Array.isArray(data['agents'])).toBe(true);
    expect(typeof data['models']).toBe('object');
    expect(Array.isArray(data['unpriced_models'])).toBe(true);
    expect(typeof data['totals']).toBe('object');
    expect(data['generated_at']).toBeDefined();
    expect(data['period']).toBeDefined();

    const totals = data['totals'] as Record<string, unknown>;
    expect(typeof totals['cost']).toBe('number');
    expect(typeof totals['requests']).toBe('number');
    expect(typeof totals['input_tokens']).toBe('number');
    expect(typeof totals['output_tokens']).toBe('number');
  });

  // -----------------------------------------------------------------------
  // Empty aggregator
  // -----------------------------------------------------------------------

  it('with no records, returns empty agents array and zero totals', async () => {
    const res = await makeRequest(server, '/api/costs');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    const agents = data['agents'] as unknown[];
    expect(agents.length).toBe(0);

    const totals = data['totals'] as Record<string, number>;
    expect(totals['cost']).toBe(0);
    expect(totals['requests']).toBe(0);
    expect(totals['input_tokens']).toBe(0);
    expect(totals['output_tokens']).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Unpriced models
  // -----------------------------------------------------------------------

  it('unpriced_models includes models with priced=false', async () => {
    aggregator.recordCost(makeRecord({ model: 'unknown-model-xyz', priced: false, totalCost: 0 }));
    aggregator.recordCost(makeRecord({ model: 'gpt-4o', priced: true }));

    const res = await makeRequest(server, '/api/costs');
    const data = res.json as Record<string, unknown>;
    const unpriced = data['unpriced_models'] as string[];

    expect(unpriced).toContain('unknown-model-xyz');
    expect(unpriced).not.toContain('gpt-4o');
  });

  it('GET /api/costs/timeseries returns bucketed spend history with gap filling', async () => {
    const now = Date.now();
    aggregator.recordCost(makeRecord({
      agentId: 'research-agent',
      totalCost: 1.25,
      timestamp: now - 2 * 60 * 60 * 1000,
    }));
    aggregator.recordCost(makeRecord({
      agentId: 'sales-bot',
      totalCost: 0.75,
      timestamp: now - 60 * 60 * 1000,
    }));

    const res = await makeRequest(server, '/api/costs/timeseries?period=today');
    expect(res.statusCode).toBe(200);

    const data = res.json as Record<string, unknown>;
    expect(data['bucket']).toBe('hour');
    expect(Array.isArray(data['points'])).toBe(true);

    const points = data['points'] as Array<{ total: number; agents: Record<string, number> }>;
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.some((point) => point.total === 0)).toBe(true);
    expect(points.some((point) => point.agents['research-agent'] === 1.25)).toBe(true);
    expect(points.some((point) => point.agents['sales-bot'] === 0.75)).toBe(true);
  });

  it('GET /api/costs/unknown returns 404', async () => {
    const res = await makeRequest(server, '/api/costs/unknown');
    expect(res.statusCode).toBe(404);
    expect(res.json).toMatchObject({
      error: {
        code: 'not_found',
      },
    });
  });
});
