import { useState, useCallback } from "react";
import { CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import { ApprovalTable } from "@/components/approvals/ApprovalTable";
import { ApprovalActionModal } from "@/components/approvals/ApprovalActionModal";
import { useApprovals } from "@/hooks/useApprovals";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { apiFetch } from "@/lib/api-client";
import type { ApprovalRequest } from "@/types/api";

type Tab = "pending" | "history";

const HISTORY_STATUSES = "approved,denied,denied_timeout";

interface ModalState {
  open: boolean;
  approval: ApprovalRequest | null;
  action: "approve" | "deny";
}

export default function ApprovalsPage() {
  const { isConnected } = useProxyConnection();
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [modalState, setModalState] = useState<ModalState>({
    open: false,
    approval: null,
    action: "approve",
  });

  // Fetch both tabs: pending with auto-refresh, history without
  const pendingQuery = useApprovals("pending", { autoRefreshMs: 10_000 });
  const historyQuery = useApprovals(HISTORY_STATUSES);

  // Active tab drives the displayed data
  const activeQuery = activeTab === "pending" ? pendingQuery : historyQuery;
  const { approvals, loading, error, refetch } = activeQuery;

  const pendingCount = pendingQuery.total;
  const historyCount = historyQuery.total;

  const handleApprove = useCallback(
    (id: string) => {
      const approval = approvals.find((a) => a.id === id);
      if (approval) {
        setModalState({ open: true, approval, action: "approve" });
      }
    },
    [approvals],
  );

  const handleDeny = useCallback(
    (id: string) => {
      const approval = approvals.find((a) => a.id === id);
      if (approval) {
        setModalState({ open: true, approval, action: "deny" });
      }
    },
    [approvals],
  );

  const handleConfirm = useCallback(
    async (id: string, notes: string) => {
      const endpoint = modalState.action === "approve" ? "approve" : "deny";
      const response = await apiFetch(`/api/approvals/${id}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({
          decided_by: "dashboard",
          notes: notes || undefined,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        toast.error(
          `Failed to ${endpoint}: ${(err as { error?: string }).error || response.statusText}`,
        );
        throw new Error("Action failed");
      }
      toast.success(
        modalState.action === "approve"
          ? "Request approved successfully"
          : "Request denied",
      );
      setModalState({ open: false, approval: null, action: "approve" });
      refetch();
    },
    [modalState.action, refetch],
  );

  const handleCloseModal = useCallback(() => {
    setModalState({ open: false, approval: null, action: "approve" });
  }, []);

  // Not connected to proxy
  if (!isConnected) {
    return (
      <>
        <PageHeader title="Approvals" />
        <EmptyState
          icon={CheckCircle}
          title="Connect to proxy"
          description="Connect to a Govyn proxy to view and manage approval requests"
          action={{ label: "Go to Settings", href: "/settings" }}
        />
      </>
    );
  }

  const approvalsAvailable = pendingQuery.available && historyQuery.available;
  const approvalsUnavailableReason =
    pendingQuery.unavailableReason ??
    historyQuery.unavailableReason ??
    "Approvals are unavailable on this proxy.";

  if (!approvalsAvailable) {
    return (
      <>
        <PageHeader title="Approvals" />
        <EmptyState
          icon={CheckCircle}
          title="Approvals unavailable"
          description={approvalsUnavailableReason}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Approvals" />
      <div className="p-8">
        {/* Tab bar */}
        <div className="mb-6 flex items-center gap-1 border-b border-[var(--border)]">
          <TabButton
            active={activeTab === "pending"}
            onClick={() => setActiveTab("pending")}
            count={pendingCount > 0 ? pendingCount : undefined}
          >
            Pending
          </TabButton>
          <TabButton
            active={activeTab === "history"}
            onClick={() => setActiveTab("history")}
            count={historyCount > 0 ? historyCount : undefined}
          >
            History
          </TabButton>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Content */}
        {!loading && approvals.length === 0 && !error ? (
          <EmptyState
            icon={activeTab === "pending" ? Clock : CheckCircle}
            title={
              activeTab === "pending"
                ? "No pending approvals"
                : "No approval history yet"
            }
            description={
              activeTab === "pending"
                ? "When agents trigger approval-required policies, their requests appear here for review"
                : "Approval decisions will appear here once requests have been reviewed"
            }
          />
        ) : (
          <ApprovalTable
            approvals={approvals}
            loading={loading}
            showActions={activeTab === "pending"}
            onApprove={handleApprove}
            onDeny={handleDeny}
          />
        )}
      </div>

      {/* Approval action modal */}
      <ApprovalActionModal
        open={modalState.open}
        approval={modalState.approval}
        action={modalState.action}
        onConfirm={handleConfirm}
        onClose={handleCloseModal}
      />
    </>
  );
}

/** Tab button with optional count badge */
function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative px-4 py-2.5 text-sm font-medium transition-colors
        ${
          active
            ? "text-[var(--foreground)] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[var(--foreground)]"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        }
      `}
    >
      <span className="flex items-center gap-2">
        {children}
        {count != null && count > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
            {count}
          </span>
        )}
      </span>
    </button>
  );
}
