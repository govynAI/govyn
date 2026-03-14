/**
 * Tests for the ApprovalManager (src/approval.ts).
 * Uses mocked SQL to test approval queue operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalManager, generateRequestSummary } from '../src/approval.js';

/**
 * Create a mock postgres.Sql tagged template function.
 * Returns configurable results for different query patterns.
 */
function createMockSql(options: {
  insertResult?: Record<string, unknown>[];
  selectResult?: Record<string, unknown>[];
  updateResult?: { count: number; [key: string]: unknown }[];
} = {}) {
  const mockFn = vi.fn().mockImplementation((..._args: unknown[]) => {
    // Default behavior: return insertResult or empty
    const result = options.insertResult ?? options.selectResult ?? options.updateResult ?? [];
    // If updateResult, attach count property
    if (options.updateResult) {
      const r = [...options.updateResult];
      (r as any).count = options.updateResult.length > 0 ? (options.updateResult[0] as any).count ?? options.updateResult.length : 0;
      return Promise.resolve(r);
    }
    return Promise.resolve(result);
  });

  return mockFn as any;
}

describe('ApprovalManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createApprovalRequest', () => {
    it('inserts a new approval request and returns id, pollingUrl, expiresAt', async () => {
      const fakeId = '550e8400-e29b-41d4-a716-446655440000';
      const fakeExpiresAt = new Date('2026-03-01T00:00:00.000Z');
      const mockSql = createMockSql({
        insertResult: [{ id: fakeId, expires_at: fakeExpiresAt }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.createApprovalRequest({
        agentId: 'test-agent',
        provider: 'openai',
        model: 'gpt-4o',
        targetPath: '/v1/chat/completions',
        policyName: 'sensitive-ops',
        requestSummary: 'Test request summary',
        requestHash: 'hash-1',
        timeoutSeconds: 1800,
      });

      expect(result.id).toBe(fakeId);
      expect(result.pollingUrl).toBe(`/api/approvals/${fakeId}`);
      expect(result.expiresAt).toBe('2026-03-01T00:00:00.000Z');
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it('passes null for optional fields when not provided', async () => {
      const fakeId = 'abc-123';
      const fakeExpiresAt = new Date('2026-03-01T00:00:00.000Z');
      const mockSql = createMockSql({
        insertResult: [{ id: fakeId, expires_at: fakeExpiresAt }],
      });
      const manager = new ApprovalManager(mockSql);

      await manager.createApprovalRequest({
        agentId: 'agent-1',
        provider: 'anthropic',
        targetPath: '/v1/messages',
        policyName: 'review-all',
        requestSummary: 'Summary',
        requestHash: 'hash-2',
        timeoutSeconds: 600,
      });

      expect(mockSql).toHaveBeenCalledTimes(1);
      const args = mockSql.mock.calls[0];
      // Verify null is passed for model (absent)
      expect(args).toContainEqual(null);
    });
  });

  describe('getApprovalStatus', () => {
    it('returns correct fields for pending status', async () => {
      const mockSql = createMockSql({
        selectResult: [{
          id: 'req-1',
          status: 'pending',
          approval_token: null,
          decided_at: null,
          expires_at: new Date('2026-03-01T00:30:00.000Z'),
        }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.getApprovalStatus('req-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('req-1');
      expect(result!.status).toBe('pending');
      expect(result!.approvalToken).toBeUndefined();
      expect(result!.decidedAt).toBeUndefined();
      expect(result!.expiresAt).toBe('2026-03-01T00:30:00.000Z');
    });

    it('returns approval token for approved status', async () => {
      const mockSql = createMockSql({
        selectResult: [{
          id: 'req-2',
          status: 'approved',
          approval_token: 'token-uuid-123',
          decided_at: new Date('2026-03-01T00:15:00.000Z'),
          expires_at: new Date('2026-03-01T00:30:00.000Z'),
        }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.getApprovalStatus('req-2');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('approved');
      expect(result!.approvalToken).toBe('token-uuid-123');
      expect(result!.decidedAt).toBe('2026-03-01T00:15:00.000Z');
    });

    it('returns no token for denied status', async () => {
      const mockSql = createMockSql({
        selectResult: [{
          id: 'req-3',
          status: 'denied',
          approval_token: null,
          decided_at: new Date('2026-03-01T00:10:00.000Z'),
          expires_at: new Date('2026-03-01T00:30:00.000Z'),
        }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.getApprovalStatus('req-3');

      expect(result!.status).toBe('denied');
      expect(result!.approvalToken).toBeUndefined();
    });

    it('returns no token for denied_timeout status', async () => {
      const mockSql = createMockSql({
        selectResult: [{
          id: 'req-4',
          status: 'denied_timeout',
          approval_token: null,
          decided_at: new Date('2026-03-01T00:30:00.000Z'),
          expires_at: new Date('2026-03-01T00:30:00.000Z'),
        }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.getApprovalStatus('req-4');

      expect(result!.status).toBe('denied_timeout');
      expect(result!.approvalToken).toBeUndefined();
    });

    it('returns null for non-existent approval request', async () => {
      const mockSql = createMockSql({ selectResult: [] });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.getApprovalStatus('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('validateAndConsumeToken', () => {
    it('atomically marks token as used when the request context matches', async () => {
      const mockSql = createMockSql({
        updateResult: [{
          count: 1,
          policy_name: 'sensitive-ops',
        }],
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.validateAndConsumeToken('valid-token', {
        agentId: 'test-agent',
        targetPath: '/v1/chat/completions',
        requestHash: 'request-hash',
      });

      expect(result).not.toBeNull();
      expect(result!.policyName).toBe('sensitive-ops');
    });

    it('returns null for already-used token (single-use guarantee)', async () => {
      const mockSql = createMockSql({ updateResult: [] });
      // Simulate empty result (token_used = true already)
      (mockSql as any).mockImplementation(() => {
        const r: any[] = [];
        r.count = 0;
        return Promise.resolve(r);
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.validateAndConsumeToken('used-token', {
        agentId: 'test-agent',
        targetPath: '/v1/chat/completions',
        requestHash: 'request-hash',
      });

      expect(result).toBeNull();
    });

    it('returns null for non-existent token', async () => {
      const mockSql = createMockSql({ updateResult: [] });
      (mockSql as any).mockImplementation(() => {
        const r: any[] = [];
        r.count = 0;
        return Promise.resolve(r);
      });
      const manager = new ApprovalManager(mockSql);

      const result = await manager.validateAndConsumeToken('fake-token', {
        agentId: 'test-agent',
        targetPath: '/v1/chat/completions',
        requestHash: 'request-hash',
      });

      expect(result).toBeNull();
    });
  });

  describe('approveRequest', () => {
    it('generates UUID token and sets status to approved', async () => {
      const mockSql = vi.fn().mockImplementation(() => {
        const r: any[] = [];
        r.count = 1;
        return Promise.resolve(r);
      }) as any;
      const manager = new ApprovalManager(mockSql);

      const result = await manager.approveRequest('req-1', 'admin@example.com', 'Approved for testing');

      expect(result).toBe(true);
      expect(mockSql).toHaveBeenCalledTimes(1);
      // Verify that a UUID-like approval token was passed
      const args = mockSql.mock.calls[0];
      const hasUUID = args.some((arg: unknown) =>
        typeof arg === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg),
      );
      expect(hasUUID).toBe(true);
    });

    it('returns false if request is not pending', async () => {
      const mockSql = vi.fn().mockImplementation(() => {
        const r: any[] = [];
        r.count = 0;
        return Promise.resolve(r);
      }) as any;
      const manager = new ApprovalManager(mockSql);

      const result = await manager.approveRequest('req-already-denied', 'admin');

      expect(result).toBe(false);
    });
  });

  describe('denyRequest', () => {
    it('sets status to denied without generating token', async () => {
      const mockSql = vi.fn().mockImplementation(() => {
        const r: any[] = [];
        r.count = 1;
        return Promise.resolve(r);
      }) as any;
      const manager = new ApprovalManager(mockSql);

      const result = await manager.denyRequest('req-1', 'admin@example.com', 'Too risky');

      expect(result).toBe(true);
      expect(mockSql).toHaveBeenCalledTimes(1);
      // Verify no UUID token was passed (deny does not generate one)
      const args = mockSql.mock.calls[0];
      const hasUUID = args.some((arg: unknown) =>
        typeof arg === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(arg),
      );
      expect(hasUUID).toBe(false);
    });

    it('returns false if request is not pending', async () => {
      const mockSql = vi.fn().mockImplementation(() => {
        const r: any[] = [];
        r.count = 0;
        return Promise.resolve(r);
      }) as any;
      const manager = new ApprovalManager(mockSql);

      const result = await manager.denyRequest('req-already-approved', 'admin');

      expect(result).toBe(false);
    });
  });
});

describe('generateRequestSummary', () => {
  it('extracts last user message from OpenAI-format body', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Tell me about quantum computing' },
      ],
    });
    expect(generateRequestSummary(body)).toBe('Tell me about quantum computing');
  });

  it('truncates long content at 500 chars with ellipsis', () => {
    const longContent = 'A'.repeat(600);
    const body = JSON.stringify({
      messages: [{ role: 'user', content: longContent }],
    });
    const summary = generateRequestSummary(body, 500);
    expect(summary.length).toBe(503); // 500 + "..."
    expect(summary.endsWith('...')).toBe(true);
  });

  it('falls back to stringified body when no user message found', () => {
    const body = JSON.stringify({ data: 'some input' });
    expect(generateRequestSummary(body)).toBe('{"data":"some input"}');
  });

  it('handles non-JSON body by truncating raw text', () => {
    const raw = 'Hello, this is not JSON';
    expect(generateRequestSummary(raw)).toBe('Hello, this is not JSON');
  });

  it('returns "(empty request)" for undefined body', () => {
    expect(generateRequestSummary(undefined)).toBe('(empty request)');
  });

  it('returns "(empty request)" for empty string body', () => {
    expect(generateRequestSummary('')).toBe('(empty request)');
  });
});
