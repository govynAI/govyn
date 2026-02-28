import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { ApprovalRequest } from "@/types/api";

interface ApprovalActionModalProps {
  open: boolean;
  approval: ApprovalRequest | null;
  action: "approve" | "deny";
  onConfirm: (id: string, notes: string) => Promise<void>;
  onClose: () => void;
}

/**
 * Format an ISO date string as a relative time-ago string.
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
 * Modal dialog for confirming an approve or deny action with an optional
 * notes textarea. Follows the custom modal pattern used in PolicyDetailPage.
 */
export function ApprovalActionModal({
  open,
  approval,
  action,
  onConfirm,
  onClose,
}: ApprovalActionModalProps) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset notes when modal opens with a new approval
  useEffect(() => {
    if (open) {
      setNotes("");
      setSubmitting(false);
    }
  }, [open, approval?.id]);

  // Focus textarea on open
  useEffect(() => {
    if (open) {
      // Small delay for DOM to render
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

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

  if (!open || !approval) return null;

  const isApprove = action === "approve";
  const title = isApprove ? "Approve Request" : "Deny Request";

  async function handleSubmit() {
    if (!approval || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(approval.id, notes);
    } catch {
      // Keep modal open on error; submitting state resets
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl">
        {/* Header */}
        <h3 className="text-lg font-semibold text-[var(--foreground)]">
          {title}
        </h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">
            {approval.agent_id}
          </span>
          {" "}&middot;{" "}
          {approval.policy_name}
        </p>

        {/* Request summary */}
        <div className="mt-4 space-y-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Target</span>
            <span className="font-mono text-[var(--foreground)]">
              {approval.target_path}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Provider</span>
            <span className="text-[var(--foreground)]">
              {approval.model
                ? `${approval.provider} / ${approval.model}`
                : approval.provider}
            </span>
          </div>
          {approval.estimated_cost != null && (
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">
                Est. Cost
              </span>
              <span className="text-[var(--foreground)]">
                ${approval.estimated_cost.toFixed(2)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Waiting</span>
            <span className="text-[var(--foreground)]">
              {formatTimeAgo(approval.created_at)}
            </span>
          </div>
        </div>

        {/* Notes textarea */}
        <div className="mt-4">
          <label
            htmlFor="approval-notes"
            className="block text-sm font-medium text-[var(--foreground)]"
          >
            Notes (optional)
          </label>
          <textarea
            ref={textareaRef}
            id="approval-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note about this decision..."
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] resize-none"
          />
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isApprove ? "default" : "destructive"}
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? isApprove
                ? "Approving..."
                : "Denying..."
              : isApprove
                ? "Approve"
                : "Deny"}
          </Button>
        </div>
      </div>
    </div>
  );
}
