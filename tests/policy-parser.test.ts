/**
 * Tests for the Govyn policy YAML parser.
 *
 * RED phase: All tests should FAIL initially because src/policy-parser.ts
 * does not exist yet.
 */

import { describe, it, expect } from 'vitest';
import { parsePolicies, parsePoliciesFromFile } from '../src/policy-parser.js';

describe('parsePolicies', () => {

  it('parses a valid minimal policy', () => {
    const yaml = `
version: 1
policies:
  - name: block-all
    type: block
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.policies).toHaveLength(1);
    expect(result.policies[0].name).toBe('block-all');
    expect(result.policies[0].type).toBe('block');
    expect(result.policies[0].scope).toEqual({ level: 'global' });
  });

  it('recognizes all six policy types', () => {
    const yaml = `
version: 1
policies:
  - name: p-block
    type: block
    scope: global
  - name: p-rate
    type: rate_limit
    scope: global
    limit: 10
    window_seconds: 60
  - name: p-budget
    type: budget_limit
    scope: global
    limit: 100
    period: daily
  - name: p-content
    type: content_filter
    scope: global
    patterns:
      - ssn
  - name: p-time
    type: time_window
    scope: global
    start: "09:00"
    end: "17:00"
    timezone: UTC
    mode: allow
    days:
      - weekdays
  - name: p-route
    type: model_route
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies).toHaveLength(6);
    expect(result.policies.map(p => p.type)).toEqual([
      'block', 'rate_limit', 'budget_limit', 'content_filter', 'time_window', 'model_route',
    ]);
  });

  it('fails when version field is missing', () => {
    const yaml = `
policies:
  - name: test
    type: block
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('version');
  });

  it('fails when version number is unsupported', () => {
    const yaml = `
version: 2
policies:
  - name: test
    type: block
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('version');
  });

  it('fails when policies array is missing', () => {
    const yaml = `
version: 1
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('policies');
  });

  it('fails when a policy is missing the name field', () => {
    const yaml = `
version: 1
policies:
  - type: block
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('name');
    // Must include a line number
    expect(result.errors[0].line).toBeDefined();
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it('fails when a policy is missing the type field', () => {
    const yaml = `
version: 1
policies:
  - name: test-policy
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('type');
    expect(result.errors[0].line).toBeDefined();
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it('fails when a policy has an unknown type', () => {
    const yaml = `
version: 1
policies:
  - name: test-policy
    type: unknown_type
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const msg = result.errors[0].message.toLowerCase();
    expect(msg).toContain('unknown_type');
    // Error should mention valid types
    expect(msg).toContain('block');
  });

  it('fails when duplicate policy names exist', () => {
    const yaml = `
version: 1
policies:
  - name: my-policy
    type: block
    scope: global
  - name: my-policy
    type: rate_limit
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('duplicate');
  });

  it('fails when scope has an invalid format', () => {
    const yaml = `
version: 1
policies:
  - name: test-policy
    type: block
    scope: "invalid"
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message.toLowerCase()).toContain('scope');
  });

  it('parses scope strings correctly', () => {
    const yaml = `
version: 1
policies:
  - name: global-policy
    type: block
    scope: global
  - name: agent-policy
    type: block
    scope: "agent:my-bot"
  - name: target-policy
    type: block
    scope: "target:openai"
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies).toHaveLength(3);
    expect(result.policies[0].scope).toEqual({ level: 'global' });
    expect(result.policies[1].scope).toEqual({ level: 'agent', value: 'my-bot' });
    expect(result.policies[2].scope).toEqual({ level: 'target', value: 'openai' });
  });

  it('defaults enabled to true when not specified', () => {
    const yaml = `
version: 1
policies:
  - name: test-policy
    type: block
    scope: global
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies[0].enabled).toBe(true);
  });

  it('respects enabled: false', () => {
    const yaml = `
version: 1
policies:
  - name: test-policy
    type: block
    scope: global
    enabled: false
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies[0].enabled).toBe(false);
  });

  it('succeeds with empty policies array but emits a warning', () => {
    const yaml = `
version: 1
policies: []
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('fails with a YAML syntax error including a line number', () => {
    const yaml = `
version: 1
policies:
  - name: test
    type: block
    scope: global
  bad-indentation
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].line).toBeDefined();
    expect(result.errors[0].line).toBeGreaterThan(0);
  });

  it('includes correct line numbers in validation errors', () => {
    // The missing-name policy starts at a known line
    const yaml = [
      'version: 1',       // line 1
      'policies:',        // line 2
      '  - name: ok',     // line 3
      '    type: block',  // line 4
      '    scope: global', // line 5
      '  - type: block',  // line 6 — missing name
      '    scope: global', // line 7
    ].join('\n');
    const result = parsePolicies(yaml);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // The error for the second policy should reference line 6 (the start of that policy entry)
    expect(result.errors[0].line).toBeDefined();
    expect(result.errors[0].line).toBeGreaterThanOrEqual(6);
  });

  it('preserves type-specific fields on parsed policies', () => {
    const yaml = `
version: 1
policies:
  - name: block-policy
    type: block
    scope: global
    match:
      pattern: "DELETE FROM"
    message: "Blocked destructive query"
  - name: rate-policy
    type: rate_limit
    scope: global
    limit: 100
    window_seconds: 60
  - name: budget-policy
    type: budget_limit
    scope: "agent:bot"
    limit: 50
    period: daily
  - name: filter-policy
    type: content_filter
    scope: global
    patterns:
      - "SSN"
      - "credit-card"
  - name: time-policy
    type: time_window
    scope: global
    start: "09:00"
    end: "17:00"
    timezone: UTC
    mode: allow
    days:
      - monday
      - tuesday
  - name: route-policy
    type: model_route
    scope: global
    rules:
      - when:
          input_tokens_estimate: "<500"
        route_to: claude-haiku
    model_aliases:
      cheap: claude-haiku
`;
    const result = parsePolicies(yaml);
    expect(result.success).toBe(true);
    expect(result.policies).toHaveLength(6);

    // Block
    const block = result.policies[0];
    expect(block.type).toBe('block');
    if (block.type === 'block') {
      expect(block.match).toEqual({ pattern: 'DELETE FROM' });
      expect(block.message).toBe('Blocked destructive query');
    }

    // Rate limit
    const rate = result.policies[1];
    expect(rate.type).toBe('rate_limit');
    if (rate.type === 'rate_limit') {
      expect(rate.limit).toBe(100);
      expect(rate.window_seconds).toBe(60);
    }

    // Budget limit
    const budget = result.policies[2];
    expect(budget.type).toBe('budget_limit');
    if (budget.type === 'budget_limit') {
      expect(budget.limit).toBe(50);
      expect(budget.period).toBe('daily');
    }

    // Content filter
    const filter = result.policies[3];
    expect(filter.type).toBe('content_filter');
    if (filter.type === 'content_filter') {
      expect(filter.patterns).toEqual(['SSN', 'credit-card']);
    }

    // Time window
    const time = result.policies[4];
    expect(time.type).toBe('time_window');
    if (time.type === 'time_window') {
      expect(time.start).toBe('09:00');
      expect(time.end).toBe('17:00');
      expect(time.timezone).toBe('UTC');
      expect(time.mode).toBe('allow');
      expect(time.days).toEqual(['monday', 'tuesday']);
    }

    // Model route
    const route = result.policies[5];
    expect(route.type).toBe('model_route');
    if (route.type === 'model_route') {
      expect(route.rules).toHaveLength(1);
      expect(route.model_aliases).toEqual({ cheap: 'claude-haiku' });
    }
  });

  // ─── Strict type-specific field validation tests ───

  describe('rate_limit strict validation', () => {
    it('rejects rate_limit missing limit with line-number error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-rate
    type: rate_limit
    scope: global
    window_seconds: 60
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('limit');
      expect(result.errors[0].message).toContain('rate_limit');
      expect(result.errors[0].line).toBeDefined();
      expect(result.errors[0].line).toBeGreaterThan(0);
    });

    it('rejects rate_limit missing window_seconds with line-number error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-rate
    type: rate_limit
    scope: global
    limit: 100
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('window_seconds');
      expect(result.errors[0].message).toContain('rate_limit');
      expect(result.errors[0].line).toBeDefined();
      expect(result.errors[0].line).toBeGreaterThan(0);
    });
  });

  describe('budget_limit strict validation', () => {
    it('rejects budget_limit missing limit with error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-budget
    type: budget_limit
    scope: global
    period: daily
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('limit');
      expect(result.errors[0].message).toContain('budget_limit');
    });

    it('rejects budget_limit missing period with error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-budget
    type: budget_limit
    scope: global
    limit: 50
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('period');
      expect(result.errors[0].message).toContain('budget_limit');
    });

    it('rejects budget_limit with invalid period value', () => {
      const yaml = `
version: 1
policies:
  - name: bad-budget
    type: budget_limit
    scope: global
    limit: 50
    period: biweekly
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('period');
      expect(result.errors[0].message).toContain('daily, weekly, monthly');
    });
  });

  describe('content_filter strict validation', () => {
    it('rejects content_filter missing patterns with error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-filter
    type: content_filter
    scope: global
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('patterns');
      expect(result.errors[0].message).toContain('content_filter');
    });
  });

  describe('time_window strict validation', () => {
    it('rejects time_window missing start with error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-time
    type: time_window
    scope: global
    end: "17:00"
    timezone: UTC
    mode: allow
    days:
      - monday
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const msgs = result.errors.map(e => e.message);
      expect(msgs.some(m => m.includes('start'))).toBe(true);
    });

    it('rejects time_window missing end with error', () => {
      const yaml = `
version: 1
policies:
  - name: bad-time
    type: time_window
    scope: global
    start: "09:00"
    timezone: UTC
    mode: allow
    days:
      - monday
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const msgs = result.errors.map(e => e.message);
      expect(msgs.some(m => m.includes('end'))).toBe(true);
    });

    it('rejects time_window missing all required fields with multiple errors', () => {
      const yaml = `
version: 1
policies:
  - name: bad-time
    type: time_window
    scope: global
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(false);
      // Should have errors for start, end, timezone, mode, and days
      expect(result.errors.length).toBeGreaterThanOrEqual(5);
      const msgs = result.errors.map(e => e.message);
      expect(msgs.some(m => m.includes('start'))).toBe(true);
      expect(msgs.some(m => m.includes('"end"'))).toBe(true);
      expect(msgs.some(m => m.includes('timezone'))).toBe(true);
      expect(msgs.some(m => m.includes('mode'))).toBe(true);
      expect(msgs.some(m => m.includes('days'))).toBe(true);
    });
  });

  describe('valid policies still parse correctly (regression guard)', () => {
    it('parses valid rate_limit policy', () => {
      const yaml = `
version: 1
policies:
  - name: valid-rate
    type: rate_limit
    scope: global
    limit: 100
    window_seconds: 60
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(true);
      expect(result.policies).toHaveLength(1);
      if (result.policies[0].type === 'rate_limit') {
        expect(result.policies[0].limit).toBe(100);
        expect(result.policies[0].window_seconds).toBe(60);
      }
    });

    it('parses valid budget_limit policy', () => {
      const yaml = `
version: 1
policies:
  - name: valid-budget
    type: budget_limit
    scope: global
    limit: 50
    period: weekly
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(true);
      expect(result.policies).toHaveLength(1);
      if (result.policies[0].type === 'budget_limit') {
        expect(result.policies[0].limit).toBe(50);
        expect(result.policies[0].period).toBe('weekly');
      }
    });

    it('parses valid content_filter policy', () => {
      const yaml = `
version: 1
policies:
  - name: valid-filter
    type: content_filter
    scope: global
    patterns:
      - ssn
      - email
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(true);
      expect(result.policies).toHaveLength(1);
      if (result.policies[0].type === 'content_filter') {
        expect(result.policies[0].patterns).toEqual(['ssn', 'email']);
      }
    });

    it('parses valid time_window policy', () => {
      const yaml = `
version: 1
policies:
  - name: valid-time
    type: time_window
    scope: global
    start: "09:00"
    end: "17:00"
    timezone: UTC
    mode: allow
    days:
      - monday
      - friday
`;
      const result = parsePolicies(yaml);
      expect(result.success).toBe(true);
      expect(result.policies).toHaveLength(1);
      if (result.policies[0].type === 'time_window') {
        expect(result.policies[0].start).toBe('09:00');
        expect(result.policies[0].end).toBe('17:00');
        expect(result.policies[0].timezone).toBe('UTC');
        expect(result.policies[0].mode).toBe('allow');
        expect(result.policies[0].days).toEqual(['monday', 'friday']);
      }
    });
  });
});

describe('parsePoliciesFromFile', () => {
  it('returns error for non-existent file', () => {
    const result = parsePoliciesFromFile('/tmp/non-existent-policy-file.yaml');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('non-existent-policy-file.yaml');
  });
});
