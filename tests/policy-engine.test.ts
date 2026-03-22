/**
 * Tests for the Govyn PolicyEngine.
 *
 * Phase 6 tests: scope matching, enabled/disabled, most-restrictive-wins, performance.
 * Phase 7 tests: block evaluator (AND logic, regex), rate limit (sliding window),
 *   budget limit (CostAggregator integration), inferActionType helper.
 */

import { describe, it, expect } from 'vitest';
import { PolicyEngine, inferActionType } from '../src/policy-engine.js';
import { CostAggregator } from '../src/cost-aggregator.js';
import type {
  Policy,
  BlockPolicy,
  RateLimitPolicy,
  BudgetLimitPolicy,
  ContentFilterPolicy,
  TimeWindowPolicy,
  ModelRoutePolicy,
  ModelRouteResult,
  PolicyRequestContext,
} from '../src/policy-types.js';

/** Helper: build a minimal request context */
function makeContext(overrides: Partial<PolicyRequestContext> = {}): PolicyRequestContext {
  return {
    agentId: 'test-agent',
    provider: 'openai',
    path: '/v1/chat/completions',
    method: 'POST',
    ...overrides,
  };
}

/** Helper: build a minimal block policy */
function makeBlockPolicy(overrides: Partial<Policy> = {}): Policy {
  return {
    name: 'test-block',
    type: 'block',
    enabled: true,
    scope: { level: 'global' },
    ...overrides,
  } as Policy;
}

describe('PolicyEngine', () => {
  describe('loading policies', () => {
    it('loads policies from a YAML string', () => {
      const engine = new PolicyEngine();
      const yaml = `
version: 1
policies:
  - name: block-all
    type: block
    scope: global
`;
      const result = engine.loadFromYaml(yaml);
      expect(result.success).toBe(true);
      expect(engine.getPolicies()).toHaveLength(1);
      expect(engine.getPolicies()[0].name).toBe('block-all');
    });

    it('loads policies from a parsed Policy array', () => {
      const engine = new PolicyEngine();
      const policies: Policy[] = [
        makeBlockPolicy({ name: 'p1' }),
        makeBlockPolicy({ name: 'p2' }),
      ];
      engine.loadFromPolicies(policies);
      expect(engine.getPolicies()).toHaveLength(2);
    });
  });

  describe('evaluate — empty engine', () => {
    it('returns allowed with zero counts when no policies loaded', () => {
      const engine = new PolicyEngine();
      const result = engine.evaluate(makeContext());
      expect(result.allowed).toBe(true);
      expect(result.evaluatedCount).toBe(0);
      expect(result.matchedCount).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('evaluate — scope matching', () => {
    it('global policy matches all requests', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'global-block', scope: { level: 'global' } }),
      ]);

      const result = engine.evaluate(makeContext({ agentId: 'any-agent', provider: 'any-provider' }));
      expect(result.allowed).toBe(false);
      expect(result.matchedCount).toBe(1);
      expect(result.denied).toBeDefined();
      expect(result.denied!.policyName).toBe('global-block');
    });

    it('agent-scoped policy matches the correct agent', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'agent-block', scope: { level: 'agent', value: 'bot-1' } }),
      ]);

      // Should match bot-1
      const result1 = engine.evaluate(makeContext({ agentId: 'bot-1' }));
      expect(result1.allowed).toBe(false);
      expect(result1.matchedCount).toBe(1);

      // Should NOT match bot-2
      const result2 = engine.evaluate(makeContext({ agentId: 'bot-2' }));
      expect(result2.allowed).toBe(true);
      expect(result2.matchedCount).toBe(0);
    });

    it('target-scoped policy matches the correct provider', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'target-block', scope: { level: 'target', value: 'openai' } }),
      ]);

      // Should match openai
      const result1 = engine.evaluate(makeContext({ provider: 'openai' }));
      expect(result1.allowed).toBe(false);
      expect(result1.matchedCount).toBe(1);

      // Should NOT match anthropic
      const result2 = engine.evaluate(makeContext({ provider: 'anthropic' }));
      expect(result2.allowed).toBe(true);
      expect(result2.matchedCount).toBe(0);
    });
  });

  describe('evaluate — most-restrictive-wins', () => {
    it('denies when any matching policy denies', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        // rate_limit allows in Phase 6 (skeleton behavior)
        {
          name: 'allow-rate',
          type: 'rate_limit',
          enabled: true,
          scope: { level: 'global' },
        } as Policy,
        // block denies on scope match
        makeBlockPolicy({ name: 'block-agent', scope: { level: 'agent', value: 'bot-1' } }),
      ]);

      const result = engine.evaluate(makeContext({ agentId: 'bot-1' }));
      expect(result.allowed).toBe(false);
      expect(result.denied).toBeDefined();
      expect(result.denied!.policyName).toBe('block-agent');
    });
  });

  describe('evaluate — disabled policies', () => {
    it('skips disabled policies during evaluation', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'disabled-block', enabled: false, scope: { level: 'global' } }),
      ]);

      const result = engine.evaluate(makeContext());
      expect(result.allowed).toBe(true);
      expect(result.evaluatedCount).toBe(0);
      expect(result.matchedCount).toBe(0);
    });
  });

  describe('evaluate — result structure', () => {
    it('denied result includes policy name and type', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'named-block', scope: { level: 'global' } }),
      ]);

      const result = engine.evaluate(makeContext());
      expect(result.denied).toBeDefined();
      expect(result.denied!.policyName).toBe('named-block');
      expect(result.denied!.policyType).toBe('block');
      expect(result.denied!.allowed).toBe(false);
    });

    it('multiple policies all allow results in allowed: true', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        {
          name: 'allow-rate',
          type: 'rate_limit',
          enabled: true,
          scope: { level: 'global' },
        } as Policy,
        {
          name: 'allow-budget',
          type: 'budget_limit',
          enabled: true,
          scope: { level: 'global' },
        } as Policy,
        {
          name: 'allow-content',
          type: 'content_filter',
          enabled: true,
          scope: { level: 'global' },
        } as Policy,
      ]);

      const result = engine.evaluate(makeContext());
      expect(result.allowed).toBe(true);
      expect(result.matchedCount).toBe(3);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.allowed)).toBe(true);
    });

    it('evaluation result includes timing as a number >= 0', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'timed-block', scope: { level: 'global' } }),
      ]);

      const result = engine.evaluate(makeContext());
      expect(typeof result.evaluationTimeMs).toBe('number');
      expect(result.evaluationTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('evaluate — performance benchmark', () => {
    it('evaluates 100 policies in <5ms', () => {
      const engine = new PolicyEngine();
      const policies: Policy[] = [];
      for (let i = 0; i < 100; i++) {
        policies.push(
          makeBlockPolicy({
            name: `block-${i}`,
            scope: { level: 'global' },
          }),
        );
      }
      engine.loadFromPolicies(policies);

      const result = engine.evaluate(makeContext());
      expect(result.evaluatedCount).toBe(100);
      expect(result.matchedCount).toBe(100);
      expect(result.evaluationTimeMs).toBeLessThan(5);
    });
  });

  describe('query methods', () => {
    it('getPolicies returns all loaded policies', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'p1' }),
        makeBlockPolicy({ name: 'p2' }),
        makeBlockPolicy({ name: 'p3' }),
      ]);
      expect(engine.getPolicies()).toHaveLength(3);
    });

    it('getPoliciesByType filters by type', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'block-1' }),
        {
          name: 'rate-1',
          type: 'rate_limit',
          enabled: true,
          scope: { level: 'global' },
        } as Policy,
        makeBlockPolicy({ name: 'block-2' }),
      ]);

      const blocks = engine.getPoliciesByType('block');
      expect(blocks).toHaveLength(2);
      expect(blocks.every((p) => p.type === 'block')).toBe(true);

      const rates = engine.getPoliciesByType('rate_limit');
      expect(rates).toHaveLength(1);
      expect(rates[0].name).toBe('rate-1');
    });

    it('clearPolicies removes all policies', () => {
      const engine = new PolicyEngine();
      engine.loadFromPolicies([
        makeBlockPolicy({ name: 'p1' }),
        makeBlockPolicy({ name: 'p2' }),
      ]);
      expect(engine.getPolicies()).toHaveLength(2);

      engine.clearPolicies();
      expect(engine.getPolicies()).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Phase 7: Rule Type Evaluators
  // ─────────────────────────────────────────────────────────────

  describe('rule type evaluators', () => {

    // ── inferActionType helper ──────────────────────────────────

    describe('inferActionType', () => {
      it('classifies /v1/chat/completions as chat', () => {
        expect(inferActionType('/v1/chat/completions')).toBe('chat');
      });

      it('classifies /v1/embeddings as embedding', () => {
        expect(inferActionType('/v1/embeddings')).toBe('embedding');
      });

      it('classifies /v1/images/generations as image_generation', () => {
        expect(inferActionType('/v1/images/generations')).toBe('image_generation');
      });

      it('classifies /v1/audio/transcriptions as audio_transcription', () => {
        expect(inferActionType('/v1/audio/transcriptions')).toBe('audio_transcription');
      });

      it('classifies /v1/completions as completion', () => {
        expect(inferActionType('/v1/completions')).toBe('completion');
      });

      it('classifies unknown paths as unknown', () => {
        expect(inferActionType('/anything/else')).toBe('unknown');
      });
    });

    // ── Block evaluator ─────────────────────────────────────────

    describe('block evaluator', () => {
      it('denies when all match criteria are satisfied (literal strings)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-custom-chat',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              provider: 'custom',
              action_type: 'chat',
            },
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext({
          provider: 'custom',
          path: '/v1/chat/completions',
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyName).toBe('block-custom-chat');
      });

      it('allows when not all match criteria are satisfied (AND logic)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-openai-gpt4',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              provider: 'openai',
              model: 'gpt-4',
            },
          } as BlockPolicy,
        ]);

        // Request to 'custom' provider, not 'openai' -> should NOT be blocked
        const result = engine.evaluate(makeContext({
          provider: 'custom',
          model: 'gpt-4',
        }));
        expect(result.allowed).toBe(true);
      });

      it('denies when body regex matches', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-sql-injection',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              body: 'DELETE\\s+FROM',
              regex: true,
            },
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext({
          body: 'Please run DELETE FROM users where id=1',
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
      });

      it('allows when body regex does not match', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-sql-injection',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              body: 'DELETE\\s+FROM',
              regex: true,
            },
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext({
          body: 'SELECT * FROM users',
        }));
        expect(result.allowed).toBe(true);
      });

      it('denies when header pattern matches', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-header',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              headers: { 'x-custom': 'blocked-value' },
            },
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext({
          headers: { 'x-custom': 'blocked-value' },
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
      });

      it('allows when no match criteria specified (unconditional block for scope)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'unconditional-block',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            // no match field
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyName).toBe('unconditional-block');
      });

      it('denies when model matches', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'block-gpt4',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
            match: {
              model: 'gpt-4',
            },
          } as BlockPolicy,
        ]);

        const result = engine.evaluate(makeContext({
          model: 'gpt-4',
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
      });
    });

    // ── Rate limit evaluator ────────────────────────────────────

    describe('rate limit evaluator', () => {
      it('allows requests under the limit', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-3-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 3,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        const ctx = makeContext();
        const r1 = engine.evaluate(ctx);
        expect(r1.allowed).toBe(true);
        const r2 = engine.evaluate(ctx);
        expect(r2.allowed).toBe(true);
      });

      it('denies when limit is reached', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-2-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 2,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        const ctx = makeContext();
        const r1 = engine.evaluate(ctx);
        expect(r1.allowed).toBe(true);
        const r2 = engine.evaluate(ctx);
        expect(r2.allowed).toBe(true);
        const r3 = engine.evaluate(ctx);
        expect(r3.allowed).toBe(false);
        expect(r3.denied).toBeDefined();
        expect(r3.denied!.policyType).toBe('rate_limit');
      });

      it('returns retry_after_seconds in denial', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-1-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 1,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        const ctx = makeContext();
        engine.evaluate(ctx); // 1st - allowed
        const r2 = engine.evaluate(ctx); // 2nd - denied
        expect(r2.allowed).toBe(false);
        expect(r2.denied).toBeDefined();
        expect(r2.denied!.retryAfterSeconds).toBeDefined();
        expect(r2.denied!.retryAfterSeconds).toBeGreaterThan(0);
      });

      it('tracks per-agent independently', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-1-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 1,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        // Agent A uses their one request
        const rA1 = engine.evaluate(makeContext({ agentId: 'agent-a' }));
        expect(rA1.allowed).toBe(true);

        // Agent B still has their own quota
        const rB1 = engine.evaluate(makeContext({ agentId: 'agent-b' }));
        expect(rB1.allowed).toBe(true);

        // Agent A is now rate-limited
        const rA2 = engine.evaluate(makeContext({ agentId: 'agent-a' }));
        expect(rA2.allowed).toBe(false);
      });

      it('tracks per-policy independently', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-policy-1',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 1,
            window_seconds: 60,
          } as RateLimitPolicy,
          {
            name: 'rate-policy-2',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 1,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        // First request: both policies allow (each at 1/1)
        const r1 = engine.evaluate(makeContext());
        expect(r1.allowed).toBe(true);

        // Second request: both policies deny (each at 2/1)
        const r2 = engine.evaluate(makeContext());
        expect(r2.allowed).toBe(false);
      });

      it('window expires and allows again', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          {
            name: 'rate-1-per-10',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 1,
            window_seconds: 10,
          } as RateLimitPolicy,
        ]);

        const ctx = makeContext();
        const baseTime = 1000000;

        // First request at baseTime - allowed
        const r1 = engine.evaluate(ctx, { now: baseTime });
        expect(r1.allowed).toBe(true);

        // Second request 1s later - denied
        const r2 = engine.evaluate(ctx, { now: baseTime + 1000 });
        expect(r2.allowed).toBe(false);

        // Third request 11s later (past the 10s window) - allowed again
        const r3 = engine.evaluate(ctx, { now: baseTime + 11000 });
        expect(r3.allowed).toBe(true);
      });

      it('all requests count toward limit including denied-by-other-policies', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([
          // Block policy that denies everything
          {
            name: 'block-all',
            type: 'block',
            enabled: true,
            scope: { level: 'global' },
          } as Policy,
          // Rate limit that tracks
          {
            name: 'rate-2-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 2,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        const ctx = makeContext();
        // All denied by block, but rate limit still counts
        engine.evaluate(ctx);
        engine.evaluate(ctx);

        // Even if we remove the block, rate limit should be at/over limit
        engine.loadFromPolicies([
          {
            name: 'rate-2-per-60',
            type: 'rate_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 2,
            window_seconds: 60,
          } as RateLimitPolicy,
        ]);

        const r3 = engine.evaluate(ctx);
        expect(r3.allowed).toBe(false);
        expect(r3.denied).toBeDefined();
        expect(r3.denied!.policyType).toBe('rate_limit');
      });
    });

    // ── Budget limit evaluator ──────────────────────────────────

    describe('budget limit evaluator', () => {
      it('allows when spend is under limit', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // Agent has $5 spent
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 1000,
          outputTokens: 500,
          inputCost: 3.0,
          outputCost: 2.0,
          totalCost: 5.0,
          priced: true,
          timestamp: Date.now(),
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-daily',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'daily',
          } as BudgetLimitPolicy,
        ]);

        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(true);
      });

      it('denies when spend exceeds limit', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // Agent has $15 spent
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 5000,
          outputTokens: 2500,
          inputCost: 9.0,
          outputCost: 6.0,
          totalCost: 15.0,
          priced: true,
          timestamp: Date.now(),
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-daily',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'daily',
          } as BudgetLimitPolicy,
        ]);

        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('budget_limit');
      });

      it('returns reason with spend and limit info', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 5000,
          outputTokens: 2500,
          inputCost: 9.0,
          outputCost: 6.0,
          totalCost: 15.0,
          priced: true,
          timestamp: Date.now(),
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-daily',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'daily',
          } as BudgetLimitPolicy,
        ]);

        const result = engine.evaluate(makeContext());
        expect(result.denied).toBeDefined();
        expect(result.denied!.reason).toBeDefined();
        expect(result.denied!.reason).toContain('15.00');
        expect(result.denied!.reason).toContain('10.00');
      });

      it('respects period filter (daily)', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // $5 spent today
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 1000,
          outputTokens: 500,
          inputCost: 3.0,
          outputCost: 2.0,
          totalCost: 5.0,
          priced: true,
          timestamp: Date.now(),
        });

        // $20 spent a long time ago (won't count for daily)
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 10000,
          outputTokens: 5000,
          inputCost: 12.0,
          outputCost: 8.0,
          totalCost: 20.0,
          priced: true,
          timestamp: 1000, // very old timestamp
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-daily',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'daily',
          } as BudgetLimitPolicy,
        ]);

        // $5 today against $10 daily limit -> allowed
        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(true);
      });
    });

    // ── Weekly budget period (7-day sliding window) ──────────────

    describe('weekly budget period', () => {
      it('maps weekly period to week (7-day sliding window)', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // $8 spent 3 days ago (within 7-day window)
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 2000,
          outputTokens: 1000,
          inputCost: 5.0,
          outputCost: 3.0,
          totalCost: 8.0,
          priced: true,
          timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000,
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-weekly',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'weekly',
          } as BudgetLimitPolicy,
        ]);

        // $8 within 7-day window against $10 weekly limit -> allowed
        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(true);
      });

      it('denies when weekly spend within 7 days exceeds limit', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // $12 spent 2 days ago (within 7-day window)
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 5000,
          outputTokens: 2000,
          inputCost: 7.0,
          outputCost: 5.0,
          totalCost: 12.0,
          priced: true,
          timestamp: Date.now() - 2 * 24 * 60 * 60 * 1000,
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-weekly',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'weekly',
          } as BudgetLimitPolicy,
        ]);

        // $12 within 7-day window against $10 weekly limit -> denied
        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('budget_limit');
      });

      it('does not count costs older than 7 days for weekly budget', () => {
        const engine = new PolicyEngine();
        const aggregator = new CostAggregator();
        engine.setCostAggregator(aggregator);

        // $15 spent 10 days ago (outside 7-day window — should NOT count)
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 5000,
          outputTokens: 2500,
          inputCost: 9.0,
          outputCost: 6.0,
          totalCost: 15.0,
          priced: true,
          timestamp: Date.now() - 10 * 24 * 60 * 60 * 1000,
        });

        // $3 spent today (within 7-day window)
        aggregator.recordCost({
          agentId: 'test-agent',
          model: 'gpt-4',
          provider: 'openai',
          inputTokens: 500,
          outputTokens: 200,
          inputCost: 2.0,
          outputCost: 1.0,
          totalCost: 3.0,
          priced: true,
          timestamp: Date.now(),
        });

        engine.loadFromPolicies([
          {
            name: 'budget-10-weekly',
            type: 'budget_limit',
            enabled: true,
            scope: { level: 'global' },
            limit: 10,
            period: 'weekly',
          } as BudgetLimitPolicy,
        ]);

        // Only $3 within 7-day window against $10 weekly limit -> allowed
        // (the $15 from 10 days ago is outside the window)
        const result = engine.evaluate(makeContext());
        expect(result.allowed).toBe(true);
      });
    });

    // ── Content filter evaluator ───────────────────────────────

    describe('content filter evaluator', () => {
      /** Helper: build a content filter policy */
      function makeContentFilter(overrides: Partial<ContentFilterPolicy> = {}): ContentFilterPolicy {
        return {
          name: 'test-content-filter',
          type: 'content_filter',
          enabled: true,
          scope: { level: 'global' },
          patterns: ['ssn'],
          ...overrides,
        };
      }

      /** Helper: wrap text in an OpenAI-style messages body */
      function makeMessageBody(text: string): string {
        return JSON.stringify({
          model: 'gpt-4',
          messages: [{ role: 'user', content: text }],
        });
      }

      it('detects SSN pattern (XXX-XX-XXXX) in message content', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('my ssn is 123-45-6789'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('detects credit card pattern (16 digits) in message content', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['credit_card'] })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('pay with 4111111111111111'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('detects email pattern in message content', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['email'] })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('contact user@example.com'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('detects phone pattern in message content', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['phone'] })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('call (555) 123-4567'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('allows when no patterns match', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn', 'credit_card'] })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('hello world'),
        }));
        expect(result.allowed).toBe(true);
      });

      it('custom regex pattern works alongside built-in names', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({
          patterns: ['ssn', 'SECRET_KEY_\\w+'],
        })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('my SECRET_KEY_abc123 is here'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
      });

      it('reveal_pattern=true includes pattern name in reason', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({
          patterns: ['ssn'],
          reveal_pattern: true,
        })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('my ssn is 123-45-6789'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.reason).toBeDefined();
        expect(result.denied!.reason!.toLowerCase()).toContain('ssn');
      });

      it('reveal_pattern=false (default) gives generic message', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({
          patterns: ['ssn'],
          // reveal_pattern not set, defaults to false
        })]);

        const result = engine.evaluate(makeContext({
          body: makeMessageBody('my ssn is 123-45-6789'),
        }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.reason).toBeDefined();
        // Should NOT contain 'ssn' in the reason (generic message)
        expect(result.denied!.reason!.toLowerCase()).toContain('content blocked');
        expect(result.denied!.reason!.toLowerCase()).not.toContain('ssn');
      });

      it('handles non-JSON body gracefully', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        const result = engine.evaluate(makeContext({
          body: 'not-json',
        }));
        expect(result.allowed).toBe(true);
      });

      it('scans message content from multi-turn conversation', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        const body = JSON.stringify({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'My SSN is 123-45-6789' },
          ],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('scans multipart content arrays (vision format)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        const body = JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'My SSN is 123-45-6789' },
              { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
            ],
          }],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(false);
        expect(result.denied!.policyType).toBe('content_filter');
      });

      it('does NOT match PII-like strings in model name (metadata excluded)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        // SSN-like pattern in model name should NOT trigger content filter
        const body = JSON.stringify({
          model: '123-45-6789',
          messages: [{ role: 'user', content: 'Innocent request' }],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(true);
      });

      it('does NOT match patterns in non-message JSON fields', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['email'] })]);

        // Email in a random metadata field should NOT trigger content filter
        const body = JSON.stringify({
          model: 'gpt-4',
          user: 'admin@example.com',
          messages: [{ role: 'user', content: 'Hello' }],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(true);
      });

      it('allows body with no messages array', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeContentFilter({ patterns: ['ssn'] })]);

        // Body without messages field (e.g., legacy completion format)
        const result = engine.evaluate(makeContext({
          body: '{"prompt":"my ssn is 123-45-6789"}',
        }));
        expect(result.allowed).toBe(true);
      });
    });

    // ── ReDoS protection ──────────────────────────────────────

    describe('ReDoS protection', () => {
      it('treats unsafe regex in block policy as non-match (allows request)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([{
          name: 'redos-block',
          type: 'block',
          enabled: true,
          scope: { level: 'global' },
          match: {
            model: '(a+)+',  // ReDoS pattern
            regex: true,
          },
        } as BlockPolicy]);

        // Should NOT hang; unsafe pattern returns false (non-match = allows)
        const result = engine.evaluate(makeContext({ model: 'aaaaaaaaaaaaaaa!' }));
        expect(result.allowed).toBe(true);
      });

      it('treats unsafe regex in block path as non-match', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([{
          name: 'redos-path',
          type: 'block',
          enabled: true,
          scope: { level: 'global' },
          match: {
            path: ['(a', '+)+', '$'].join(''),
            regex: true,
          },
        } as BlockPolicy]);

        const result = engine.evaluate(makeContext({ path: 'aaaaaaaaaaaaaaa!' }));
        expect(result.allowed).toBe(true);
      });

      it('treats unsafe regex in content filter as non-match', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([{
          name: 'redos-content',
          type: 'content_filter',
          enabled: true,
          scope: { level: 'global' },
          patterns: ['(a+)+'],  // ReDoS pattern
        } as ContentFilterPolicy]);

        const body = JSON.stringify({
          messages: [{ role: 'user', content: 'aaaaaaaaaaaaaaa!' }],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(true);
      });

      it('safe regex patterns still work normally in block policies', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([{
          name: 'safe-block',
          type: 'block',
          enabled: true,
          scope: { level: 'global' },
          match: {
            model: 'gpt-4.*turbo',
            regex: true,
          },
        } as BlockPolicy]);

        const result = engine.evaluate(makeContext({ model: 'gpt-4-turbo' }));
        expect(result.allowed).toBe(false);
        expect(result.denied!.policyName).toBe('safe-block');
      });

      it('safe regex patterns still work normally in content filters', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([{
          name: 'safe-content',
          type: 'content_filter',
          enabled: true,
          scope: { level: 'global' },
          patterns: ['SECRET_KEY_\\w+'],
        } as ContentFilterPolicy]);

        const body = JSON.stringify({
          messages: [{ role: 'user', content: 'Here is SECRET_KEY_abc123' }],
        });
        const result = engine.evaluate(makeContext({ body }));
        expect(result.allowed).toBe(false);
        expect(result.denied!.policyName).toBe('safe-content');
      });
    });

    // ── Time window evaluator ──────────────────────────────────

    describe('time window evaluator', () => {
      /** Helper: build a time window policy */
      function makeTimeWindow(overrides: Partial<TimeWindowPolicy> = {}): TimeWindowPolicy {
        return {
          name: 'test-time-window',
          type: 'time_window',
          enabled: true,
          scope: { level: 'global' },
          start: '09:00',
          end: '17:00',
          days: ['weekdays'],
          timezone: 'UTC',
          mode: 'allow',
          ...overrides,
        };
      }

      /** Helper: create a Date for a specific UTC time on a specific day of the week */
      function makeUtcDate(dayOfWeek: string, hour: number, minute: number): Date {
        // 2026-02-23 is a Monday
        const dayOffsets: Record<string, number> = {
          monday: 0, tuesday: 1, wednesday: 2, thursday: 3,
          friday: 4, saturday: 5, sunday: 6,
        };
        const offset = dayOffsets[dayOfWeek] ?? 0;
        const date = new Date(Date.UTC(2026, 1, 23 + offset, hour, minute, 0, 0));
        return date;
      }

      it('allow mode: allows during configured window', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '09:00',
          end: '17:00',
          days: ['weekdays'],
          timezone: 'UTC',
        })]);

        // Wednesday 12:00 UTC — within window
        const now = makeUtcDate('wednesday', 12, 0);
        const result = engine.evaluate(makeContext(), { now: now.getTime() });
        expect(result.allowed).toBe(true);
      });

      it('allow mode: denies outside configured window', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '09:00',
          end: '17:00',
          days: ['weekdays'],
          timezone: 'UTC',
        })]);

        // Wednesday 20:00 UTC — outside window
        const now = makeUtcDate('wednesday', 20, 0);
        const result = engine.evaluate(makeContext(), { now: now.getTime() });
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('time_window');
      });

      it('deny mode: blocks during configured window', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'deny',
          start: '22:00',
          end: '06:00',
          days: ['daily'],
          timezone: 'UTC',
        })]);

        // Wednesday 23:00 UTC — within deny window
        const now = makeUtcDate('wednesday', 23, 0);
        const result = engine.evaluate(makeContext(), { now: now.getTime() });
        expect(result.allowed).toBe(false);
        expect(result.denied).toBeDefined();
        expect(result.denied!.policyType).toBe('time_window');
      });

      it('deny mode: allows outside configured window', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'deny',
          start: '22:00',
          end: '06:00',
          days: ['daily'],
          timezone: 'UTC',
        })]);

        // Wednesday 12:00 UTC — outside deny window
        const now = makeUtcDate('wednesday', 12, 0);
        const result = engine.evaluate(makeContext(), { now: now.getTime() });
        expect(result.allowed).toBe(true);
      });

      it('respects IANA timezone', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '09:00',
          end: '17:00',
          days: ['weekdays'],
          timezone: 'America/New_York',
        })]);

        // 14:00 UTC on a Wednesday in February = 09:00 ET (EST, UTC-5) -> within window
        const nowInWindow = new Date(Date.UTC(2026, 1, 25, 14, 0, 0, 0));
        const r1 = engine.evaluate(makeContext(), { now: nowInWindow.getTime() });
        expect(r1.allowed).toBe(true);

        // 22:00 UTC on a Wednesday = 17:00 ET -> at or past end of window -> denied
        const nowOutside = new Date(Date.UTC(2026, 1, 25, 22, 0, 0, 0));
        const r2 = engine.evaluate(makeContext(), { now: nowOutside.getTime() });
        expect(r2.allowed).toBe(false);
      });

      it('weekdays preset matches Monday-Friday', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '00:00',
          end: '23:59',
          days: ['weekdays'],
          timezone: 'UTC',
        })]);

        // Wednesday 12:00 UTC — weekday -> allowed
        const weekday = makeUtcDate('wednesday', 12, 0);
        const r1 = engine.evaluate(makeContext(), { now: weekday.getTime() });
        expect(r1.allowed).toBe(true);

        // Saturday 12:00 UTC — weekend -> denied
        const weekend = makeUtcDate('saturday', 12, 0);
        const r2 = engine.evaluate(makeContext(), { now: weekend.getTime() });
        expect(r2.allowed).toBe(false);
      });

      it('weekends preset matches Saturday-Sunday', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '00:00',
          end: '23:59',
          days: ['weekends'],
          timezone: 'UTC',
        })]);

        // Saturday 12:00 UTC -> allowed
        const saturday = makeUtcDate('saturday', 12, 0);
        const r1 = engine.evaluate(makeContext(), { now: saturday.getTime() });
        expect(r1.allowed).toBe(true);

        // Monday 12:00 UTC -> denied
        const monday = makeUtcDate('monday', 12, 0);
        const r2 = engine.evaluate(makeContext(), { now: monday.getTime() });
        expect(r2.allowed).toBe(false);
      });

      it('individual day names work', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '00:00',
          end: '23:59',
          days: ['monday', 'wednesday', 'friday'],
          timezone: 'UTC',
        })]);

        // Wednesday 12:00 UTC -> allowed
        const wednesday = makeUtcDate('wednesday', 12, 0);
        const r1 = engine.evaluate(makeContext(), { now: wednesday.getTime() });
        expect(r1.allowed).toBe(true);

        // Thursday 12:00 UTC -> denied
        const thursday = makeUtcDate('thursday', 12, 0);
        const r2 = engine.evaluate(makeContext(), { now: thursday.getTime() });
        expect(r2.allowed).toBe(false);
      });

      it('daily preset matches every day', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '09:00',
          end: '17:00',
          days: ['daily'],
          timezone: 'UTC',
        })]);

        // Saturday 12:00 UTC -> allowed (daily = every day)
        const saturday = makeUtcDate('saturday', 12, 0);
        const r1 = engine.evaluate(makeContext(), { now: saturday.getTime() });
        expect(r1.allowed).toBe(true);

        // Wednesday 12:00 UTC -> also allowed
        const wednesday = makeUtcDate('wednesday', 12, 0);
        const r2 = engine.evaluate(makeContext(), { now: wednesday.getTime() });
        expect(r2.allowed).toBe(true);
      });

      it('handles overnight window (end < start)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeTimeWindow({
          mode: 'allow',
          start: '22:00',
          end: '06:00',
          days: ['daily'],
          timezone: 'UTC',
        })]);

        // 23:00 UTC -> within overnight window -> allowed
        const nighttime = makeUtcDate('wednesday', 23, 0);
        const r1 = engine.evaluate(makeContext(), { now: nighttime.getTime() });
        expect(r1.allowed).toBe(true);

        // 12:00 UTC -> outside overnight window -> denied
        const daytime = makeUtcDate('wednesday', 12, 0);
        const r2 = engine.evaluate(makeContext(), { now: daytime.getTime() });
        expect(r2.allowed).toBe(false);
      });
    });

    // ── Model route evaluator ────────────────────────────────────

    describe('model_route evaluator', () => {
      /** Helper: build a model route policy */
      function makeModelRoute(overrides: Partial<ModelRoutePolicy> = {}): ModelRoutePolicy {
        return {
          name: 'test-model-route',
          type: 'model_route',
          enabled: true,
          scope: { level: 'global' },
          rules: [],
          ...overrides,
        };
      }

      /** Helper: make a date for a specific UTC hour/minute (Wednesday 2026-02-25) */
      function makeUtcTime(hour: number, minute: number): number {
        return new Date(Date.UTC(2026, 1, 25, hour, minute, 0, 0)).getTime();
      }

      // (a) input_tokens_estimate matching
      it('routes to cheap model when input_tokens_estimate < 500 and estimate is 200', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { input_tokens_estimate: '<500' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ inputTokensEstimate: 200 }));
        expect(result.allowed).toBe(true);
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult).toBeDefined();
        expect(routeResult.routeTo).toBe('cheap-model');
        expect(routeResult.matchedRuleIndex).toBe(0);
      });

      it('does NOT match input_tokens_estimate < 500 when estimate is 800', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { input_tokens_estimate: '<500' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ inputTokensEstimate: 800 }));
        expect(result.allowed).toBe(true);
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult).toBeDefined();
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (b) system_prompt_contains matching
      it('matches when system_prompt_contains keyword is present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { system_prompt_contains: ['architect', 'design'] }, route_to: 'premium-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ systemPrompt: 'You are a software architect' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('premium-model');
      });

      it('does NOT match system_prompt_contains when no keyword is present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { system_prompt_contains: ['architect', 'design'] }, route_to: 'premium-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ systemPrompt: 'write a poem' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (c) no_system_prompt_contains matching
      it('matches no_system_prompt_contains when none of the forbidden keywords are present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { no_system_prompt_contains: ['debug', 'security'] }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ systemPrompt: 'write code' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('cheap-model');
      });

      it('does NOT match no_system_prompt_contains when forbidden keyword is present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { no_system_prompt_contains: ['debug', 'security'] }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ systemPrompt: 'debug the issue' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (d) user_prompt_contains matching
      it('matches user_prompt_contains when keyword is present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { user_prompt_contains: ['hello'] }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ userPrompt: 'hello world' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('cheap-model');
      });

      it('does NOT match user_prompt_contains when keyword is absent', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { user_prompt_contains: ['hello'] }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ userPrompt: 'goodbye' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (e) no_user_prompt_contains matching
      it('does NOT match no_user_prompt_contains when forbidden keyword is present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { no_user_prompt_contains: ['complex'] }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ userPrompt: 'complex analysis' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (f) agent wildcard matching
      it('agent "*" wildcard matches any agent', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: '*' }, route_to: 'default-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ agentId: 'random-agent-42' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('default-model');
      });

      it('agent literal matches only that agent', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: 'research-bot' }, route_to: 'premium-model' },
          ],
        })]);

        // Matching agent
        const r1 = engine.evaluate(makeContext({ agentId: 'research-bot' }));
        const routeResult1 = r1.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult1.routeTo).toBe('premium-model');

        // Non-matching agent
        const r2 = engine.evaluate(makeContext({ agentId: 'other-agent' }));
        const routeResult2 = r2.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult2.routeTo).toBeUndefined();
      });

      // (g) time_of_day matching
      it('time_of_day matches within range', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { time_of_day: '09:00-17:00' }, route_to: 'daytime-model' },
          ],
        })]);

        // 12:00 UTC - within range
        const result = engine.evaluate(makeContext(), { now: makeUtcTime(12, 0) });
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('daytime-model');
      });

      it('time_of_day does NOT match outside range', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { time_of_day: '09:00-17:00' }, route_to: 'daytime-model' },
          ],
        })]);

        // 22:00 UTC - outside range
        const result = engine.evaluate(makeContext(), { now: makeUtcTime(22, 0) });
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (h) tool_calls_present matching
      it('tool_calls_present: true matches when tools are present', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { tool_calls_present: true }, route_to: 'tool-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ toolCallsPresent: true }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('tool-model');
      });

      it('tool_calls_present: true does NOT match when tools are absent', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { tool_calls_present: true }, route_to: 'tool-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ toolCallsPresent: false }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (i) conversation_turns matching
      it('conversation_turns < 3 matches when turns is 1', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { conversation_turns: '<3' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ conversationTurns: 1 }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('cheap-model');
      });

      it('conversation_turns < 3 does NOT match when turns is 5', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { conversation_turns: '<3' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ conversationTurns: 5 }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (j) provider matching
      it('provider matches openai requests', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { provider: 'openai' }, route_to: 'gpt-4o-mini' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ provider: 'openai' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('gpt-4o-mini');
      });

      it('provider does NOT match non-matching provider', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { provider: 'openai' }, route_to: 'gpt-4o-mini' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ provider: 'anthropic' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (k) Model alias resolution
      it('resolves model alias via model_aliases', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { input_tokens_estimate: '<500' }, route_to: 'cheap' },
          ],
          model_aliases: { cheap: 'claude-haiku-4-5-20251001' },
        })]);

        const result = engine.evaluate(makeContext({ inputTokensEstimate: 200 }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('claude-haiku-4-5-20251001');
      });

      // (l) Passthrough default: no rule match returns request unchanged
      it('returns passthrough when no rule matches', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { input_tokens_estimate: '<500' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ inputTokensEstimate: 1000 }));
        expect(result.allowed).toBe(true);
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (m) First matching rule wins
      it('first matching rule wins when multiple rules match', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: '*' }, route_to: 'first-model' },
            { when: { agent: '*' }, route_to: 'second-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext());
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBe('first-model');
        expect(routeResult.matchedRuleIndex).toBe(0);
      });

      // (n) max_downgrade_level prevents routing below configured tier
      it('max_downgrade_level blocks routing below configured tier', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: '*' }, route_to: 'cheap' },
          ],
          model_aliases: {
            cheap: 'claude-haiku-4-5-20251001',
            standard: 'claude-sonnet-4-5-20250929',
            premium: 'claude-opus-4-20250929',
          },
          max_downgrade_level: 'standard',
        })]);

        const result = engine.evaluate(makeContext());
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        // cheap is tier 0, standard is tier 1; cheap < standard -> blocked, passthrough
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (o) Per-agent opt-out: routing:disabled
      it('per-agent opt-out always returns passthrough', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: '*' }, route_to: 'cheap-model' },
          ],
          routing_opt_out_agents: ['privileged-agent'],
        })]);

        const result = engine.evaluate(makeContext({ agentId: 'privileged-agent' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // (p) All criteria AND logic
      it('all criteria in a rule must match (AND logic)', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            {
              when: {
                input_tokens_estimate: '<500',
                agent: 'simple-bot',
                tool_calls_present: false,
              },
              route_to: 'cheap-model',
            },
          ],
        })]);

        // All match -> routes
        const r1 = engine.evaluate(makeContext({
          agentId: 'simple-bot',
          inputTokensEstimate: 200,
          toolCallsPresent: false,
        }));
        const route1 = r1.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(route1.routeTo).toBe('cheap-model');

        // One criterion fails (different agent) -> passthrough
        const r2 = engine.evaluate(makeContext({
          agentId: 'different-bot',
          inputTokensEstimate: 200,
          toolCallsPresent: false,
        }));
        const route2 = r2.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(route2.routeTo).toBeUndefined();
      });

      // (q) default: passthrough rule
      it('explicit default passthrough rule returns passthrough', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: 'nonexistent' }, route_to: 'never-match' },
            { default: 'passthrough', route_to: '' },
          ],
        })]);

        const result = engine.evaluate(makeContext());
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.routeTo).toBeUndefined();
      });

      // Additional: requestedModel is set from context.model
      it('requestedModel is set from context.model', () => {
        const engine = new PolicyEngine();
        engine.loadFromPolicies([makeModelRoute({
          rules: [
            { when: { agent: '*' }, route_to: 'cheap-model' },
          ],
        })]);

        const result = engine.evaluate(makeContext({ model: 'gpt-4' }));
        const routeResult = result.results.find(r => r.policyType === 'model_route') as ModelRouteResult;
        expect(routeResult.requestedModel).toBe('gpt-4');
      });
    });
  });
});
