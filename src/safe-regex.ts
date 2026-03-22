/**
 * ReDoS (Regular Expression Denial of Service) protection utilities.
 *
 * Checks user-supplied regex patterns for known dangerous constructs
 * before compiling them. Unsafe patterns are rejected (return false)
 * rather than risking catastrophic backtracking.
 *
 * Dangerous constructs detected:
 * - Nested quantifiers: e.g., (a+)+ or (a*){2,}
 * - Overlapping alternation with quantifiers: e.g., (a|a)+
 * - Excessive pattern length (>500 chars)
 */

/** Maximum allowed pattern length to prevent resource exhaustion. */
const MAX_PATTERN_LENGTH = 500;

/**
 * Detects nested quantifiers like (a+)+, (a*){2,}, (a{1,3})*
 * These cause exponential backtracking on non-matching input.
 */
const NESTED_QUANTIFIER = /(\+|\*|\{[^}]+\})\s*\)(\+|\*|\{[^}]+\})/;

/**
 * Detects overlapping alternation with quantifiers like (a|a)+, (ab|ab)*
 * These create ambiguous match paths leading to exponential time.
 */
const OVERLAPPING_ALT = /\(([^)]*\|[^)]*)\)(\+|\*|\{[^}]+\})/;

/**
 * Check whether a regex pattern is safe to compile and execute.
 *
 * Returns false if the pattern:
 * - Exceeds MAX_PATTERN_LENGTH
 * - Contains nested quantifiers
 * - Contains overlapping alternation with quantifiers
 * - Is not a valid regex (would throw on `new RegExp()`)
 *
 * @param pattern - The regex pattern string to validate
 * @returns true if the pattern is safe to use, false otherwise
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  if (NESTED_QUANTIFIER.test(pattern)) return false;
  if (OVERLAPPING_ALT.test(pattern)) return false;

  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely test a regex pattern against an input string.
 *
 * If the pattern is unsafe (per isSafePattern), returns false immediately
 * instead of risking catastrophic backtracking. This is the correct
 * semantic for policy matching: an unsafe pattern simply does not match.
 *
 * @param pattern - The regex pattern string
 * @param input - The string to test against
 * @returns true if the pattern is safe AND matches the input
 */
export function safeRegexTest(pattern: string, input: string): boolean {
  if (!isSafePattern(pattern)) return false;

  try {
    return new RegExp(pattern).test(input);
  } catch {
    return false;
  }
}
