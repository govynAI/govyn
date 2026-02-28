import type { DashboardPeriod } from "@/types/api";

const periods: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "all", label: "All Time" },
];

interface PeriodSwitcherProps {
  value: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
}

/**
 * Tab-style segmented control for selecting the cost display period.
 */
export function PeriodSwitcher({ value, onChange }: PeriodSwitcherProps) {
  return (
    <div className="inline-flex rounded-lg bg-[var(--muted)] p-1 gap-1">
      {periods.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === p.value
              ? "bg-[var(--primary)] text-white shadow-sm"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
