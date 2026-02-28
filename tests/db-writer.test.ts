/**
 * Tests for the async DB writer (src/db-writer.ts).
 * Uses mocked SQL to test write behavior and fail-open/fail-closed modes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbWriter } from '../src/db-writer.js';
import type { CostRecord } from '../src/types.js';

/**
 * Create a mock postgres.Sql tagged template function.
 * Returns a callable function that also has an `unsafe` method.
 */
function createMockSql(behavior: 'success' | 'error' = 'success') {
  const error = new Error('DB connection failed');

  const mockFn = vi.fn().mockImplementation(() => {
    if (behavior === 'error') return Promise.reject(error);
    return Promise.resolve([]);
  });

  // The postgres library uses tagged template literals, which makes the sql object callable.
  // We simulate this by making the mock function act as the sql object.
  (mockFn as any).unsafe = vi.fn().mockImplementation(() => {
    if (behavior === 'error') return Promise.reject(error);
    return Promise.resolve([]);
  });

  return mockFn as any;
}

function makeCostRecord(overrides?: Partial<CostRecord>): CostRecord {
  return {
    agentId: 'test-agent',
    model: 'gpt-4o',
    provider: 'openai',
    inputTokens: 100,
    outputTokens: 50,
    inputCost: 0.001,
    outputCost: 0.002,
    totalCost: 0.003,
    priced: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('DbWriter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeCostRecord', () => {
    it('calls SQL insert with correct parameters', async () => {
      const mockSql = createMockSql('success');
      const writer = new DbWriter(mockSql, true);
      const record = makeCostRecord();

      await writer.writeCostRecord(record);

      expect(mockSql).toHaveBeenCalledTimes(1);
      // The tagged template literal is called with template strings array and parameters
      const callArgs = mockSql.mock.calls[0];
      expect(callArgs[0]).toBeDefined(); // TemplateStringsArray
      // Parameters include all the record fields
      expect(callArgs).toContainEqual(record.agentId);
      expect(callArgs).toContainEqual(record.model);
      expect(callArgs).toContainEqual(record.provider);
      expect(callArgs).toContainEqual(record.inputTokens);
      expect(callArgs).toContainEqual(record.outputTokens);
    });

    it('fail-open mode: SQL error logs to stderr, does not throw', async () => {
      const mockSql = createMockSql('error');
      const writer = new DbWriter(mockSql, true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      // Should NOT throw
      await expect(writer.writeCostRecord(makeCostRecord())).resolves.toBeUndefined();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('DB write failed (fail-open)'));
      stderrSpy.mockRestore();
    });

    it('fail-closed mode: SQL error throws', async () => {
      const mockSql = createMockSql('error');
      const writer = new DbWriter(mockSql, false);

      await expect(writer.writeCostRecord(makeCostRecord())).rejects.toThrow('DB connection failed');
    });
  });

  describe('writePolicyEvaluation', () => {
    it('calls SQL insert with correct parameters', async () => {
      const mockSql = createMockSql('success');
      const writer = new DbWriter(mockSql, true);

      await writer.writePolicyEvaluation({
        agentId: 'test-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        allowed: true,
        evaluatedCount: 3,
        matchedCount: 2,
        evaluationTimeMs: 1.5,
      });

      expect(mockSql).toHaveBeenCalledTimes(1);
      const callArgs = mockSql.mock.calls[0];
      expect(callArgs).toContainEqual('test-agent');
      expect(callArgs).toContainEqual('openai');
      expect(callArgs).toContainEqual('/v1/chat/completions');
      expect(callArgs).toContainEqual(true);
    });

    it('fail-open mode: SQL error logs to stderr, does not throw', async () => {
      const mockSql = createMockSql('error');
      const writer = new DbWriter(mockSql, true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      await expect(writer.writePolicyEvaluation({
        agentId: 'test-agent',
        provider: 'openai',
        path: '/',
        allowed: false,
        evaluatedCount: 1,
        matchedCount: 1,
        deniedBy: 'test-policy',
        deniedReason: 'blocked',
      })).resolves.toBeUndefined();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('DB write failed (fail-open)'));
      stderrSpy.mockRestore();
    });

    it('fail-closed mode: SQL error throws', async () => {
      const mockSql = createMockSql('error');
      const writer = new DbWriter(mockSql, false);

      await expect(writer.writePolicyEvaluation({
        agentId: 'test-agent',
        provider: 'openai',
        path: '/',
        allowed: true,
        evaluatedCount: 0,
        matchedCount: 0,
      })).rejects.toThrow('DB connection failed');
    });
  });

  describe('isAvailable', () => {
    it('returns true when SQL succeeds', async () => {
      const mockSql = createMockSql('success');
      const writer = new DbWriter(mockSql, true);

      const result = await writer.isAvailable();
      expect(result).toBe(true);
    });

    it('returns false when SQL fails', async () => {
      const mockSql = createMockSql('error');
      const writer = new DbWriter(mockSql, true);

      const result = await writer.isAvailable();
      expect(result).toBe(false);
    });
  });
});
