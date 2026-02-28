import { Badge } from "@/components/ui/badge";

interface BudgetBadgeProps {
  percentUsed: number | null;
  hasLimit: boolean;
}

/**
 * Budget status badge showing OK / Warning / Exceeded.
 *
 * Returns null when no budget limit is set.
 */
export function BudgetBadge({ percentUsed, hasLimit }: BudgetBadgeProps) {
  if (!hasLimit || percentUsed === null) {
    return null;
  }

  if (percentUsed >= 90) {
    return <Badge variant="destructive">Exceeded</Badge>;
  }

  if (percentUsed >= 70) {
    return (
      <Badge variant="secondary">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Warning
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      OK
    </Badge>
  );
}
