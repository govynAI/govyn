import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Plus } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import { PolicyTable } from "@/components/policies/PolicyTable";
import { Button } from "@/components/ui/button";
import { usePolicies } from "@/hooks/usePolicies";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { PolicyType } from "@/types/api";

type TypeFilter = PolicyType | "all";
type ScopeFilter = "all" | "global" | "agent" | "target";

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "block", label: "Block" },
  { value: "rate_limit", label: "Rate Limit" },
  { value: "budget_limit", label: "Budget Limit" },
  { value: "content_filter", label: "Content Filter" },
  { value: "time_window", label: "Time Window" },
  { value: "model_route", label: "Model Route" },
  { value: "require_approval", label: "Require Approval" },
];

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: "all", label: "All Scopes" },
  { value: "global", label: "Global" },
  { value: "agent", label: "Agent" },
  { value: "target", label: "Target" },
];

export default function PoliciesPage() {
  const navigate = useNavigate();
  const { isConnected } = useProxyConnection();
  const { policies, loading, toggleEnabled } = usePolicies();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");

  const filteredPolicies = useMemo(() => {
    return policies.filter((p) => {
      if (typeFilter !== "all" && p.type !== typeFilter) return false;
      if (scopeFilter !== "all" && p.scope.level !== scopeFilter) return false;
      return true;
    });
  }, [policies, typeFilter, scopeFilter]);

  const selectClass =
    "h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-1";

  // Not connected: show connect prompt
  if (!isConnected) {
    return (
      <>
        <PageHeader title="Policies" />
        <EmptyState
          icon={Shield}
          title="Proxy not connected"
          description="Connect to your proxy server to view and manage policies."
          action={{ label: "Configure Proxy", href: "/settings" }}
        />
      </>
    );
  }

  // Connected but no policies and not loading
  if (!loading && policies.length === 0) {
    return (
      <>
        <PageHeader title="Policies" />
        <EmptyState
          icon={Shield}
          title="No policies configured"
          description="No policies are loaded in the proxy. Create a policy to get started."
          action={{
            label: "New Policy",
            onClick: () => navigate("/policies/new"),
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Policies" />
      <div className="space-y-4 p-8">
        {/* Toolbar: filters + new policy button */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className={selectClass}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
            className={selectClass}
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="ml-auto">
            <Button
              size="sm"
              onClick={() => navigate("/policies/new")}
            >
              <Plus className="size-4" />
              New Policy
            </Button>
          </div>
        </div>

        {/* Policy table */}
        <PolicyTable
          policies={filteredPolicies}
          loading={loading}
          onToggle={toggleEnabled}
        />

        {/* Filter result message when no matches */}
        {!loading && filteredPolicies.length === 0 && policies.length > 0 && (
          <p className="text-center text-sm text-[var(--muted-foreground)] py-8">
            No policies match the current filters.
          </p>
        )}
      </div>
    </>
  );
}
