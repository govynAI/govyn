/**
 * Tests for the retention manager (src/db-retention.ts).
 * Uses mocked SQL to test cleanup behavior without a real database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetentionManager } from '../src/db-retention.js';

/**
 * Create a mock postgres.Sql tagged template function.
 * Tracks calls and returns configurable results.
 */
function createMockSql(results: { count: number } = { count: 0 }) {
  const mockFn = vi.fn().mockImplementation(() => {
    const res = Object.assign([], results);
    return Promise.resolve(res);
  });

  (mockFn as any).unsafe = vi.fn().mockImplementation(() => {
    const res = Object.assign([], results);
    return Promise.resolve(res);
  });

  return mockFn as any;
}

describe('RetentionManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('cleanupCostRecords', () => {
    it('executes aggregate and delete queries', async () => {
      const mockSql = createMockSql({ count: 5 });
      const manager = new RetentionManager(mockSql, 90, 365);

      const result = await manager.cleanupCostRecords();

      // Should have been called twice: once for INSERT INTO cost_daily_summary, once for DELETE
      expect(mockSql).toHaveBeenCalledTimes(2);
      expect(result.aggregated).toBe(5);
      expect(result.deleted).toBe(5);
    });

    it('uses correct retention days for cutoff calculation', async () => {
      const mockSql = createMockSql({ count: 0 });
      const manager = new RetentionManager(mockSql, 30, 365);

      await manager.cleanupCostRecords();

      // The SQL was called — we verify the cutoff date is approximately 30 days ago
      expect(mockSql).toHaveBeenCalledTimes(2);
      // The first call's parameters include a Date object
      const firstCall = mockSql.mock.calls[0];
      const dateParam = firstCall.find((arg: unknown) => arg instanceof Date);
      if (dateParam) {
        const daysAgo = (Date.now() - dateParam.getTime()) / (24 * 60 * 60 * 1000);
        expect(daysAgo).toBeCloseTo(30, 0);
      }
    });
  });

  describe('cleanupPolicyEvaluations', () => {
    it('deletes old policy evaluation records', async () => {
      const mockSql = createMockSql({ count: 10 });
      const manager = new RetentionManager(mockSql, 90, 365);

      const deleted = await manager.cleanupPolicyEvaluations();

      expect(mockSql).toHaveBeenCalledTimes(1);
      expect(deleted).toBe(10);
    });
  });

  describe('cleanupApprovalRecords', () => {
    it('deletes old approval records using separate retention period', async () => {
      const mockSql = createMockSql({ count: 3 });
      const manager = new RetentionManager(mockSql, 90, 180);

      const deleted = await manager.cleanupApprovalRecords();

      expect(mockSql).toHaveBeenCalledTimes(1);
      expect(deleted).toBe(3);

      // Verify the cutoff date uses approval retention days (180), not cost retention (90)
      const callArgs = mockSql.mock.calls[0];
      const dateParam = callArgs.find((arg: unknown) => arg instanceof Date);
      if (dateParam) {
        const daysAgo = (Date.now() - dateParam.getTime()) / (24 * 60 * 60 * 1000);
        expect(daysAgo).toBeCloseTo(180, 0);
      }
    });
  });

  describe('runAll', () => {
    it('runs all cleanup tasks without throwing', async () => {
      const mockSql = createMockSql({ count: 0 });
      const manager = new RetentionManager(mockSql, 90, 365);

      await expect(manager.runAll()).resolves.toBeUndefined();
    });

    it('handles errors gracefully and logs to stderr', async () => {
      const error = new Error('cleanup failed');
      const mockSql = vi.fn().mockImplementation(() => Promise.reject(error)) as any;
      mockSql.unsafe = vi.fn().mockImplementation(() => Promise.reject(error));

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const manager = new RetentionManager(mockSql, 90, 365);

      // Should not throw
      await expect(manager.runAll()).resolves.toBeUndefined();

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Retention cleanup failed'));
      stderrSpy.mockRestore();
    });
  });
});
