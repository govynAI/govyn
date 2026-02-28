import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PolicySummary, PolicyType } from "@/types/api";

type SortKey = "name" | "type" | "scope" | "enabled";
type SortDir = "asc" | "desc";

interface PolicyTableProps {
  policies: PolicySummary[];
  loading?: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}

/** Badge color mapping for each policy type */
const TYPE_COLORS: Record<PolicyType, string> = {
  block: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  rate_limit: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  budget_limit: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  content_filter: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  time_window: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  model_route: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  require_approval: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

/** Human-readable label for policy types */
const TYPE_LABELS: Record<PolicyType, string> = {
  block: "Block",
  rate_limit: "Rate Limit",
  budget_limit: "Budget",
  content_filter: "Content Filter",
  time_window: "Time Window",
  model_route: "Model Route",
  require_approval: "Approval",
};

/** Format scope for display */
function formatScope(scope: PolicySummary["scope"]): string {
  switch (scope.level) {
    case "global":
      return "Global";
    case "agent":
      return `Agent: ${scope.value ?? ""}`;
    case "target":
      return `Target: ${scope.value ?? ""}`;
    default:
      return String(scope.level);
  }
}

/** Scope badge variant */
function scopeBadgeClass(level: string): string {
  switch (level) {
    case "global":
      return "bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300";
    case "agent":
      return "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400";
    case "target":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400";
    default:
      return "";
  }
}

/**
 * Inline toggle switch for enabled/disabled.
 */
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
 * Sortable policy table with type badges, scope labels, and inline toggle switches.
 * Follows the AgentCostTable pattern: sortable columns, row click navigation,
 * loading skeletons.
 */
export function PolicyTable({ policies, loading, onToggle }: PolicyTableProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedPolicies = useMemo(() => {
    const sorted = [...policies];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "scope":
          cmp = a.scope.level.localeCompare(b.scope.level);
          break;
        case "enabled":
          cmp = Number(a.enabled) - Number(b.enabled);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [policies, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortDir === "asc" ? (
      <ChevronUp className="inline size-3.5" />
    ) : (
      <ChevronDown className="inline size-3.5" />
    );
  }

  const headerClass =
    "px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)] cursor-pointer select-none hover:text-[var(--foreground)] transition-colors";

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} text-left`}>Name</th>
              <th className={`${headerClass} text-left`}>Type</th>
              <th className={`${headerClass} text-left`}>Scope</th>
              <th className={`${headerClass} text-center`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="h-4 w-36 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-20 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="mx-auto h-5 w-9 animate-pulse rounded-full bg-[var(--muted)]" />
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
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("name")}
            >
              Name <SortIcon column="name" />
            </th>
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("type")}
            >
              Type <SortIcon column="type" />
            </th>
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("scope")}
            >
              Scope <SortIcon column="scope" />
            </th>
            <th
              className={`${headerClass} text-center`}
              onClick={() => toggleSort("enabled")}
            >
              Status <SortIcon column="enabled" />
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedPolicies.map((policy) => (
            <tr
              key={policy.name}
              className="border-b border-[var(--border)] hover:bg-[var(--muted)]/50 cursor-pointer transition-colors"
              onClick={() =>
                navigate(`/policies/${encodeURIComponent(policy.name)}`)
              }
            >
              <td className="px-4 py-3">
                <div className="font-medium text-[var(--foreground)]">
                  {policy.name}
                </div>
                {policy.description && (
                  <div className="mt-0.5 text-xs text-[var(--muted-foreground)] line-clamp-1">
                    {policy.description}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="secondary"
                  className={TYPE_COLORS[policy.type]}
                >
                  {TYPE_LABELS[policy.type]}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge
                  variant="secondary"
                  className={scopeBadgeClass(policy.scope.level)}
                >
                  {formatScope(policy.scope)}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center">
                  <ToggleSwitch
                    checked={policy.enabled}
                    onChange={(enabled) => onToggle(policy.name, enabled)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
