import { DollarSign, Activity, Users, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { CostsApiResponse } from "@/types/api";

interface StatCardsProps {
  totals: CostsApiResponse["totals"];
  agentCount: number;
  loading?: boolean;
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormat = new Intl.NumberFormat("en-US");

const usdPreciseFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

interface StatDef {
  label: string;
  icon: typeof DollarSign;
  getValue: (totals: CostsApiResponse["totals"], agentCount: number) => string;
}

const stats: StatDef[] = [
  {
    label: "Total Spend",
    icon: DollarSign,
    getValue: (t) => usdFormat.format(t.cost),
  },
  {
    label: "Requests",
    icon: Activity,
    getValue: (t) => numberFormat.format(t.requests),
  },
  {
    label: "Active Agents",
    icon: Users,
    getValue: (_t, count) => numberFormat.format(count),
  },
  {
    label: "Avg Cost / Request",
    icon: TrendingUp,
    getValue: (t) =>
      t.requests > 0
        ? usdPreciseFormat.format(t.cost / t.requests)
        : "$0.00",
  },
];

/**
 * Summary stat cards displayed at the top of the Costs page.
 * Shows Total Spend, Requests, Active Agents, and Avg Cost/Request.
 */
export function StatCards({ totals, agentCount, loading }: StatCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="py-4">
            <CardContent className="flex items-start gap-3">
              <div className="rounded-md bg-[var(--muted)] p-2">
                <Icon className="size-4 text-[var(--muted-foreground)]" />
              </div>
              <div className="min-w-0 flex-1">
                {loading ? (
                  <>
                    <div className="h-6 w-20 animate-pulse rounded bg-[var(--muted)]" />
                    <div className="mt-1 h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
                  </>
                ) : (
                  <>
                    <p className="text-xl font-bold tracking-tight text-[var(--foreground)]">
                      {stat.getValue(totals, agentCount)}
                    </p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {stat.label}
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
