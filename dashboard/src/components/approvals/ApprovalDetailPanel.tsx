import type { ApprovalRequest } from "@/types/api";
import type { ApprovalStatus } from "@/types/api";

/** Status badge color mapping (mirrors ApprovalTable) */
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
 * Format an ISO date string as a readable relative string.
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
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Format relative countdown from now to a future date.
 * Returns "in Xm", "in Xh Xm", or "expired".
 */
function formatCountdown(isoString: string): string {
  const now = Date.now();
  const target = new Date(isoString).getTime();
  const diffSec = Math.floor((target - now) / 1000);

  if (diffSec <= 0) return "expired";
  if (diffSec < 60) return `in <1 min`;
  if (diffSec < 3600) return `in ${Math.floor(diffSec / 60)} min`;
  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
}

interface ApprovalDetailPanelProps {
  approval: ApprovalRequest;
  colSpan: number;
}

/** Detail field row used in the panel grid */
function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-[var(--foreground)]">{children}</dd>
    </div>
  );
}

/**
 * Expandable inline detail panel that shows below a table row when clicked.
 * Renders as a <tr> with a single <td colSpan> containing the detail content.
 */
export function ApprovalDetailPanel({
  approval,
  colSpan,
}: ApprovalDetailPanelProps) {
  const isResolved = approval.status !== "pending";
  const style = STATUS_STYLES[approval.status];

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="border-t border-[var(--border)] bg-[var(--muted)]/30 px-6 py-4">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Left column -- Request Details */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                Request Details
              </h4>
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Agent ID">
                  <span className="font-mono font-medium">
                    {approval.agent_id}
                  </span>
                </DetailField>
                <DetailField label="Provider / Model">
                  {approval.model
                    ? `${approval.provider} / ${approval.model}`
                    : approval.provider}
                </DetailField>
                <DetailField label="Target Path">
                  <span className="font-mono">{approval.target_path}</span>
                </DetailField>
                <DetailField label="Policy">
                  {approval.policy_name}
                </DetailField>
                <DetailField label="Estimated Cost">
                  {approval.estimated_cost != null
                    ? `$${approval.estimated_cost.toFixed(2)}`
                    : "N/A"}
                </DetailField>
                <DetailField label="Created">
                  {new Date(approval.created_at).toLocaleString()}
                </DetailField>
              </dl>
              {approval.request_summary && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    Request Summary
                  </dt>
                  <dd className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/50 p-2 text-sm text-[var(--foreground)]">
                    {approval.request_summary}
                  </dd>
                </div>
              )}
            </div>

            {/* Right column -- Decision or Pending details */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                {isResolved ? "Decision Details" : "Status"}
              </h4>
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Status">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                  >
                    {style.label}
                  </span>
                </DetailField>

                {isResolved ? (
                  <>
                    <DetailField label="Decided By">
                      {approval.decided_by || "\u2014"}
                    </DetailField>
                    <DetailField label="Decided At">
                      {approval.decided_at
                        ? new Date(approval.decided_at).toLocaleString()
                        : "\u2014"}
                    </DetailField>
                  </>
                ) : (
                  <>
                    <DetailField label="Waiting">
                      {formatTimeAgo(approval.created_at)}
                    </DetailField>
                    <DetailField label="Expires At">
                      <span>
                        {new Date(approval.expires_at).toLocaleString()}
                      </span>
                      <span className="ml-1 text-xs text-[var(--muted-foreground)]">
                        ({formatCountdown(approval.expires_at)})
                      </span>
                    </DetailField>
                  </>
                )}
              </dl>

              {isResolved && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                    Notes
                  </dt>
                  {approval.decision_notes ? (
                    <dd className="mt-1 whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/50 p-2 text-sm text-[var(--foreground)]">
                      {approval.decision_notes}
                    </dd>
                  ) : (
                    <dd className="mt-1 text-sm text-[var(--muted-foreground)]">
                      No notes
                    </dd>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
