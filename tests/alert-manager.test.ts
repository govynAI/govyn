/**
 * Tests for AlertManager (src/alert-manager.ts).
 *
 * Covers: rule evaluation for budget_threshold and policy_trigger types,
 * cooldown enforcement, webhook delivery, error handling, disabled rules,
 * wildcard matching, and alert history recording.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const { deliverWebhookJsonMock, resolveWebhookTargetMock } = vi.hoisted(() => ({
  deliverWebhookJsonMock: vi.fn(),
  resolveWebhookTargetMock: vi.fn(),
}));
vi.mock('../src/security.js', () => ({
  deliverWebhookJson: deliverWebhookJsonMock,
  resolveWebhookTarget: resolveWebhookTargetMock,
}));
import { AlertManager } from '../src/alert-manager.js';
import type { AlertRule, BudgetThresholdConfig, PolicyTriggerConfig } from '../src/alert-manager.js';
import { govynEvents } from '../src/events.js';

// ---- Helpers ----

function makeBudgetRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-budget-1',
    name: 'High spend warning',
    type: 'budget_threshold',
    enabled: true,
    config: {
      agent_id: 'research-agent',
      metric: 'daily',
      threshold_percent: 80,
    } as BudgetThresholdConfig,
    webhookUrl: 'https://hooks.example.com/budget',
    cooldownMinutes: 60,
    lastFiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makePolicyRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-policy-1',
    name: 'Block production writes alert',
    type: 'policy_trigger',
    enabled: true,
    config: {
      policy_name: 'block-production-writes',
      agent_id: 'research-agent',
    } as PolicyTriggerConfig,
    webhookUrl: 'https://hooks.example.com/policy',
    cooldownMinutes: 60,
    lastFiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Create a mock sql object that returns rules from SELECT */
function mockSql(rules: AlertRule[] = []) {
  const rows = rules.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    enabled: r.enabled,
    config: r.config,
    webhook_url: r.webhookUrl,
    cooldown_minutes: r.cooldownMinutes,
    last_fired_at: r.lastFiredAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));

  // Mock tagged template sql function
  const sqlFn = vi.fn().mockImplementation(() => Promise.resolve(rows)) as any;
  sqlFn.unsafe = vi.fn().mockResolvedValue([]);
  // The tagged template call is sql`...` which returns a promise
  // We need to handle it being called as a tagged template literal
  return sqlFn;
}

// ---- Tests ----

describe('AlertManager', () => {
  beforeEach(() => {
    resolveWebhookTargetMock.mockResolvedValue({
      ok: true,
      target: {
        normalizedUrl: 'https://hooks.example.com/test',
      },
    });
    deliverWebhookJsonMock.mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    govynEvents.removeAllListeners();
  });

  describe('evaluateRule — budget_threshold', () => {
    it('returns true when percentUsed >= threshold', () => {
      const rule = makeBudgetRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_warning',
        agentId: 'research-agent',
        percentUsed: 85,
        currentSpend: 8.5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      expect(result).toBe(true);
    });

    it('returns false when percentUsed < threshold', () => {
      const rule = makeBudgetRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_warning',
        agentId: 'research-agent',
        percentUsed: 50,
        currentSpend: 5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      expect(result).toBe(false);
    });

    it('returns true for budget_exceeded events (always >= 100%)', () => {
      const rule = makeBudgetRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_exceeded',
        agentId: 'research-agent',
        code: 'budget_exceeded_daily',
        limitAmount: 10,
        currentSpend: 12,
        resetTime: '2026-03-01T00:00:00Z',
      });

      expect(result).toBe(true);
    });

    it('returns false when agent_id does not match', () => {
      const rule = makeBudgetRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_warning',
        agentId: 'other-agent',
        percentUsed: 90,
        currentSpend: 9,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      expect(result).toBe(false);
    });

    it('matches any agent when agent_id is wildcard *', () => {
      const rule = makeBudgetRule({
        config: {
          agent_id: '*',
          metric: 'daily',
          threshold_percent: 80,
        } as BudgetThresholdConfig,
      });
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_warning',
        agentId: 'any-agent',
        percentUsed: 90,
        currentSpend: 9,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      expect(result).toBe(true);
    });

    it('returns false when metric does not match limitPeriod', () => {
      const rule = makeBudgetRule({
        config: {
          agent_id: 'research-agent',
          metric: 'monthly',
          threshold_percent: 80,
        } as BudgetThresholdConfig,
      });
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'budget_warning',
        agentId: 'research-agent',
        percentUsed: 90,
        currentSpend: 9,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      expect(result).toBe(false);
    });
  });

  describe('evaluateRule — policy_trigger', () => {
    it('returns true when policy_name matches', () => {
      const rule = makePolicyRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_denied',
        agentId: 'research-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyName: 'block-production-writes',
        policyType: 'deny',
        reason: 'Blocked by policy',
        evaluationTimeMs: 2,
        allowed: false,
      });

      expect(result).toBe(true);
    });

    it('returns false when policy_name does not match', () => {
      const rule = makePolicyRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_denied',
        agentId: 'research-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyName: 'some-other-policy',
        policyType: 'deny',
        reason: 'Blocked by policy',
        evaluationTimeMs: 2,
        allowed: false,
      });

      expect(result).toBe(false);
    });

    it('matches any policy with wildcard *', () => {
      const rule = makePolicyRule({
        config: {
          policy_name: '*',
          agent_id: 'research-agent',
        } as PolicyTriggerConfig,
      });
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_denied',
        agentId: 'research-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyName: 'any-policy-name',
        policyType: 'deny',
        reason: 'Blocked by policy',
        evaluationTimeMs: 2,
        allowed: false,
      });

      expect(result).toBe(true);
    });

    it('returns false when agent_id does not match', () => {
      const rule = makePolicyRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_denied',
        agentId: 'other-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyName: 'block-production-writes',
        policyType: 'deny',
        reason: 'Blocked by policy',
        evaluationTimeMs: 2,
        allowed: false,
      });

      expect(result).toBe(false);
    });

    it('matches any agent with wildcard * for agent_id', () => {
      const rule = makePolicyRule({
        config: {
          policy_name: 'block-production-writes',
          agent_id: '*',
        } as PolicyTriggerConfig,
      });
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_denied',
        agentId: 'any-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyName: 'block-production-writes',
        policyType: 'deny',
        reason: 'Blocked by policy',
        evaluationTimeMs: 2,
        allowed: false,
      });

      expect(result).toBe(true);
    });

    it('returns false for non-policy_denied events', () => {
      const rule = makePolicyRule();
      const manager = new AlertManager(mockSql());

      const result = manager.evaluateRule(rule, {
        type: 'policy_enforced',
        agentId: 'research-agent',
        provider: 'openai',
        path: '/v1/chat/completions',
        policyCount: 3,
        evaluationTimeMs: 2,
        allowed: true,
      });

      expect(result).toBe(false);
    });
  });

  describe('webhook delivery', () => {
    it('sends POST to configured URL with correct JSON payload', async () => {
      const rule = makeBudgetRule();
      const sql = mockSql();
      const manager = new AlertManager(sql);

      const event = {
        type: 'budget_warning' as const,
        agentId: 'research-agent',
        percentUsed: 85,
        currentSpend: 8.5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily' as const,
      };

      await manager.fireAlert(rule, event);

      expect(resolveWebhookTargetMock).toHaveBeenCalledWith('https://hooks.example.com/budget');
      expect(deliverWebhookJsonMock).toHaveBeenCalledOnce();

      const [, payload] = deliverWebhookJsonMock.mock.calls[0];
      expect(payload.alert.rule_id).toBe('rule-budget-1');
      expect(payload.alert.rule_name).toBe('High spend warning');
      expect(payload.alert.rule_type).toBe('budget_threshold');
      expect(payload.event.type).toBe('budget_warning');
      expect(payload.source).toBe('govyn');
      expect(payload.fired_at).toBeDefined();
    });

    it('records fired alert in alert_history table', async () => {
      const rule = makeBudgetRule();
      const sql = mockSql();
      const manager = new AlertManager(sql);

      const event = {
        type: 'budget_warning' as const,
        agentId: 'research-agent',
        percentUsed: 85,
        currentSpend: 8.5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily' as const,
      };

      await manager.fireAlert(rule, event);

      // Check sql was called for INSERT into alert_history and UPDATE last_fired_at
      expect(sql).toHaveBeenCalled();
      // Verify the tagged template was called (for INSERT and UPDATE)
      const calls = sql.mock.calls;
      // At least one call should have happened for DB operations
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it('handles webhook delivery failure gracefully', async () => {
      deliverWebhookJsonMock.mockRejectedValueOnce(new Error('Network error'));

      const rule = makeBudgetRule();
      const sql = mockSql();
      const manager = new AlertManager(sql);

      const event = {
        type: 'budget_warning' as const,
        agentId: 'research-agent',
        percentUsed: 85,
        currentSpend: 8.5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily' as const,
      };

      // Should not throw
      await expect(manager.fireAlert(rule, event)).resolves.not.toThrow();

      // Should still have called sql for history recording
      expect(sql).toHaveBeenCalled();
    });

    it('blocks private or loopback webhook destinations before fetch', async () => {
      resolveWebhookTargetMock.mockResolvedValueOnce({
        ok: false,
        error: 'Invalid webhook_url: private, loopback, or local-network destinations are not allowed',
      });

      const rule = makeBudgetRule({
        webhookUrl: 'http://127.0.0.1:9000/internal-hook',
      });
      const sql = mockSql();
      const manager = new AlertManager(sql);

      const event = {
        type: 'budget_warning' as const,
        agentId: 'research-agent',
        percentUsed: 85,
        currentSpend: 8.5,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily' as const,
      };

      await manager.fireAlert(rule, event);

      expect(deliverWebhookJsonMock).not.toHaveBeenCalled();
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('cooldown enforcement', () => {
    it('does not fire duplicate alerts within cooldown period', async () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const rule = makeBudgetRule({
        lastFiredAt: tenMinutesAgo,
        cooldownMinutes: 60,
      });
      const sql = mockSql([rule]);
      const manager = new AlertManager(sql);

      // Load rules
      await manager.start();

      const result = manager.isInCooldown(rule);
      expect(result).toBe(true);

      manager.stop();
    });

    it('allows alert after cooldown period has elapsed', () => {
      const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
      const rule = makeBudgetRule({
        lastFiredAt: twoHoursAgo,
        cooldownMinutes: 60,
      });
      const manager = new AlertManager(mockSql());

      const result = manager.isInCooldown(rule);
      expect(result).toBe(false);
    });

    it('allows alert when never fired before', () => {
      const rule = makeBudgetRule({ lastFiredAt: null });
      const manager = new AlertManager(mockSql());

      const result = manager.isInCooldown(rule);
      expect(result).toBe(false);
    });
  });

  describe('disabled rules', () => {
    it('skips disabled rules during event handling', async () => {
      const rule = makeBudgetRule({ enabled: false });
      const sql = mockSql([rule]);
      const manager = new AlertManager(sql);

      await manager.start();

      // Emit an event that would match the rule
      govynEvents.emit('event', {
        type: 'budget_warning',
        agentId: 'research-agent',
        percentUsed: 90,
        currentSpend: 9,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      // Small delay for async processing
      await new Promise((r) => setTimeout(r, 50));

      // Webhook should not have been called
      expect(deliverWebhookJsonMock).not.toHaveBeenCalled();

      manager.stop();
    });
  });

  describe('start and stop', () => {
    it('loads rules from DB on start and subscribes to events', async () => {
      const sql = mockSql([makeBudgetRule()]);
      const manager = new AlertManager(sql);

      await manager.start();

      // Should have loaded rules (called sql for SELECT)
      expect(sql).toHaveBeenCalled();

      manager.stop();
    });

    it('unsubscribes from events on stop', async () => {
      const sql = mockSql([makeBudgetRule()]);
      const manager = new AlertManager(sql);

      await manager.start();
      manager.stop();

      // Emit event after stop
      govynEvents.emit('event', {
        type: 'budget_warning',
        agentId: 'research-agent',
        percentUsed: 90,
        currentSpend: 9,
        limit: 10,
        resetsAt: '2026-03-01T00:00:00Z',
        limitPeriod: 'daily',
      });

      await new Promise((r) => setTimeout(r, 50));

      // No webhook calls should have been made
      expect(deliverWebhookJsonMock).not.toHaveBeenCalled();
    });
  });
});
