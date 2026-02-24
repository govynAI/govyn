/**
 * Tests for GET /health endpoint (src/health.ts via src/server.ts).
 *
 * Starts a real local HTTP server and makes actual HTTP requests to verify
 * the health check response — consistent with the real HTTP server pair pattern
 * established in 01-01.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../src/server.js';
import type { ProxyConfig } from '../src/types.js';

/** Make an HTTP GET request and return status + parsed JSON body. */
function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve({ status: res.statusCode ?? 0, body });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: null });
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Minimal config for the health test server — no real providers needed
const TEST_PORT = 14101;
const testConfig: ProxyConfig = {
  port: TEST_PORT,
  host: '127.0.0.1',
  providers: new Map(),
};

let server: http.Server;

beforeAll(async () => {
  server = startServer(testConfig);
  // Wait until the server is actually listening
  await new Promise<void>((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
});

afterAll(() => {
  server.close();
});

describe('GET /health', () => {
  it('returns HTTP 200', async () => {
    const { status } = await httpGet(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(status).toBe(200);
  });

  it('returns JSON with status: "ok"', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('returns JSON with a version string', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(body).toMatchObject({ version: expect.any(String) });
    const b = body as { version: string };
    expect(b.version.length).toBeGreaterThan(0);
  });

  it('returns JSON with uptime_seconds as a non-negative number', async () => {
    const { body } = await httpGet(`http://127.0.0.1:${TEST_PORT}/health`);
    expect(body).toMatchObject({ uptime_seconds: expect.any(Number) });
    const b = body as { uptime_seconds: number };
    expect(b.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  it('returns Content-Type: application/json', async () => {
    const contentType = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${TEST_PORT}/health`, (res) => {
        res.resume();
        resolve(res.headers['content-type'] ?? '');
      });
      req.on('error', reject);
    });
    expect(contentType).toContain('application/json');
  });
});
