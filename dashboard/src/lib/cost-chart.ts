import type { CostChartDataPoint } from "@/components/costs/CostAreaChart";
import type { CostTimeSeriesPoint } from "@/types/api";

export function toCostChartData(points: CostTimeSeriesPoint[]): {
  chartData: CostChartDataPoint[];
  agentIds: string[];
} {
  const agentIds = Array.from(
    points.reduce((ids, point) => {
      for (const agentId of Object.keys(point.agents)) {
        ids.add(agentId);
      }
      return ids;
    }, new Set<string>()),
  );

  const chartData = points.map<CostChartDataPoint>((point) => ({
    label: point.label,
    total: point.total,
    ...point.agents,
  }));

  return { chartData, agentIds };
}
