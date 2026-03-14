import { useEffect, useRef, useState } from "react";
import { loadCostAreaChartModule } from "@/lib/dashboard-imports";
import type { CostChartDataPoint } from "@/components/costs/CostAreaChart";

interface LazyCostAreaChartProps {
  data: CostChartDataPoint[];
  agents?: string[];
  height?: number;
  stacked?: boolean;
}

type CostAreaChartComponent = typeof import("@/components/costs/CostAreaChart").CostAreaChart;

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--muted)]/40"
      style={{ height }}
    >
      <div className="flex h-full items-end gap-3 px-4 py-5">
        {[48, 72, 56, 88, 64, 78].map((size, index) => (
          <div
            key={`${size}-${index}`}
            className="flex-1 rounded-t-md bg-[linear-gradient(180deg,rgba(20,184,166,0.45),rgba(20,184,166,0.12))] animate-pulse"
            style={{ height: `${size}%`, animationDelay: `${index * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function LazyCostAreaChart({
  data,
  agents,
  height = 350,
  stacked = false,
}: LazyCostAreaChartProps) {
  const [Chart, setChart] = useState<CostAreaChartComponent | null>(null);
  const [shouldLoad, setShouldLoad] = useState(data.length === 0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (shouldLoad) {
      return;
    }

    const node = containerRef.current;
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) {
          return;
        }

        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "180px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  useEffect(() => {
    if (!shouldLoad || Chart) {
      return;
    }

    let cancelled = false;
    void loadCostAreaChartModule().then((module) => {
      if (!cancelled) {
        setChart(() => module.CostAreaChart);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [Chart, shouldLoad]);

  return (
    <div ref={containerRef}>
      {Chart ? (
        <Chart data={data} agents={agents} height={height} stacked={stacked} />
      ) : (
        <ChartSkeleton height={height} />
      )}
    </div>
  );
}
