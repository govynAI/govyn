import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PolicyEditor, {
  type PolicyEditorHandle,
} from "@/components/policies/PolicyEditor";
import { PolicyErrorPanel } from "@/components/policies/PolicyErrorPanel";
import { usePolicy } from "@/hooks/usePolicy";
import type { PolicyType } from "@/types/api";

/** Badge color mapping for each policy type */
const TYPE_COLORS: Record<PolicyType, string> = {
  block: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  rate_limit:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  budget_limit:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  content_filter:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  time_window:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  model_route:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  require_approval:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
};

const TYPE_LABELS: Record<PolicyType, string> = {
  block: "Block",
  rate_limit: "Rate Limit",
  budget_limit: "Budget",
  content_filter: "Content Filter",
  time_window: "Time Window",
  model_route: "Model Route",
  require_approval: "Approval",
};

function formatScope(scope: { level: string; value?: string }): string {
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

/**
 * Policy detail page with CodeMirror YAML editor, live validation,
 * inline error markers, save/delete/toggle controls, and toast notifications.
 */
export default function PolicyDetailPage() {
  const { policyName } = useParams<{ policyName: string }>();
  const navigate = useNavigate();
  const editorRef = useRef<PolicyEditorHandle>(null);

  const {
    policy,
    loading,
    error,
    saving,
    validationErrors,
    save,
    deletePolicy,
    toggleEnabled,
    validateYaml,
  } = usePolicy(policyName);

  const [currentYaml, setCurrentYaml] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [savedYaml, setSavedYaml] = useState("");

  // Initialize editor content when policy loads
  useEffect(() => {
    if (policy?.yaml && !isDirty) {
      setCurrentYaml(policy.yaml);
      setSavedYaml(policy.yaml);
    }
  }, [policy?.yaml, isDirty]);

  // Unsaved changes warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const handleChange = useCallback(
    (value: string) => {
      setCurrentYaml(value);
      setIsDirty(value !== savedYaml);
      validateYaml(value);
    },
    [savedYaml, validateYaml],
  );

  const handleSave = useCallback(async () => {
    const success = await save(currentYaml);
    if (success) {
      setSavedYaml(currentYaml);
      setIsDirty(false);
      toast.success("Policy saved and reloaded");
    }
  }, [save, currentYaml]);

  const handleDelete = useCallback(async () => {
    const success = await deletePolicy();
    if (success) {
      toast.success("Policy deleted");
      navigate("/policies");
    }
    setShowDeleteDialog(false);
  }, [deletePolicy, navigate]);

  const handleToggle = useCallback(async () => {
    if (!policy) return;
    await toggleEnabled(!policy.enabled);
  }, [policy, toggleEnabled]);

  const handleErrorClick = useCallback((line: number) => {
    editorRef.current?.scrollToLine(line);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  // Error / not found state
  if (error || !policy) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium text-[var(--foreground)]">
          {error === "Policy not found"
            ? "Policy not found"
            : "Error loading policy"}
        </p>
        {error && error !== "Policy not found" && (
          <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
        )}
        <Button variant="outline" onClick={() => navigate("/policies")}>
          <ArrowLeft className="size-4" />
          Back to Policies
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--background)]/80 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/policies")}
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Policies</span>
          </Button>

          <h2 className="text-lg font-semibold text-[var(--foreground)] truncate">
            {policy.name}
          </h2>

          <Badge variant="secondary" className={TYPE_COLORS[policy.type]}>
            {TYPE_LABELS[policy.type]}
          </Badge>

          <Badge
            variant="secondary"
            className="bg-slate-100 text-slate-700 dark:bg-slate-800/40 dark:text-slate-300"
          >
            {formatScope(policy.scope)}
          </Badge>

          {/* Toggle switch */}
          <button
            type="button"
            role="switch"
            aria-checked={policy.enabled}
            onClick={handleToggle}
            className={`
              relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
              border-2 border-transparent transition-colors duration-200 ease-in-out
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2
              ${policy.enabled ? "bg-emerald-500" : "bg-[var(--muted)]"}
            `}
          >
            <span
              className={`
                pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm
                ring-0 transition-transform duration-200 ease-in-out
                ${policy.enabled ? "translate-x-4" : "translate-x-0.5"}
              `}
            />
          </button>
          <span className="text-xs text-[var(--muted-foreground)]">
            {policy.enabled ? "Enabled" : "Disabled"}
          </span>

          <div className="flex-1" />

          {/* Save button */}
          <Button
            size="sm"
            disabled={validationErrors.length > 0 || saving || !isDirty}
            onClick={handleSave}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>

          {/* Delete button */}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </header>

      {/* Editor area */}
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <PolicyEditor
          ref={editorRef}
          value={currentYaml}
          onChange={handleChange}
          errors={validationErrors}
        />

        <PolicyErrorPanel
          errors={validationErrors}
          onClickError={handleErrorClick}
        />
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowDeleteDialog(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">
              Delete Policy
            </h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              Are you sure you want to delete{" "}
              <span className="font-medium text-[var(--foreground)]">
                {policy.name}
              </span>
              ? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
