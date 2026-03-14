import { useMemo, useState } from "react";
import { DollarSign } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import { PeriodSwitcher } from "@/components/costs/PeriodSwitcher";
import { StatCards } from "@/components/costs/StatCards";
import { AgentCostTable } from "@/components/costs/AgentCostTable";
import LazyCostAreaChart from "@/components/costs/LazyCostAreaChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCosts } from "@/hooks/useCosts";
import { useCostTimeseries } from "@/hooks/useCostTimeseries";
import { useBudgets } from "@/hooks/useBudgets";
import { toCostChartData } from "@/lib/cost-chart";
import type { DashboardPeriod } from "@/types/api";

const emptyTotals = { cost: 0, requests: 0, input_tokens: 0, output_tokens: 0 };

export default function CostsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const { data, loading } = useCosts(period);
  const { data: timeseriesData } = useCostTimeseries(period);
  const { data: budgetData, loading: budgetLoading } = useBudgets();

  const hasData = data !== null && data.agents.length > 0;

  const { chartData, agentIds } = useMemo(
    () => toCostChartData(timeseriesData?.points ?? []),
    [timeseriesData?.points],
  );

  return (
    <>
      <PageHeader title="Costs" />
      <div className="space-y-6 p-8">
        <div className="flex items-center justify-between">
          <PeriodSwitcher value={period} onChange={setPeriod} />
        </div>

        {hasData ? (
          <>
            <StatCards
              totals={data.totals}
              agentCount={data.agents.length}
              loading={loading}
            />
            <AgentCostTable
              agents={data.agents}
              budgets={budgetData}
              loading={budgetLoading}
            />
            <Card>
              <CardHeader>
                <CardTitle>Spending Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <LazyCostAreaChart data={chartData} agents={agentIds} stacked />
              </CardContent>
            </Card>
          </>
        ) : loading ? (
          <StatCards totals={emptyTotals} agentCount={0} loading />
        ) : (
          <EmptyState
            icon={DollarSign}
            title="No cost data"
            description="Cost records appear here once agents start making API calls through the proxy"
            action={{ label: "Configure Proxy", href: "/settings" }}
          />
        )}
      </div>
    </>
  );
}
