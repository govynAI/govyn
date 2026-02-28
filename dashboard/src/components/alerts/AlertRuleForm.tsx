import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AlertRule,
  AlertRuleCreatePayload,
  AlertRuleType,
  BudgetThresholdConfig,
  PolicyTriggerConfig,
} from "@/types/api";

interface AlertRuleFormProps {
  open: boolean;
  editingRule: AlertRule | null;
  onSave: (payload: AlertRuleCreatePayload) => Promise<void>;
  onTestWebhook: (url: string) => Promise<{ success: boolean; status?: number; error?: string }>;
  onClose: () => void;
}

interface WebhookTestState {
  testing: boolean;
  result: { success: boolean; status?: number; error?: string } | null;
}

/**
 * Modal form for creating or editing an alert rule.
 * Supports budget threshold and policy trigger types with
 * conditional fields, inline validation, and webhook testing.
 */
export function AlertRuleForm({
  open,
  editingRule,
  onSave,
  onTestWebhook,
  onClose,
}: AlertRuleFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AlertRuleType>("budget_threshold");
  const [agentId, setAgentId] = useState("*");
  const [metric, setMetric] = useState<"daily" | "monthly">("daily");
  const [thresholdPercent, setThresholdPercent] = useState(80);
  const [policyName, setPolicyName] = useState("*");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [cooldownMinutes, setCooldownMinutes] = useState(60);
  const [saving, setSaving] = useState(false);
  const [webhookTest, setWebhookTest] = useState<WebhookTestState>({
    testing: false,
    result: null,
  });

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;

    setWebhookTest({ testing: false, result: null });
    setSaving(false);

    if (editingRule) {
      setName(editingRule.name);
      setType(editingRule.type);
      setWebhookUrl(editingRule.webhook_url);
      setCooldownMinutes(editingRule.cooldown_minutes);

      if (editingRule.type === "budget_threshold") {
        const config = editingRule.config as BudgetThresholdConfig;
        setAgentId(config.agent_id);
        setMetric(config.metric);
        setThresholdPercent(config.threshold_percent);
        setPolicyName("*");
      } else {
        const config = editingRule.config as PolicyTriggerConfig;
        setPolicyName(config.policy_name);
        setAgentId(config.agent_id);
        setMetric("daily");
        setThresholdPercent(80);
      }
    } else {
      setName("");
      setType("budget_threshold");
      setAgentId("*");
      setMetric("daily");
      setThresholdPercent(80);
      setPolicyName("*");
      setWebhookUrl("");
      setCooldownMinutes(60);
    }
  }, [open, editingRule]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Validation
  const nameValid = name.trim().length > 0;
  const webhookValid =
    webhookUrl.trim().length > 0 &&
    (webhookUrl.startsWith("http://") || webhookUrl.startsWith("https://"));
  const thresholdValid = thresholdPercent >= 1 && thresholdPercent <= 100;
  const formValid = nameValid && webhookValid && (type === "policy_trigger" || thresholdValid);

  const handleTestWebhook = useCallback(async () => {
    if (!webhookValid) return;
    setWebhookTest({ testing: true, result: null });
    const result = await onTestWebhook(webhookUrl);
    setWebhookTest({ testing: false, result });
  }, [webhookUrl, webhookValid, onTestWebhook]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid || saving) return;

    const config: BudgetThresholdConfig | PolicyTriggerConfig =
      type === "budget_threshold"
        ? { agent_id: agentId.trim() || "*", metric, threshold_percent: thresholdPercent }
        : { policy_name: policyName.trim() || "*", agent_id: agentId.trim() || "*" };

    const payload: AlertRuleCreatePayload = {
      name: name.trim(),
      type,
      config,
      webhook_url: webhookUrl.trim(),
      cooldown_minutes: cooldownMinutes,
      enabled: true,
    };

    setSaving(true);
    try {
      await onSave(payload);
    } catch {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          {editingRule ? "Edit Alert Rule" : "Create Alert Rule"}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {editingRule
            ? "Update the alert rule configuration"
            : "Configure a new budget threshold or policy trigger alert"}
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Name</Label>
            <Input
              id="alert-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., High Spend Warning"
              required
            />
            {name.length > 0 && !nameValid && (
              <p className="text-xs text-red-500">Name is required</p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Alert Type</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="alert-type"
                  checked={type === "budget_threshold"}
                  onChange={() => setType("budget_threshold")}
                  className="accent-emerald-500"
                />
                <span className="text-sm text-[var(--foreground)]">Budget Threshold</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="alert-type"
                  checked={type === "policy_trigger"}
                  onChange={() => setType("policy_trigger")}
                  className="accent-emerald-500"
                />
                <span className="text-sm text-[var(--foreground)]">Policy Trigger</span>
              </label>
            </div>
          </div>

          {/* Conditional fields: Budget Threshold */}
          {type === "budget_threshold" && (
            <div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/20 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="budget-agent">Agent ID</Label>
                <Input
                  id="budget-agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="* for all agents"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="budget-metric">Metric</Label>
                  <select
                    id="budget-metric"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as "daily" | "monthly")}
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    <option value="daily">Daily</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="budget-threshold">Threshold %</Label>
                  <Input
                    id="budget-threshold"
                    type="number"
                    min={1}
                    max={100}
                    value={thresholdPercent}
                    onChange={(e) => setThresholdPercent(Number(e.target.value))}
                  />
                  {(thresholdPercent < 1 || thresholdPercent > 100) && (
                    <p className="text-xs text-red-500">Must be 1-100</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Conditional fields: Policy Trigger */}
          {type === "policy_trigger" && (
            <div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--muted)]/20 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="policy-name">Policy Name</Label>
                <Input
                  id="policy-name"
                  value={policyName}
                  onChange={(e) => setPolicyName(e.target.value)}
                  placeholder="* for any policy"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="policy-agent">Agent ID</Label>
                <Input
                  id="policy-agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  placeholder="* for all agents"
                />
              </div>
            </div>
          )}

          {/* Webhook URL with test button */}
          <div className="space-y-1.5">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  id="webhook-url"
                  value={webhookUrl}
                  onChange={(e) => {
                    setWebhookUrl(e.target.value);
                    setWebhookTest({ testing: false, result: null });
                  }}
                  placeholder="https://hooks.slack.com/..."
                  required
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestWebhook}
                disabled={!webhookValid || webhookTest.testing}
                className="shrink-0 h-9"
              >
                {webhookTest.testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  "Test"
                )}
              </Button>
            </div>
            {webhookUrl.length > 0 && !webhookValid && (
              <p className="text-xs text-red-500">Must start with http:// or https://</p>
            )}
            {webhookTest.result && (
              <div
                className={`flex items-center gap-1.5 text-xs ${
                  webhookTest.result.success
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {webhookTest.result.success ? (
                  <>
                    <Check className="size-3.5" />
                    <span>
                      Webhook OK{webhookTest.result.status ? ` (${webhookTest.result.status})` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <X className="size-3.5" />
                    <span>{webhookTest.result.error || "Webhook test failed"}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Cooldown */}
          <div className="space-y-1.5">
            <Label htmlFor="cooldown">Cooldown (minutes)</Label>
            <Input
              id="cooldown"
              type="number"
              min={0}
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(Number(e.target.value))}
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              Minimum time between repeated alerts for the same rule
            </p>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!formValid || saving}>
              {saving
                ? "Saving..."
                : editingRule
                  ? "Update Rule"
                  : "Create Rule"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
