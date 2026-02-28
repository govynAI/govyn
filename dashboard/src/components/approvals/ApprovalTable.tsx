import { useState, useMemo, Fragment } from "react";
import { ChevronUp, ChevronDown, ChevronRight, Check, X } from "lucide-react";
import type { ApprovalRequest, ApprovalStatus } from "@/types/api";
import { ApprovalDetailPanel } from "./ApprovalDetailPanel";

type SortKey = "agent" | "target" | "policy" | "status" | "time";
type SortDir = "asc" | "desc";

interface ApprovalTableProps {
  approvals: ApprovalRequest[];
  loading?: boolean;
  showActions?: boolean;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
}

/** Status badge color mapping */
const STATUS_STYLES: Record<
  ApprovalStatus,
  { bg: string; text: string; label: string }
> = {
  pending: {
    bg: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-400",
    label: "Pending",
  },
  approved: {
    bg: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-800 dark:text-green-400",
    label: "Approved",
  },
  denied: {
    bg: "bg-red-100 dark:bg-red-900/30",
    text: "text-red-800 dark:text-red-400",
    label: "Denied",
  },
  denied_timeout: {
    bg: "bg-gray-100 dark:bg-gray-800/40",
    text: "text-gray-600 dark:text-gray-400",
    label: "Timed Out",
  },
};

/**
 * Format an ISO date string as a relative time-ago string.
 * Returns "<1m ago", "Nm ago", "Nh Nm ago", "Nd ago", or a formatted date.
 */
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

  // Older than 7 days: show short date
  return new Date(isoString).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Truncate text with title attribute for full text on hover */
function Truncated({
  text,
  maxLength = 40,
}: {
  text: string;
  maxLength?: number;
}) {
  if (text.length <= maxLength) return <span>{text}</span>;
  return <span title={text}>{text.slice(0, maxLength)}...</span>;
}

/**
 * Sortable approval table with status badges, time-ago display,
 * row-click detail expansion, and optional approve/deny action buttons.
 */
export function ApprovalTable({
  approvals,
  loading,
  showActions,
  onApprove,
  onDeny,
}: ApprovalTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedApprovals = useMemo(() => {
    const sorted = [...approvals];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "agent":
          cmp = a.agent_id.localeCompare(b.agent_id);
          break;
        case "target":
          cmp = a.target_path.localeCompare(b.target_path);
          break;
        case "policy":
          cmp = a.policy_name.localeCompare(b.policy_name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "time": {
          const aTime = a.status === "pending" ? a.created_at : a.decided_at ?? a.created_at;
          const bTime = b.status === "pending" ? b.created_at : b.decided_at ?? b.created_at;
          cmp = new Date(aTime).getTime() - new Date(bTime).getTime();
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [approvals, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "agent" || key === "policy" ? "asc" : "desc");
    }
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
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

  // Determine actual column count for skeletons and empty states
  const baseColumns = 6; // chevron + agent + target + policy + status + time
  const actualColCount = showActions
    ? baseColumns + 1 // + actions
    : baseColumns + 2; // + decided_by + notes

  // Loading skeleton
  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} w-8`} />
              <th className={`${headerClass} text-left`}>Agent</th>
              <th className={`${headerClass} text-left`}>Target</th>
              <th className={`${headerClass} text-left`}>Policy</th>
              <th className={`${headerClass} text-center`}>Status</th>
              <th className={`${headerClass} text-right`}>Time</th>
              {showActions ? (
                <th className={`${headerClass} text-right`}>Actions</th>
              ) : (
                <>
                  <th className={`${headerClass} text-left`}>Decided By</th>
                  <th className={`${headerClass} text-left`}>Notes</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-2 py-3">
                  <div className="h-4 w-4 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-28 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-40 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="mx-auto h-5 w-16 animate-pulse rounded-full bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                {showActions ? (
                  <td className="px-4 py-3">
                    <div className="ml-auto h-6 w-16 animate-pulse rounded bg-[var(--muted)]" />
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-3">
                      <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Empty state
  if (approvals.length === 0) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} w-8`} />
              <th className={`${headerClass} text-left`}>Agent</th>
              <th className={`${headerClass} text-left`}>Target</th>
              <th className={`${headerClass} text-left`}>Policy</th>
              <th className={`${headerClass} text-center`}>Status</th>
              <th className={`${headerClass} text-right`}>Time</th>
              {showActions ? (
                <th className={`${headerClass} text-right`}>Actions</th>
              ) : (
                <>
                  <th className={`${headerClass} text-left`}>Decided By</th>
                  <th className={`${headerClass} text-left`}>Notes</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={actualColCount}
                className="px-4 py-12 text-center text-sm text-[var(--muted-foreground)]"
              >
                No approval requests found
              </td>
            </tr>
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
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("agent")}
            >
              Agent <SortIcon column="agent" />
            </th>
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("target")}
            >
              Target <SortIcon column="target" />
            </th>
            <th
              className={`${headerClass} text-left`}
              onClick={() => toggleSort("policy")}
            >
              Policy <SortIcon column="policy" />
            </th>
            <th
              className={`${headerClass} text-center`}
              onClick={() => toggleSort("status")}
            >
              Status <SortIcon column="status" />
            </th>
            <th
              className={`${headerClass} text-right`}
              onClick={() => toggleSort("time")}
            >
              {showActions ? "Waiting" : "Time"} <SortIcon column="time" />
            </th>
            {showActions ? (
              <th className={`${headerClass} text-right`}>Actions</th>
            ) : (
              <>
                <th className={`${headerClass} text-left`}>Decided By</th>
                <th className={`${headerClass} text-left`}>Notes</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedApprovals.map((approval) => {
            const style = STATUS_STYLES[approval.status];
            const isExpanded = expandedId === approval.id;
            const timeString =
              approval.status === "pending"
                ? formatTimeAgo(approval.created_at)
                : approval.decided_at
                  ? formatTimeAgo(approval.decided_at)
                  : formatTimeAgo(approval.created_at);

            return (
              <Fragment key={approval.id}>
                <tr
                  className={`border-b border-[var(--border)] cursor-pointer transition-colors ${
                    isExpanded
                      ? "bg-[var(--muted)]/30"
                      : "hover:bg-[var(--muted)]/50"
                  }`}
                  onClick={() => toggleExpand(approval.id)}
                >
                  {/* Chevron indicator */}
                  <td className="w-8 px-2 py-3 text-[var(--muted-foreground)]">
                    <ChevronRight
                      className={`size-4 transition-transform duration-150 ${
                        isExpanded ? "rotate-90" : ""
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[var(--foreground)]">
                      {approval.agent_id}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                    <Truncated text={approval.target_path} maxLength={40} />
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--foreground)]">
                    {approval.policy_name}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                    >
                      {approval.status === "pending" && (
                        <span className="relative flex size-2">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                        </span>
                      )}
                      {style.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-[var(--muted-foreground)]">
                    {timeString}
                  </td>
                  {showActions ? (
                    <td className="px-4 py-3 text-right">
                      {approval.status === "pending" && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onApprove?.(approval.id);
                            }}
                            className="inline-flex size-7 items-center justify-center rounded-md text-green-600 hover:bg-green-100 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-900/30 dark:hover:text-green-300 transition-colors"
                            title="Approve"
                          >
                            <Check className="size-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeny?.(approval.id);
                            }}
                            className="inline-flex size-7 items-center justify-center rounded-md text-red-600 hover:bg-red-100 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300 transition-colors"
                            title="Deny"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-sm text-[var(--foreground)]">
                        {approval.decided_by || "\u2014"}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">
                        {approval.decision_notes ? (
                          <Truncated
                            text={approval.decision_notes}
                            maxLength={60}
                          />
                        ) : (
                          "\u2014"
                        )}
                      </td>
                    </>
                  )}
                </tr>
                {isExpanded && (
                  <ApprovalDetailPanel
                    approval={approval}
                    colSpan={actualColCount}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
