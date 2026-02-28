import { Link } from "react-router-dom";
import { useCosts } from "@/hooks/useCosts";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Compact cost summary widget for the Overview/Dashboard home page.
 *
 * Shows today's total spend and the top-spending agent.
 * Fetches its own data via useCosts('today').
 */
export function CostSummaryWidget() {
  const { isConnected } = useProxyConnection();
  const { data, loading } = useCosts("today");

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today's Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--muted-foreground)]">
            Connect proxy to see costs
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today's Costs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-8 w-24 animate-pulse rounded bg-[var(--muted)]" />
          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-[var(--muted)]" />
        </CardContent>
      </Card>
    );
  }

  const totalCost = data?.totals.cost ?? 0;
  const topAgent = data?.agents
    .slice()
    .sort((a, b) => b.totalCost - a.totalCost)[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Costs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tabular-nums">
          ${totalCost.toFixed(2)}
        </div>
        {topAgent && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Top agent: {topAgent.agentId} (${topAgent.totalCost.toFixed(4)})
          </p>
        )}
        {!topAgent && (
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            No agent activity today
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Link
          to="/costs"
          className="text-xs text-[var(--primary)] hover:underline"
        >
          View all costs
        </Link>
      </CardFooter>
    </Card>
  );
}
