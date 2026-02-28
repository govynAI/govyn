import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { AlertCircle, ArrowLeft } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import { PeriodSwitcher } from "@/components/costs/PeriodSwitcher";
import { BudgetProgressBar } from "@/components/costs/BudgetProgressBar";
import { BudgetBadge } from "@/components/costs/BudgetBadge";
import { CostAreaChart, type CostChartDataPoint } from "@/components/costs/CostAreaChart";
import { AgentModelTable } from "@/components/costs/AgentModelTable";
import { useCosts } from "@/hooks/useCosts";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BudgetStatus, DashboardPeriod } from "@/types/api";

/**
 * Agent cost detail page at /costs/:agentId.
 *
 * Shows per-agent cost breakdown including:
 * - Budget health indicators (daily/monthly)
 * - Summary stat cards (total spend, requests, tokens)
 * - Time-series area chart
 * - Model breakdown table
 */
export default function AgentCostDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { isConnected } = useProxyConnection();
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const { data, loading, error, refetch } = useCosts(period, agentId);

  // Budget state — fetched separately from /api/budgets/:agentId
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [budgetLoading, setBudgetLoading] = useState(false);

  const fetchBudget = useCallback(async () => {
    if (!isConnected || !agentId) return;
    setBudgetLoading(true);
    try {
      const response = await apiFetch(`/api/budgets/${encodeURIComponent(agentId)}`);
      if (response.ok) {
        const json = (await response.json()) as BudgetStatus;
        setBudget(json);
      } else {
        // 404 = no budget configured for this agent
        setBudget(null);
      }
    } catch {
      setBudget(null);
    } finally {
      setBudgetLoading(false);
    }
  }, [isConnected, agentId]);

  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  const agent = data?.agents[0] ?? null;

  // Build chart data from the API response
  // The API returns aggregated totals, not time-series. We create a snapshot
  // at the current generated_at timestamp showing the agent's total cost.
  const chartData: CostChartDataPoint[] = useMemo(() => {
    if (!agent) return [];

    const timestamp = data?.generated_at
      ? new Date(data.generated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "Current";

    return [
      {
        label: timestamp,
        total: agent.totalCost,
      },
    ];
  }, [agent, data?.generated_at]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <>
        <PageHeader
          title={agentId ?? "Agent"}
          breadcrumbs={[
            { label: "Costs", href: "/costs" },
            { label: agentId ?? "Agent" },
          ]}
        />
        <div className="space-y-6 p-8">
          <div className="flex items-center justify-between">
            <PeriodSwitcher value={period} onChange={setPeriod} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="h-8 w-24 animate-pulse rounded bg-[var(--muted)]" />
                  <div className="mt-2 h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Spending Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] animate-pulse rounded bg-[var(--muted)]" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Model Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentModelTable models={{}} loading />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  // Error state
  if (error) {
    return (
      <>
        <PageHeader
          title={agentId ?? "Agent"}
          breadcrumbs={[
            { label: "Costs", href: "/costs" },
            { label: agentId ?? "Agent" },
          ]}
        />
        <div className="flex flex-col items-center justify-center gap-4 p-16">
          <AlertCircle className="size-10 text-[var(--destructive)]" strokeWidth={1.5} />
          <p className="text-sm text-[var(--muted-foreground)]">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  // No data for this agent
  if (!agent) {
    return (
      <>
        <PageHeader
          title={agentId ?? "Agent"}
          breadcrumbs={[
            { label: "Costs", href: "/costs" },
            { label: agentId ?? "Agent" },
          ]}
        />
        <div className="flex flex-col items-center justify-center gap-4 p-16">
          <p className="text-sm text-[var(--muted-foreground)]">
            No cost data found for this agent
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/costs">
              <ArrowLeft className="mr-1.5 size-4" />
              Back to Costs
            </Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={agentId ?? "Agent"}
        breadcrumbs={[
          { label: "Costs", href: "/costs" },
          { label: agentId ?? "Agent" },
        ]}
      />
      <div className="space-y-6 p-8">
        <div className="flex items-center justify-between">
          <PeriodSwitcher value={period} onChange={setPeriod} />
        </div>

        {/* Budget health -- prominent */}
        {budget && !budgetLoading && (
          <Card>
            <CardHeader>
              <CardTitle>Budget Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {/* Daily budget */}
                <div>
                  <div className="mb-2 text-sm text-[var(--muted-foreground)]">
                    Daily Budget
                  </div>
                  <BudgetProgressBar
                    percentUsed={budget.daily.percentUsed}
                    hasLimit={budget.daily.limit !== null}
                  />
                  <div className="mt-1 flex justify-between text-xs text-[var(--muted-foreground)]">
                    <span>${budget.daily.spent.toFixed(4)} spent</span>
                    {budget.daily.limit !== null && (
                      <span>${budget.daily.limit.toFixed(2)} limit</span>
                    )}
                  </div>
                </div>
                {/* Monthly budget */}
                <div>
                  <div className="mb-2 text-sm text-[var(--muted-foreground)]">
                    Monthly Budget
                  </div>
                  <BudgetProgressBar
                    percentUsed={budget.monthly.percentUsed}
                    hasLimit={budget.monthly.limit !== null}
                  />
                  <div className="mt-1 flex justify-between text-xs text-[var(--muted-foreground)]">
                    <span>${budget.monthly.spent.toFixed(4)} spent</span>
                    {budget.monthly.limit !== null && (
                      <span>${budget.monthly.limit.toFixed(2)} limit</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <BudgetBadge
                  percentUsed={Math.max(
                    budget.daily.percentUsed ?? 0,
                    budget.monthly.percentUsed ?? 0
                  )}
                  hasLimit
                />
                <Badge variant="outline">{budget.limitType} limit</Badge>
                {budget.blocked && (
                  <Badge variant="destructive">Blocked</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold tabular-nums">
                ${agent.totalCost.toFixed(4)}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Total Spend
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold tabular-nums">
                {agent.requestCount.toLocaleString()}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Requests
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold tabular-nums">
                {(
                  agent.totalInputTokens + agent.totalOutputTokens
                ).toLocaleString()}
              </div>
              <div className="text-xs text-[var(--muted-foreground)]">
                Total Tokens
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time-series chart */}
        <Card>
          <CardHeader>
            <CardTitle>Spending Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <CostAreaChart data={chartData} stacked={false} />
          </CardContent>
        </Card>

        {/* Model breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle>Model Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <AgentModelTable models={agent.models} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
