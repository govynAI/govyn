import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, ChevronDown } from "lucide-react";
import { BudgetProgressBar } from "./BudgetProgressBar";
import { BudgetBadge } from "./BudgetBadge";
import type { AgentCostSummary, BudgetStatus } from "@/types/api";

type SortKey = "agent" | "spend" | "requests" | "budget";
type SortDir = "asc" | "desc";

interface AgentCostTableProps {
  agents: AgentCostSummary[];
  budgets: BudgetStatus[];
  loading?: boolean;
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const numberFormat = new Intl.NumberFormat("en-US");

function getBudgetPercent(budget: BudgetStatus | undefined): number | null {
  if (!budget) return null;
  // Use daily percentUsed if available, fallback to monthly
  return budget.daily.percentUsed ?? budget.monthly.percentUsed ?? null;
}

function hasBudgetLimit(budget: BudgetStatus | undefined): boolean {
  if (!budget) return false;
  return budget.daily.limit !== null || budget.monthly.limit !== null;
}

/**
 * Sortable table listing all agents with their cost and budget data.
 * Rows are clickable, navigating to /costs/:agentId.
 */
export function AgentCostTable({
  agents,
  budgets,
  loading,
}: AgentCostTableProps) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const budgetMap = useMemo(() => {
    const map = new Map<string, BudgetStatus>();
    for (const b of budgets) {
      map.set(b.agentId, b);
    }
    return map;
  }, [budgets]);

  const sortedAgents = useMemo(() => {
    const sorted = [...agents];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "agent":
          cmp = a.agentId.localeCompare(b.agentId);
          break;
        case "spend":
          cmp = a.totalCost - b.totalCost;
          break;
        case "requests":
          cmp = a.requestCount - b.requestCount;
          break;
        case "budget": {
          const aP = getBudgetPercent(budgetMap.get(a.agentId)) ?? -1;
          const bP = getBudgetPercent(budgetMap.get(b.agentId)) ?? -1;
          cmp = aP - bP;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [agents, sortKey, sortDir, budgetMap]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "agent" ? "asc" : "desc");
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
              <th className={`${headerClass} text-left`}>Agent</th>
              <th className={`${headerClass} text-right`}>Total Spend</th>
              <th className={`${headerClass} text-right`}>Requests</th>
              <th className={`${headerClass} text-center`}>Budget Used</th>
              <th className={`${headerClass} text-right`}>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="h-4 w-28 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-12 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3">
                  <div className="mx-auto h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-14 animate-pulse rounded bg-[var(--muted)]" />
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
              onClick={() => toggleSort("agent")}
            >
              Agent <SortIcon column="agent" />
            </th>
            <th
              className={`${headerClass} text-right`}
              onClick={() => toggleSort("spend")}
            >
              Total Spend <SortIcon column="spend" />
            </th>
            <th
              className={`${headerClass} text-right`}
              onClick={() => toggleSort("requests")}
            >
              Requests <SortIcon column="requests" />
            </th>
            <th
              className={`${headerClass} text-center`}
              onClick={() => toggleSort("budget")}
            >
              Budget Used <SortIcon column="budget" />
            </th>
            <th className={`${headerClass} text-right cursor-default hover:text-[var(--muted-foreground)]`}>
              Last Active
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedAgents.map((agent) => {
            const budget = budgetMap.get(agent.agentId);
            const percentUsed = getBudgetPercent(budget);
            const hasLimit = hasBudgetLimit(budget);

            return (
              <tr
                key={agent.agentId}
                className="border-b border-[var(--border)] hover:bg-[var(--muted)]/50 cursor-pointer transition-colors"
                onClick={() => navigate(`/costs/${agent.agentId}`)}
              >
                <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                  {agent.agentId}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                  {usdFormat.format(agent.totalCost)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                  {numberFormat.format(agent.requestCount)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    <BudgetProgressBar
                      percentUsed={percentUsed}
                      hasLimit={hasLimit}
                    />
                    <BudgetBadge
                      percentUsed={percentUsed}
                      hasLimit={hasLimit}
                    />
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm text-[var(--muted-foreground)]">
                  &mdash;
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
