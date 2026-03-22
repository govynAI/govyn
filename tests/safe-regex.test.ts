/**
 * Tests for ReDoS protection utilities (safe-regex.ts).
 *
 * Verifies that:
 * - Safe patterns are accepted
 * - Patterns with nested quantifiers are rejected
 * - Patterns with overlapping alternation are rejected
 * - Overly long patterns are rejected
 * - Invalid regex syntax is rejected
 * - safeRegexTest returns false for unsafe patterns instead of hanging
 */

import { describe, it, expect } from 'vitest';
import { isSafePattern, safeRegexTest } from '../src/safe-regex.js';

describe('isSafePattern', () => {
  describe('safe patterns', () => {
    it('accepts a simple literal pattern', () => {
      expect(isSafePattern('hello')).toBe(true);
    });

    it('accepts a basic character class', () => {
      expect(isSafePattern('[a-z]+')).toBe(true);
    });

    it('accepts a pattern with a single quantifier', () => {
      expect(isSafePattern('\\d{3}-\\d{2}-\\d{4}')).toBe(true);
    });

    it('accepts an alternation without quantifier', () => {
      expect(isSafePattern('(foo|bar)')).toBe(true);
    });

    it('accepts a model name pattern', () => {
      expect(isSafePattern('gpt-4.*')).toBe(true);
    });

    it('accepts a path pattern', () => {
      expect(isSafePattern('/v1/chat/.*')).toBe(true);
    });

    it('accepts a pattern with non-capturing group', () => {
      expect(isSafePattern('(?:abc|def)')).toBe(true);
    });

    it('accepts anchored patterns', () => {
      expect(isSafePattern('^start.*end$')).toBe(true);
    });
  });

  describe('unsafe patterns — nested quantifiers', () => {
    it('rejects (a+)+', () => {
      expect(isSafePattern('(a+)+')).toBe(false);
    });

    it('rejects (a*)*', () => {
      expect(isSafePattern('(a*)*')).toBe(false);
    });

    it('rejects (a+)*', () => {
      expect(isSafePattern('(a+)*')).toBe(false);
    });

    it('rejects (a{1,3})+', () => {
      expect(isSafePattern('(a{1,3})+')).toBe(false);
    });

    it('rejects (a{2,})*', () => {
      expect(isSafePattern('(a{2,})*')).toBe(false);
    });

    it('rejects (.*){5}', () => {
      expect(isSafePattern('(.*){5}')).toBe(false);
    });
  });

  describe('unsafe patterns — overlapping alternation', () => {
    it('rejects (a|a)+', () => {
      expect(isSafePattern('(a|a)+')).toBe(false);
    });

    it('rejects (x|y|z)*', () => {
      expect(isSafePattern('(x|y|z)*')).toBe(false);
    });

    it('rejects (foo|bar)+', () => {
      expect(isSafePattern('(foo|bar)+')).toBe(false);
    });
  });

  describe('unsafe patterns — length and syntax', () => {
    it('rejects patterns longer than 500 characters', () => {
      const longPattern = 'a'.repeat(501);
      expect(isSafePattern(longPattern)).toBe(false);
    });

    it('accepts patterns exactly 500 characters', () => {
      const pattern = 'a'.repeat(500);
      expect(isSafePattern(pattern)).toBe(true);
    });

    it('rejects invalid regex syntax', () => {
      expect(isSafePattern('[invalid')).toBe(false);
    });

    it('rejects unbalanced parentheses', () => {
      expect(isSafePattern('(unclosed')).toBe(false);
    });
  });
});

describe('safeRegexTest', () => {
  it('returns true when a safe pattern matches', () => {
    expect(safeRegexTest('hello', 'hello world')).toBe(true);
  });

  it('returns false when a safe pattern does not match', () => {
    expect(safeRegexTest('hello', 'goodbye world')).toBe(false);
  });

  it('returns false for an unsafe pattern instead of hanging', () => {
    // This pattern would cause catastrophic backtracking if compiled
    expect(safeRegexTest('(a+)+', 'aaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
  });

  it('returns false for invalid regex syntax', () => {
    expect(safeRegexTest('[invalid', 'test')).toBe(false);
  });

  it('handles regex special characters in input', () => {
    expect(safeRegexTest('\\d+', '12345')).toBe(true);
    expect(safeRegexTest('\\d+', 'no digits')).toBe(false);
  });

  it('matches model name patterns', () => {
    expect(safeRegexTest('gpt-4.*', 'gpt-4-turbo')).toBe(true);
    expect(safeRegexTest('gpt-4.*', 'claude-3')).toBe(false);
  });

  it('matches path patterns', () => {
    expect(safeRegexTest('/v1/chat/.*', '/v1/chat/completions')).toBe(true);
    expect(safeRegexTest('/v1/chat/.*', '/v1/embeddings')).toBe(false);
  });

  it('returns false for overly long patterns', () => {
    const longPattern = 'a'.repeat(501);
    expect(safeRegexTest(longPattern, 'a')).toBe(false);
  });
});
