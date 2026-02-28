/**
 * Tests for the ApprovalTimeoutChecker (src/approval-timeout.ts).
 * Uses mocked SQL to test expiration behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalTimeoutChecker } from '../src/approval-timeout.js';

function createMockSql(resultCount = 0) {
  const mockFn = vi.fn().mockImplementation(() => {
    const r: any[] = [];
    r.count = resultCount;
    return Promise.resolve(r);
  }) as any;
  return mockFn;
}

describe('ApprovalTimeoutChecker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('expireTimedOut', () => {
    it('updates pending records past expiration and returns count', async () => {
      const mockSql = createMockSql(3);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const checker = new ApprovalTimeoutChecker(mockSql);

      const count = await checker.expireTimedOut();

      expect(count).toBe(3);
      expect(mockSql).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auto-denied 3 expired approval request(s)'),
      );
      consoleSpy.mockRestore();
    });

    it('does not log when no records are expired', async () => {
      const mockSql = createMockSql(0);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const checker = new ApprovalTimeoutChecker(mockSql);

      const count = await checker.expireTimedOut();

      expect(count).toBe(0);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not touch non-pending records (query filters by status=pending)', async () => {
      // The SQL includes WHERE status = 'pending', so non-pending records are unaffected.
      // We verify by checking that the correct SQL template is called.
      const mockSql = createMockSql(0);
      const checker = new ApprovalTimeoutChecker(mockSql);

      await checker.expireTimedOut();

      expect(mockSql).toHaveBeenCalledTimes(1);
      // The tagged template call should include the pending status filter
      const templateStrings = mockSql.mock.calls[0][0];
      const fullQuery = Array.isArray(templateStrings) ? templateStrings.join('') : String(templateStrings);
      expect(fullQuery).toContain('pending');
      expect(fullQuery).toContain('denied_timeout');
    });
  });

  describe('denied_timeout is distinct from denied', () => {
    it('sets status to denied_timeout, not denied', async () => {
      const mockSql = createMockSql(1);
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const checker = new ApprovalTimeoutChecker(mockSql);

      await checker.expireTimedOut();

      // Verify the SQL sets denied_timeout, not denied
      const templateStrings = mockSql.mock.calls[0][0];
      const fullQuery = Array.isArray(templateStrings) ? templateStrings.join('') : String(templateStrings);
      expect(fullQuery).toContain('denied_timeout');
      consoleSpy.mockRestore();
    });
  });

  describe('start/stop lifecycle', () => {
    it('start creates an interval and stop clears it', () => {
      const mockSql = createMockSql(0);
      const checker = new ApprovalTimeoutChecker(mockSql);

      checker.start();
      // The interval should be running
      checker.stop();
      // No error means clean stop
    });

    it('stop is safe to call when not started', () => {
      const mockSql = createMockSql(0);
      const checker = new ApprovalTimeoutChecker(mockSql);

      // Should not throw
      checker.stop();
    });
  });
});
