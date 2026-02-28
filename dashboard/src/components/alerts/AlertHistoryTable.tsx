import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AlertHistoryEntry, AlertRuleType } from "@/types/api";

interface AlertHistoryTableProps {
  alerts: AlertHistoryEntry[];
  loading: boolean;
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

/** Format webhook status as a colored badge */
function WebhookStatusBadge({ status, error }: { status: number | null; error: string | null }) {
  if (status != null && status >= 200 && status < 300) {
    return (
      <Badge
        variant="secondary"
        className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      >
        {status}
      </Badge>
    );
  }
  if (status != null) {
    return (
      <Badge
        variant="secondary"
        className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      >
        {status}
      </Badge>
    );
  }
  if (error) {
    return (
      <Badge
        variant="secondary"
        className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      >
        Failed
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400"
    >
      Pending
    </Badge>
  );
}

/** Format date as a readable timestamp */
function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Truncate JSON for preview */
function jsonPreview(payload: Record<string, unknown>, maxLength = 60): string {
  const str = JSON.stringify(payload);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/**
 * Table displaying fired alert history entries with expandable
 * event payload details.
 */
export function AlertHistoryTable({ alerts, loading }: AlertHistoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const headerClass =
    "px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] select-none";

  // Loading skeleton
  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} w-8`} />
              <th className={`${headerClass} text-left`}>Rule</th>
              <th className={`${headerClass} text-left`}>Type</th>
              <th className={`${headerClass} text-left`}>Event</th>
              <th className={`${headerClass} text-left`}>Details</th>
              <th className={`${headerClass} text-center`}>Webhook</th>
              <th className={`${headerClass} text-left`}>Error</th>
              <th className={`${headerClass} text-right`}>Fired At</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-2 py-3">
                  <div className="h-4 w-4 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-28 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-20 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="mx-auto h-5 w-12 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="ml-auto h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
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
            <th className={`${headerClass} w-8`} />
            <th className={`${headerClass} text-left`}>Rule</th>
            <th className={`${headerClass} text-left`}>Type</th>
            <th className={`${headerClass} text-left`}>Event</th>
            <th className={`${headerClass} text-left`}>Details</th>
            <th className={`${headerClass} text-center`}>Webhook</th>
            <th className={`${headerClass} text-left`}>Error</th>
            <th className={`${headerClass} text-right`}>Fired At</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const typeStyle = TYPE_STYLES[alert.rule_type];
            const isExpanded = expandedId === alert.id;

            return (
              <tr
                key={alert.id}
                className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                  isExpanded
                    ? "bg-[var(--muted)]/30"
                    : "hover:bg-[var(--muted)]/50"
                }`}
                onClick={() => setExpandedId((prev) => (prev === alert.id ? null : alert.id))}
              >
                <td className="w-8 px-2 py-3 text-[var(--muted-foreground)]">
                  <ChevronRight
                    className={`size-4 transition-transform duration-150 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-[var(--foreground)]">
                    {alert.rule_name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={typeStyle.className}>
                    {typeStyle.label}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    variant="secondary"
                    className="bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
                  >
                    {alert.event_type}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  {isExpanded ? (
                    <pre className="mt-1 max-w-md overflow-x-auto rounded bg-[var(--muted)]/50 p-2 text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(alert.event_payload, null, 2)}
                    </pre>
                  ) : (
                    <span className="font-mono text-xs">
                      {jsonPreview(alert.event_payload)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <WebhookStatusBadge
                    status={alert.webhook_status}
                    error={alert.webhook_error}
                  />
                </td>
                <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                  {alert.webhook_error || "\u2014"}
                </td>
                <td className="px-4 py-3 text-right text-sm text-[var(--muted-foreground)] whitespace-nowrap">
                  {formatTimestamp(alert.fired_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
