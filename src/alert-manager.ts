/**
 * Alert manager for the Govyn proxy.
 *
 * Subscribes to govynEvents and evaluates incoming events against configured
 * alert rules. When a rule matches, delivers a webhook POST to the configured
 * URL and records the alert in the alert_history table.
 *
 * Supports two rule types:
 * - budget_threshold: fires on budget_warning/budget_exceeded events
 * - policy_trigger: fires on policy_denied events
 */

import type postgres from 'postgres';
import { govynEvents, type GovynEvent } from './events.js';

export interface AlertRule {
  id: string;
  name: string;
  type: 'budget_threshold' | 'policy_trigger';
  enabled: boolean;
  config: BudgetThresholdConfig | PolicyTriggerConfig;
  webhookUrl: string;
  cooldownMinutes: number;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BudgetThresholdConfig {
  agent_id: string;    // specific agent or '*' for all
  metric: 'daily' | 'monthly';
  threshold_percent: number;
}

export interface PolicyTriggerConfig {
  policy_name: string; // specific policy name or '*' for any
  agent_id: string;    // specific agent or '*' for all
}

export interface AlertHistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  webhookUrl: string;
  webhookStatus: number | null;
  webhookError: string | null;
  firedAt: string;
}

export class AlertManager {
  private sql: postgres.Sql;
  private rules: AlertRule[] = [];
  private cooldownCache: Map<string, Date> = new Map();
  private eventHandler: ((event: GovynEvent) => void) | null = null;

  constructor(sql: postgres.Sql) {
    this.sql = sql;
  }

  /**
   * Load rules from DB and subscribe to govynEvents.
   */
  async start(): Promise<void> {
    await this.reloadRules();

    this.eventHandler = (event: GovynEvent) => {
      this.handleEvent(event).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[alert-manager] Error handling event:', msg);
      });
    };

    govynEvents.on('event', this.eventHandler);
  }

  /**
   * Unsubscribe from events.
   */
  stop(): void {
    if (this.eventHandler) {
      govynEvents.removeListener('event', this.eventHandler);
      this.eventHandler = null;
    }
  }

  /**
   * Reload all rules from the database.
   */
  async reloadRules(): Promise<void> {
    const rows = await this.sql`SELECT * FROM alert_rules ORDER BY created_at DESC`;

    this.rules = rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      type: row.type as 'budget_threshold' | 'policy_trigger',
      enabled: row.enabled as boolean,
      config: row.config as BudgetThresholdConfig | PolicyTriggerConfig,
      webhookUrl: row.webhook_url as string,
      cooldownMinutes: row.cooldown_minutes as number,
      lastFiredAt: row.last_fired_at ? new Date(row.last_fired_at as string) : null,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }));

    // Populate cooldown cache from loaded rules
    for (const rule of this.rules) {
      if (rule.lastFiredAt) {
        this.cooldownCache.set(rule.id, rule.lastFiredAt);
      }
    }
  }

  /**
   * Handle an incoming event by evaluating all enabled rules.
   */
  async handleEvent(event: GovynEvent): Promise<void> {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (this.isInCooldown(rule)) continue;
      if (this.evaluateRule(rule, event)) {
        await this.fireAlert(rule, event);
      }
    }
  }

  /**
   * Evaluate whether a rule matches the given event.
   */
  evaluateRule(rule: AlertRule, event: GovynEvent): boolean {
    if (rule.type === 'budget_threshold') {
      return this.evaluateBudgetThreshold(rule, event);
    }
    if (rule.type === 'policy_trigger') {
      return this.evaluatePolicyTrigger(rule, event);
    }
    return false;
  }

  /**
   * Check if a rule is within its cooldown window.
   */
  isInCooldown(rule: AlertRule): boolean {
    const lastFired = this.cooldownCache.get(rule.id) ?? rule.lastFiredAt;
    if (!lastFired) return false;

    const cooldownMs = rule.cooldownMinutes * 60 * 1000;
    const cooldownEndsAt = new Date(lastFired.getTime() + cooldownMs);
    return Date.now() < cooldownEndsAt.getTime();
  }

  /**
   * Fire an alert: deliver webhook, record history, update cooldown.
   */
  async fireAlert(rule: AlertRule, event: GovynEvent): Promise<void> {
    const firedAt = new Date().toISOString();
    let webhookStatus: number | null = null;
    let webhookError: string | null = null;

    // Build webhook payload
    const payload = {
      alert: {
        rule_id: rule.id,
        rule_name: rule.name,
        rule_type: rule.type,
      },
      event: this.serializeEvent(event),
      fired_at: firedAt,
      source: 'govyn',
    };

    // Send webhook
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(rule.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Govyn-Alerts/1.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      webhookStatus = response.status;
    } catch (err) {
      webhookError = err instanceof Error ? err.message : String(err);
    }

    // Record in alert_history (even on webhook failure)
    try {
      await this.sql`
        INSERT INTO alert_history (rule_id, rule_name, rule_type, event_type, event_payload, webhook_url, webhook_status, webhook_error)
        VALUES (${rule.id}, ${rule.name}, ${rule.type}, ${event.type}, ${JSON.stringify(this.serializeEvent(event))}, ${rule.webhookUrl}, ${webhookStatus}, ${webhookError})
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[alert-manager] Failed to record alert history:', msg);
    }

    // Update last_fired_at
    try {
      await this.sql`
        UPDATE alert_rules SET last_fired_at = NOW() WHERE id = ${rule.id}
      `;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[alert-manager] Failed to update last_fired_at:', msg);
    }

    // Update in-memory cooldown cache
    this.cooldownCache.set(rule.id, new Date());

    // Emit alert_fired event
    govynEvents.emit('event', {
      type: 'alert_fired',
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.type,
      webhookUrl: rule.webhookUrl,
      webhookStatus,
    });
  }

  // ---- Private helpers ----

  private evaluateBudgetThreshold(rule: AlertRule, event: GovynEvent): boolean {
    const config = rule.config as BudgetThresholdConfig;

    if (event.type === 'budget_warning') {
      // Check agent match
      if (config.agent_id !== '*' && config.agent_id !== event.agentId) return false;
      // Check metric matches limitPeriod
      if (config.metric !== event.limitPeriod) return false;
      // Check threshold
      return event.percentUsed >= config.threshold_percent;
    }

    if (event.type === 'budget_exceeded') {
      // Check agent match
      if (config.agent_id !== '*' && config.agent_id !== event.agentId) return false;
      // budget_exceeded always exceeds any threshold
      // Check metric by inspecting the code field
      const isDaily = event.code.includes('daily');
      if (config.metric === 'daily' && !isDaily) return false;
      if (config.metric === 'monthly' && isDaily) return false;
      return true;
    }

    return false;
  }

  private evaluatePolicyTrigger(rule: AlertRule, event: GovynEvent): boolean {
    if (event.type !== 'policy_denied') return false;

    const config = rule.config as PolicyTriggerConfig;

    // Check agent match
    if (config.agent_id !== '*' && config.agent_id !== event.agentId) return false;
    // Check policy name match
    if (config.policy_name !== '*' && config.policy_name !== event.policyName) return false;

    return true;
  }

  /**
   * Convert a GovynEvent to a plain object for webhook payload / DB storage.
   * Converts camelCase event fields to snake_case for external consumption.
   */
  private serializeEvent(event: GovynEvent): Record<string, unknown> {
    const result: Record<string, unknown> = { type: event.type };

    // Convert each event type's fields to snake_case
    if (event.type === 'budget_warning') {
      result.agent_id = event.agentId;
      result.percent_used = event.percentUsed;
      result.current_spend = event.currentSpend;
      result.limit = event.limit;
      result.resets_at = event.resetsAt;
      result.limit_period = event.limitPeriod;
    } else if (event.type === 'budget_exceeded') {
      result.agent_id = event.agentId;
      result.code = event.code;
      result.limit_amount = event.limitAmount;
      result.current_spend = event.currentSpend;
      result.reset_time = event.resetTime;
    } else if (event.type === 'policy_denied') {
      result.agent_id = event.agentId;
      result.provider = event.provider;
      result.path = event.path;
      result.policy_name = event.policyName;
      result.policy_type = event.policyType;
      result.reason = event.reason;
      result.evaluation_time_ms = event.evaluationTimeMs;
      result.allowed = event.allowed;
    } else {
      // For other event types, spread all fields
      Object.assign(result, event);
    }

    return result;
  }
}
