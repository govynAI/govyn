/**
 * In-process event bus for internal Govyn notifications.
 *
 * Provides a singleton EventEmitter for budget warnings, exceeded limits,
 * and loop detection events. Consumers subscribe via govynEvents.on('event', cb).
 * This enables internal modules (logging, alerting, future webhook delivery)
 * to react to Govyn events without polling or tight coupling.
 */

import { EventEmitter } from 'node:events';

/** Event types emitted by Govyn */
export type GovynEvent =
  | {
      type: 'budget_warning';
      agentId: string;
      percentUsed: number;
      currentSpend: number;
      limit: number;
      resetsAt: string;
      limitPeriod: 'daily' | 'monthly';
    }
  | {
      type: 'budget_exceeded';
      agentId: string;
      code: string;
      limitAmount: number;
      currentSpend: number;
      resetTime: string;
    }
  | { type: 'loop_detected'; agentId: string; cooldownSeconds: number }
  | {
      type: 'policy_enforced';
      agentId: string;
      provider: string;
      path: string;
      policyCount: number;
      evaluationTimeMs: number;
      allowed: true;
    }
  | {
      type: 'policy_denied';
      agentId: string;
      provider: string;
      path: string;
      policyName: string;
      policyType: string;
      reason: string;
      evaluationTimeMs: number;
      allowed: false;
    }
  | {
      type: 'model_routed';
      agentId: string;
      provider: string;
      requestedModel: string;
      actualModel: string;
      policyName: string;
      matchedRuleIndex?: number;
    }
  | {
      type: 'policy_reloaded';
      filePath: string;
      policyCount: number;
    }
  | {
      type: 'policy_reload_failed';
      filePath: string;
      error: string;
    }
  | {
      type: 'db_write_failed';
      table: string;
      error: string;
    }
  | {
      type: 'alert_fired';
      ruleId: string;
      ruleName: string;
      ruleType: string;
      webhookUrl: string;
      webhookStatus: number | null;
    };

/** Singleton event bus — consumers subscribe via govynEvents.on('event', cb) */
export const govynEvents = new EventEmitter();
