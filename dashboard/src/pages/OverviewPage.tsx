import { LayoutDashboard } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import EmptyState from "@/components/EmptyState";
import { CostSummaryWidget } from "@/components/costs/CostSummaryWidget";
import { useProxyConnection } from "@/hooks/useProxyConnection";

export default function OverviewPage() {
  const { isConnected } = useProxyConnection();

  return (
    <>
      <PageHeader title="Overview" />
      {isConnected ? (
        <div className="p-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            <CostSummaryWidget />
            {/* Future widgets for policies, approvals, alerts will go in adjacent grid cells */}
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
