import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AlertRule, AlertRuleType, BudgetThresholdConfig, PolicyTriggerConfig } from "@/types/api";

interface AlertRulesTableProps {
  rules: AlertRule[];
  loading: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: string) => void;
}

/** Badge colors for alert rule types */
const TYPE_STYLES: Record<AlertRuleType, { className: string; label: string }> = {
  budget_threshold: {
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    label: "Budget",
  },
  policy_trigger: {
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    label: "Policy",
  },
};

/** Format config into human-readable condition string */
function formatCondition(rule: AlertRule): string {
  if (rule.type === "budget_threshold") {
    const config = rule.config as BudgetThresholdConfig;
    const agent = config.agent_id === "*" ? "All agents" : `Agent ${config.agent_id}`;
    return `${agent} > ${config.threshold_percent}% ${config.metric}`;
  }
  const config = rule.config as PolicyTriggerConfig;
  const policy = config.policy_name === "*" ? "Any policy" : `Policy ${config.policy_name}`;
  const agent = config.agent_id === "*" ? "all agents" : `Agent ${config.agent_id}`;
  return `${policy}, ${agent}`;
}

/** Format an ISO date string as a relative time-ago string */
function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));

  if (diffSec < 60) return "<1m ago";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m ago` : `${hours}h ago`;
  }
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;

  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Inline toggle switch for enabled/disabled */
function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
        border-2 border-transparent transition-colors duration-200 ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2
        ${checked ? "bg-emerald-500" : "bg-[var(--muted)]"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm
          ring-0 transition-transform duration-200 ease-in-out
          ${checked ? "translate-x-4" : "translate-x-0.5"}
        `}
      />
    </button>
  );
}

/**
 * Table displaying configured alert rules with type badges, condition summaries,
 * toggle switches, and edit/delete actions.
 */
export function AlertRulesTable({
  rules,
  loading,
  onToggle,
  onEdit,
  onDelete,
}: AlertRulesTableProps) {
  const headerClass =
    "px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] select-none";

  // Loading skeleton
  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} text-left`}>Name</th>
              <th className={`${headerClass} text-left`}>Type</th>
              <th className={`${headerClass} text-left`}>Condition</th>
              <th className={`${headerClass} text-left`}>Webhook</th>
              <th className={`${headerClass} text-center`}>Status</th>
              <th className={`${headerClass} text-right`}>Last Fired</th>
              <th className={`${headerClass} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-36 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="mx-auto h-5 w-9 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="ml-auto h-6 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className={`${headerClass} text-left`}>Name</th>
            <th className={`${headerClass} text-left`}>Type</th>
            <th className={`${headerClass} text-left`}>Condition</th>
            <th className={`${headerClass} text-left`}>Webhook</th>
            <th className={`${headerClass} text-center`}>Status</th>
            <th className={`${headerClass} text-right`}>Last Fired</th>
            <th className={`${headerClass} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => {
            const typeStyle = TYPE_STYLES[rule.type];
            return (
              <tr
                key={rule.id}
                className="border-b border-[var(--border)] hover:bg-[var(--muted)]/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-[var(--foreground)]">
                    {rule.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={typeStyle.className}>
                    {typeStyle.label}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  {formatCondition(rule)}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  <span
                    title={rule.webhook_url}
                    className="inline-block max-w-[200px] truncate"
                  >
                    {rule.webhook_url}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <ToggleSwitch
                      checked={rule.enabled}
                      onChange={(enabled) => onToggle(rule.id, enabled)}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm text-[var(--muted-foreground)]">
                  {rule.last_fired_at
                    ? formatTimeAgo(rule.last_fired_at)
                    : "\u2014"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(rule);
                      }}
                      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                      title="Edit rule"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(rule.id);
                      }}
                      className="inline-flex size-7 items-center justify-center rounded-md text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300 transition-colors"
                      title="Delete rule"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
