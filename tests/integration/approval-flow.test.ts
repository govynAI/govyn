/**
 * Integration tests for the approval flow.
 *
 * Tests the full HTTP pipeline: require_approval policy -> HTTP 202 ->
 * polling -> approve/deny -> re-send with approval token.
 *
 * Uses a MockApprovalManager with in-memory Maps for testing the HTTP-level
 * flow without requiring a real PostgreSQL instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { startServer } from '../../src/server.js';
import { CostAggregator } from '../../src/cost-aggregator.js';
import { PolicyEngine } from '../../src/policy-engine.js';
import type { ApprovalManager } from '../../src/approval.js';
import type { DbWriter } from '../../src/db-writer.js';
import type { ProxyConfig } from '../../src/types.js';
import type { RequireApprovalPolicy } from '../../src/policy-types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function waitForListen(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) { resolve(); return; }
    server.once('listening', resolve);
  });
}

function httpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string; json: unknown }> {
  return new Promise((resolve, reject) => {
    const { port, path, method = 'GET', headers = {}, body = '' } = options;
    const reqHeaders: Record<string, string> = { ...headers };
    if (body) {
      reqHeaders['content-length'] = Buffer.byteLength(body).toString();
      reqHeaders['content-type'] = reqHeaders['content-type'] ?? 'application/json';
    } else {
      reqHeaders['content-length'] = '0';
    }
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: reqHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bodyStr = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try { json = JSON.parse(bodyStr); } catch { json = null; }
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: bodyStr, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Create a mock upstream that returns OpenAI-format responses.
 */
function createMockUpstream(): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const response = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        };
        const body = JSON.stringify(response);
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() });
        res.end(body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

// -----------------------------------------------------------------------
// In-memory Mock ApprovalManager
// -----------------------------------------------------------------------

interface MockApprovalRecord {
  id: string;
  agentId: string;
  provider: string;
  model?: string;
  targetPath: string;
  policyName: string;
  requestHash: string;
  status: 'pending' | 'approved' | 'denied' | 'denied_timeout';
  approvalToken?: string;
  tokenUsed: boolean;
  decidedAt?: string;
  expiresAt: string;
  timeoutSeconds: number;
}

class MockApprovalManager {
  records = new Map<string, MockApprovalRecord>();
  tokenIndex = new Map<string, string>(); // token -> recordId

  async createApprovalRequest(params: {
    agentId: string;
    provider: string;
    model?: string;
    targetPath: string;
    policyName: string;
    policyRule?: string;
    estimatedCost?: number;
    requestSummary: string;
    requestHash: string;
    requestPayload?: unknown;
    timeoutSeconds: number;
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }> {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + params.timeoutSeconds * 1000).toISOString();
    this.records.set(id, {
      id,
      agentId: params.agentId,
      provider: params.provider,
      model: params.model,
      targetPath: params.targetPath,
      policyName: params.policyName,
      requestHash: params.requestHash,
      status: 'pending',
      tokenUsed: false,
      expiresAt,
      timeoutSeconds: params.timeoutSeconds,
    });
    return { id, pollingUrl: `/api/approvals/${id}`, expiresAt };
  }

  async getApprovalStatus(id: string): Promise<{
    id: string;
    status: 'pending' | 'approved' | 'denied' | 'denied_timeout';
    approvalToken?: string;
    decidedAt?: string;
    expiresAt: string;
  } | null> {
    const record = this.records.get(id);
    if (!record) return null;
    return {
      id: record.id,
      status: record.status,
      approvalToken: record.status === 'approved' ? record.approvalToken : undefined,
      decidedAt: record.decidedAt,
      expiresAt: record.expiresAt,
    };
  }

  async validateAndConsumeToken(
    token: string,
    expected: { agentId: string; targetPath: string; requestHash: string },
  ): Promise<{ policyName: string } | null> {
    const recordId = this.tokenIndex.get(token);
    if (!recordId) return null;
    const record = this.records.get(recordId);
    if (!record || record.status !== 'approved' || record.tokenUsed) return null;
    if (
      record.agentId !== expected.agentId ||
      record.targetPath !== expected.targetPath ||
      record.requestHash !== expected.requestHash
    ) {
      return null;
    }
    record.tokenUsed = true;
    return {
      policyName: record.policyName,
    };
  }

  async approveRequest(id: string, _decidedBy: string, _notes?: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return false;
    const token = crypto.randomUUID();
    record.status = 'approved';
    record.approvalToken = token;
    record.decidedAt = new Date().toISOString();
    this.tokenIndex.set(token, id);
    return true;
  }

  async denyRequest(id: string, _decidedBy: string, _notes?: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return false;
    record.status = 'denied';
    record.decidedAt = new Date().toISOString();
    return true;
  }

  // Helper: expire a specific record for testing
  expireRecord(id: string): void {
    const record = this.records.get(id);
    if (record && record.status === 'pending') {
      record.status = 'denied_timeout';
      record.decidedAt = new Date().toISOString();
    }
  }
}

// -----------------------------------------------------------------------
// Mock DbWriter (only isAvailable is used in the approval flow)
// -----------------------------------------------------------------------

class MockDbWriter {
  private available = true;

  setAvailable(val: boolean): void {
    this.available = val;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async writePolicyEvaluation(): Promise<void> {}
  async writeCostRecord(): Promise<void> {}
  async writeApprovalEvent(): Promise<void> {}
}

// -----------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------

describe('approval flow integration', () => {
  let upstream: Awaited<ReturnType<typeof createMockUpstream>>;

  beforeAll(async () => {
    upstream = await createMockUpstream();
  });

  afterAll(async () => {
    await upstream.close();
  });

  function createTestSetup(options?: { dbAvailable?: boolean; noApprovalPolicy?: boolean }) {
    const aggregator = new CostAggregator();
    const policyEngine = new PolicyEngine();

    // Load a require_approval policy matching gpt-4o model
    if (!options?.noApprovalPolicy) {
      const approvalPolicy: RequireApprovalPolicy = {
        name: 'approve-gpt4o',
        type: 'require_approval',
        scope: { level: 'global' },
        enabled: true,
        match: { model: 'gpt-4o' },
        timeout_seconds: 1800,
        store_payload: false,
        message: 'GPT-4o requests require human approval',
      };
      policyEngine.loadFromPolicies([approvalPolicy]);
    }

    const mockApprovalManager = new MockApprovalManager();
    const mockDbWriter = new MockDbWriter();
    mockDbWriter.setAvailable(options?.dbAvailable !== false);

    const config: ProxyConfig = {
      port: 0,
      host: '127.0.0.1',
      providers: new Map([['openai', {
        name: 'openai',
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        apiKeyEnv: null,
        providerType: 'openai' as const,
      }]]),
      agents: new Map(),
      pricing: new Map(),
      budgets: new Map(),
    };

    return { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config };
  }

  it('Test 1: HTTP 202 on require_approval policy match', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });

      expect(res.statusCode).toBe(202);
      const body = res.json as Record<string, unknown>;
      expect(body.status).toBe('approval_required');
      expect(body.approval_id).toBeDefined();
      expect(body.polling_url).toBeDefined();
      expect(body.expires_at).toBeDefined();
      expect(res.headers['location']).toBeDefined();
    } finally {
      server.close();
    }
  });

  it('Test 2: Polling returns pending status', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create an approval request
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      expect(createRes.statusCode).toBe(202);
      const createBody = createRes.json as { polling_url: string };

      // Poll the approval status
      const pollRes = await httpRequest({
        port,
        path: createBody.polling_url,
        method: 'GET',
      });

      expect(pollRes.statusCode).toBe(200);
      const pollBody = pollRes.json as Record<string, unknown>;
      expect(pollBody.status).toBe('pending');
      expect(pollBody.approval_token).toBeNull();
    } finally {
      server.close();
    }
  });

  it('Test 3: After approval, polling returns token', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create approval request
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      // Approve the request
      const approveRes = await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/approve`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin@test.com', notes: 'Approved for testing' }),
      });
      expect(approveRes.statusCode).toBe(200);

      // Poll again - should have token
      const pollRes = await httpRequest({
        port,
        path: createBody.polling_url,
        method: 'GET',
      });
      const pollBody = pollRes.json as Record<string, unknown>;
      expect(pollBody.status).toBe('approved');
      expect(pollBody.approval_token).toBeDefined();
      expect(typeof pollBody.approval_token).toBe('string');
    } finally {
      server.close();
    }
  });

  it('Test 4: Re-send with approval token succeeds', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create approval request
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      // Approve the request
      await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/approve`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin@test.com' }),
      });

      // Poll to get token
      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as { approval_token: string };

      // Re-send with approval token
      const resendRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-govyn-agent': 'test-agent',
          'content-type': 'application/json',
          'x-govyn-approval': pollBody.approval_token,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });

      // Should be forwarded to upstream (200), not 202 again
      expect(resendRes.statusCode).toBe(200);
      const resendBody = resendRes.json as Record<string, unknown>;
      expect(resendBody).toHaveProperty('choices');
    } finally {
      server.close();
    }
  });

  it('Test 5: Approval token is single-use', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create -> approve -> get token
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/approve`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin' }),
      });

      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as { approval_token: string };

      // First use: succeeds
      const firstUse = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-govyn-agent': 'test-agent',
          'content-type': 'application/json',
          'x-govyn-approval': pollBody.approval_token,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      expect(firstUse.statusCode).toBe(200);

      // Second use: rejected (single-use)
      const secondUse = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-govyn-agent': 'test-agent',
          'content-type': 'application/json',
          'x-govyn-approval': pollBody.approval_token,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      expect(secondUse.statusCode).toBe(403);
      const errorBody = secondUse.json as { error: { code: string } };
      expect(errorBody.error.code).toBe('invalid_approval_token');
    } finally {
      server.close();
    }
  });

  it('Test 5b: Approval token is bound to the approved request body', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/approve`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin' }),
      });

      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as { approval_token: string };

      const modifiedRequest = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-govyn-agent': 'test-agent',
          'content-type': 'application/json',
          'x-govyn-approval': pollBody.approval_token,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Different prompt' }] }),
      });

      expect(modifiedRequest.statusCode).toBe(403);
      const errorBody = modifiedRequest.json as { error: { code: string } };
      expect(errorBody.error.code).toBe('invalid_approval_token');
    } finally {
      server.close();
    }
  });

  it('Test 5c: Approval token is bound to the approved agent identity', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/approve`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin' }),
      });

      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as { approval_token: string };

      const impersonatedRequest = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-govyn-agent': 'other-agent',
          'content-type': 'application/json',
          'x-govyn-approval': pollBody.approval_token,
        },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });

      expect(impersonatedRequest.statusCode).toBe(403);
      const errorBody = impersonatedRequest.json as { error: { code: string } };
      expect(errorBody.error.code).toBe('invalid_approval_token');
    } finally {
      server.close();
    }
  });

  it('Test 6: Denied request returns denied status', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create approval request
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      // Deny the request
      const denyRes = await httpRequest({
        port,
        path: `/api/approvals/${createBody.approval_id}/deny`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decided_by: 'admin@test.com', notes: 'Too risky' }),
      });
      expect(denyRes.statusCode).toBe(200);

      // Poll: should show denied, no token
      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as Record<string, unknown>;
      expect(pollBody.status).toBe('denied');
      expect(pollBody.approval_token).toBeNull();
    } finally {
      server.close();
    }
  });

  it('Test 7: Expired request returns denied_timeout', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Create approval request
      const createRes = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });
      const createBody = createRes.json as { approval_id: string; polling_url: string };

      // Simulate timeout expiry (directly modify mock state)
      mockApprovalManager.expireRecord(createBody.approval_id);

      // Poll: should show denied_timeout
      const pollRes = await httpRequest({ port, path: createBody.polling_url, method: 'GET' });
      const pollBody = pollRes.json as Record<string, unknown>;
      expect(pollBody.status).toBe('denied_timeout');
      expect(pollBody.approval_token).toBeNull();
    } finally {
      server.close();
    }
  });

  it('Test 8: DB unavailable rejects approval-flagged request', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup({ dbAvailable: false });

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      const res = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Hello' }] }),
      });

      expect(res.statusCode).toBe(503);
      const body = res.json as { error: { code: string } };
      expect(body.error.code).toBe('approval_db_unavailable');
    } finally {
      server.close();
    }
  });

  it('Test 9: Non-matching require_approval policy allows request through', async () => {
    const { aggregator, policyEngine, mockApprovalManager, mockDbWriter, config } = createTestSetup();

    const server = startServer(
      config, aggregator, undefined, undefined, undefined,
      policyEngine, mockDbWriter as unknown as DbWriter, mockApprovalManager as unknown as ApprovalManager,
    );
    await waitForListen(server);
    const port = (server.address() as { port: number }).port;

    try {
      // Send a request with a model that does NOT match the approval policy (gpt-3.5-turbo)
      const res = await httpRequest({
        port,
        path: '/v1/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'x-govyn-agent': 'test-agent', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'Hello' }] }),
      });

      // Should forward to upstream (200), not 202
      expect(res.statusCode).toBe(200);
      const body = res.json as Record<string, unknown>;
      expect(body).toHaveProperty('choices');
    } finally {
      server.close();
    }
  });
});
