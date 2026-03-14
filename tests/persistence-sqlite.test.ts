import { afterEach, describe, expect, it } from 'vitest';
import { createPersistenceBackend } from '../src/persistence.js';

const createdBackends: Awaited<ReturnType<typeof createPersistenceBackend>>[] = [];

afterEach(async () => {
  while (createdBackends.length > 0) {
    const backend = createdBackends.pop();
    await backend?.close();
  }
});

describe('SQLite persistence backend', () => {
  it('supports approval request lifecycle end to end', async () => {
    const backend = await createPersistenceBackend({
      url: 'sqlite::memory:',
      failOpen: false,
      retentionDays: 90,
      approvalRetentionDays: 365,
    });
    createdBackends.push(backend);

    const created = await backend.createApprovalRequest({
      agentId: 'agent-1',
      provider: 'openai',
      model: 'gpt-4o',
      targetPath: '/v1/chat/completions',
      policyName: 'review-all',
      requestSummary: 'Hello',
      requestHash: 'hash-1',
      timeoutSeconds: 60,
    });

    const pending = await backend.getApprovalStatus(created.id);
    expect(pending?.status).toBe('pending');

    const approved = await backend.approveRequest(created.id, 'admin', 'ok');
    expect(approved).toBe(true);

    const approvedStatus = await backend.getApprovalStatus(created.id);
    expect(approvedStatus?.status).toBe('approved');
    expect(approvedStatus?.approvalToken).toBeTypeOf('string');

    const listed = await backend.listApprovals(['approved'], 10, 0, 'agent-1');
    expect(listed.total).toBe(1);
    expect(listed.approvals[0]?.policy_name).toBe('review-all');

    const tokenResult = await backend.validateAndConsumeToken(approvedStatus!.approvalToken!, {
      agentId: 'agent-1',
      targetPath: '/v1/chat/completions',
      requestHash: 'hash-1',
    });
    expect(tokenResult).toEqual({ policyName: 'review-all' });

    const reused = await backend.validateAndConsumeToken(approvedStatus!.approvalToken!, {
      agentId: 'agent-1',
      targetPath: '/v1/chat/completions',
      requestHash: 'hash-1',
    });
    expect(reused).toBeNull();
  });

  it('supports alert rules and history storage', async () => {
    const backend = await createPersistenceBackend({
      url: 'sqlite::memory:',
      failOpen: false,
      retentionDays: 90,
      approvalRetentionDays: 365,
    });
    createdBackends.push(backend);

    const rule = await backend.createRule({
      name: 'Budget warning',
      type: 'budget_threshold',
      enabled: true,
      config: {
        agent_id: '*',
        metric: 'daily',
        threshold_percent: 80,
      },
      webhookUrl: 'https://hooks.example.com/test',
      cooldownMinutes: 30,
    });

    const rules = await backend.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('Budget warning');

    await backend.recordAlertHistory({
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      eventType: 'budget_warning',
      eventPayload: { type: 'budget_warning', agent_id: 'agent-1' },
      webhookUrl: rule.webhookUrl,
      webhookStatus: 200,
      webhookError: null,
    });
    await backend.touchRuleLastFired(rule.id, new Date('2026-03-14T12:00:00.000Z'));

    const history = await backend.listHistory(10, 0, rule.id);
    expect(history.total).toBe(1);
    expect(history.alerts[0]?.rule_id).toBe(rule.id);

    const updated = await backend.updateRule({
      id: rule.id,
      enabled: false,
      cooldownMinutes: 45,
    });
    expect(updated?.enabled).toBe(false);
    expect(updated?.cooldownMinutes).toBe(45);
  });
});
