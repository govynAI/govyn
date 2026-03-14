import { LayoutDashboard } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import LazyCostAreaChart from "@/components/costs/LazyCostAreaChart";
import { CostSummaryWidget } from "@/components/costs/CostSummaryWidget";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCostTimeseries } from "@/hooks/useCostTimeseries";
import { toCostChartData } from "@/lib/cost-chart";
import { useProxyConnection } from "@/hooks/useProxyConnection";

export default function OverviewPage() {
  const { isConnected } = useProxyConnection();
  const { data: timeseriesData } = useCostTimeseries("7d");
  const { chartData, agentIds } = toCostChartData(timeseriesData?.points ?? []);

  return (
    <>
      <PageHeader title="Overview" />
      {isConnected ? (
        <div className="p-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.6fr)]">
            <CostSummaryWidget />
            <Card>
              <CardHeader>
                <CardTitle>Last 7 Days</CardTitle>
              </CardHeader>
              <CardContent>
                <LazyCostAreaChart data={chartData} agents={agentIds} stacked />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={LayoutDashboard}
          title="No data yet"
          description="Connect your proxy in Settings to start seeing governance data"
          action={{ label: "Go to Settings", href: "/settings" }}
        />
      )}
    </>
  );
}
