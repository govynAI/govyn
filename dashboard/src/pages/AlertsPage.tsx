import { useState, useCallback } from "react";
import { Bell, History, Plus } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import { AlertRulesTable } from "@/components/alerts/AlertRulesTable";
import { AlertRuleForm } from "@/components/alerts/AlertRuleForm";
import { AlertHistoryTable } from "@/components/alerts/AlertHistoryTable";
import { Button } from "@/components/ui/button";
import { useAlerts } from "@/hooks/useAlerts";
import { useAlertHistory } from "@/hooks/useAlertHistory";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { AlertRule, AlertRuleCreatePayload } from "@/types/api";

type Tab = "rules" | "history";

interface FormState {
  open: boolean;
  editingRule: AlertRule | null;
}

export default function AlertsPage() {
  const { isConnected } = useProxyConnection();
  const [activeTab, setActiveTab] = useState<Tab>("rules");
  const [formState, setFormState] = useState<FormState>({
    open: false,
    editingRule: null,
  });

  const {
    rules,
    loading: rulesLoading,
    error: rulesError,
    available: rulesAvailable,
    unavailableReason: rulesUnavailableReason,
    createRule,
    updateRule,
    deleteRule,
    toggleEnabled,
    testWebhook,
  } = useAlerts();

  const {
    alerts: historyAlerts,
    total: historyTotal,
    loading: historyLoading,
    error: historyError,
    available: historyAvailable,
    unavailableReason: historyUnavailableReason,
  } = useAlertHistory();

  const handleCreate = useCallback(() => {
    setFormState({ open: true, editingRule: null });
  }, []);

  const handleEdit = useCallback((rule: AlertRule) => {
    setFormState({ open: true, editingRule: rule });
  }, []);

  const handleCloseForm = useCallback(() => {
    setFormState({ open: false, editingRule: null });
  }, []);

  const handleSave = useCallback(
    async (payload: AlertRuleCreatePayload) => {
      try {
        if (formState.editingRule) {
          await updateRule(formState.editingRule.id, payload);
          toast.success("Alert rule updated");
        } else {
          await createRule(payload);
          toast.success("Alert rule created");
        }
        setFormState({ open: false, editingRule: null });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to save alert rule";
        toast.error(message);
        throw err; // Keep form open
      }
    },
    [formState.editingRule, createRule, updateRule],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const confirmed = window.confirm(
        "Are you sure you want to delete this alert rule? This action cannot be undone.",
      );
      if (!confirmed) return;

      try {
        await deleteRule(id);
        toast.success("Alert rule deleted");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete alert rule";
        toast.error(message);
      }
    },
    [deleteRule],
  );

  const handleToggle = useCallback(
    (id: string, enabled: boolean) => {
      toggleEnabled(id, enabled);
    },
    [toggleEnabled],
  );

  // Not connected to proxy
  if (!isConnected) {
    return (
      <>
        <PageHeader title="Alerts" />
        <EmptyState
          icon={Bell}
          title="Connect to proxy"
          description="Connect to a Govyn proxy to configure and manage alert rules"
          action={{ label: "Go to Settings", href: "/settings" }}
        />
      </>
    );
  }

  const alertsAvailable = rulesAvailable && historyAvailable;
  const alertsUnavailableReason =
    rulesUnavailableReason ??
    historyUnavailableReason ??
    "Alerts are unavailable on this proxy.";

  if (!alertsAvailable) {
    return (
      <>
        <PageHeader title="Alerts" />
        <EmptyState
          icon={Bell}
          title="Alerts unavailable"
          description={alertsUnavailableReason}
        />
      </>
    );
  }

  const activeError = activeTab === "rules" ? rulesError : historyError;

  return (
    <>
      <PageHeader title="Alerts" />
      <div className="p-8">
        {/* Tab bar with create button */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-1 border-b border-[var(--border)]">
            <TabButton
              active={activeTab === "rules"}
              onClick={() => setActiveTab("rules")}
              count={rules.length > 0 ? rules.length : undefined}
            >
              Rules
            </TabButton>
            <TabButton
              active={activeTab === "history"}
              onClick={() => setActiveTab("history")}
              count={historyTotal > 0 ? historyTotal : undefined}
            >
              History
            </TabButton>
          </div>

          {activeTab === "rules" && (
            <Button size="sm" onClick={handleCreate}>
              <Plus className="mr-1.5 size-3.5" />
              Create Alert Rule
            </Button>
          )}
        </div>

        {/* Error state */}
        {activeError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-400">
            {activeError}
          </div>
        )}

        {/* Rules tab content */}
        {activeTab === "rules" && (
          <>
            {!rulesLoading && rules.length === 0 && !rulesError ? (
              <EmptyState
                icon={Bell}
                title="No alert rules configured"
                description="Create budget threshold or policy trigger alerts to get notified when important events occur"
                action={{ label: "Create Alert Rule", onClick: handleCreate }}
              />
            ) : (
              <AlertRulesTable
                rules={rules}
                loading={rulesLoading}
                onToggle={handleToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          </>
        )}

        {/* History tab content */}
        {activeTab === "history" && (
          <>
            {!historyLoading && historyAlerts.length === 0 && !historyError ? (
              <EmptyState
                icon={History}
                title="No alerts fired yet"
                description="Alert history will appear here when configured rules are triggered"
              />
            ) : (
              <AlertHistoryTable
                alerts={historyAlerts}
                loading={historyLoading}
              />
            )}
          </>
        )}
      </div>

      {/* Alert rule form modal */}
      <AlertRuleForm
        open={formState.open}
        editingRule={formState.editingRule}
        onSave={handleSave}
        onTestWebhook={testWebhook}
        onClose={handleCloseForm}
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
