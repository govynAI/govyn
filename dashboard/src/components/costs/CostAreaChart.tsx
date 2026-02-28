import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultTooltipContent";

// TODO: When proxy API supports historical time-series data (e.g., /api/costs/timeseries),
// replace snapshot data with real temporal data points.

export interface CostChartDataPoint {
  label: string;
  total: number;
  [agentId: string]: number | string;
}

interface CostAreaChartProps {
  data: CostChartDataPoint[];
  agents?: string[];
  height?: number;
  stacked?: boolean;
}

/** Distinct color palette that works in both dark and light themes */
const PALETTE = [
  "#14b8a6", // teal-500
  "#3b82f6", // blue-500
  "#a855f7", // purple-500
  "#f97316", // orange-500
  "#ec4899", // pink-500
  "#06b6d4", // cyan-500
  "#84cc16", // lime-500
  "#f43f5e", // rose-500
];

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<Payload<number, string>>;
  label?: string | number;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const total = payload.reduce(
    (sum: number, entry: Payload<number, string>) => sum + (entry.value ?? 0),
    0,
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--popover)] p-3 text-[var(--popover-foreground)] shadow-lg">
      <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
      </p>
      {payload.length > 1 && (
        <p className="mb-1 text-sm font-semibold">{formatUsd(total)}</p>
      )}
      {payload.map((entry: Payload<number, string>) => (
        <div
          key={String(entry.dataKey)}
          className="flex items-center gap-2 text-xs"
        >
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[var(--muted-foreground)]">
            {entry.dataKey === "total" ? "Cost" : String(entry.dataKey)}
          </span>
          <span className="ml-auto font-medium tabular-nums">
            {formatUsd(entry.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Recharts area chart for cost over time.
 *
 * Supports two modes:
 * - **Stacked** (overview): Multiple agents as stacked areas with distinct colors
 * - **Single** (agent detail): One agent's cost as a single filled area
 */
export function CostAreaChart({
  data,
  agents,
  height = 350,
  stacked = false,
}: CostAreaChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[var(--muted-foreground)]"
        style={{ height }}
      >
        No chart data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey="label"
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v < 1 ? v.toFixed(2) : v.toFixed(0)}`}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} />

        {stacked && agents
          ? agents.map((agentId, i) => (
              <Area
                key={agentId}
                type="monotone"
                dataKey={agentId}
                stackId="costs"
                stroke={PALETTE[i % PALETTE.length]}
                fill={PALETTE[i % PALETTE.length]}
                fillOpacity={0.4}
                strokeWidth={1.5}
              />
            ))
          : (
            <Area
              type="monotone"
              dataKey="total"
              stroke="#14b8a6"
              fill="#14b8a6"
              fillOpacity={0.4}
              strokeWidth={2}
            />
          )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
