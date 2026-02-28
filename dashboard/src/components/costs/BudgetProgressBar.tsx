interface BudgetProgressBarProps {
  percentUsed: number | null;
  softLimitPercent?: number;
  hasLimit: boolean;
}

/**
 * Budget progress bar with green/yellow/red color zones.
 *
 * Color zones:
 *  - 0-70%:   green  (emerald-500)
 *  - 70-90%:  yellow (amber-500)
 *  - 90-100%: red    (red-500)
 */
export function BudgetProgressBar({
  percentUsed,
  softLimitPercent,
  hasLimit,
}: BudgetProgressBarProps) {
  if (!hasLimit || percentUsed === null) {
    return (
      <span className="text-xs text-[var(--muted-foreground)]">
        No budget set
      </span>
    );
  }

  const clampedPercent = Math.min(percentUsed, 100);
  const barColor =
    percentUsed >= 90
      ? "bg-red-500"
      : percentUsed >= 70
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="w-full min-w-[100px]">
      <div className="relative h-2 w-full rounded-full bg-[var(--muted)]">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${clampedPercent}%` }}
        />
        {softLimitPercent != null && softLimitPercent > 0 && softLimitPercent < 100 && (
          <div
            className="absolute top-0 h-2 w-px bg-[var(--foreground)]/40"
            style={{ left: `${softLimitPercent}%` }}
            title={`Soft limit at ${softLimitPercent}%`}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
        {percentUsed.toFixed(0)}% used
      </p>
    </div>
  );
}
