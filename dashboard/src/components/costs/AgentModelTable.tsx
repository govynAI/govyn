import { useMemo } from "react";
import type { ModelBreakdown } from "@/types/api";

interface AgentModelTableProps {
  models: Record<string, ModelBreakdown>;
  loading?: boolean;
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const numberFormat = new Intl.NumberFormat("en-US");

/**
 * Model breakdown table showing cost, requests, and token counts per model.
 *
 * Sorted by cost descending. Used on the agent detail page.
 */
export function AgentModelTable({ models, loading }: AgentModelTableProps) {
  const sortedModels = useMemo(() => {
    return Object.entries(models)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.cost - a.cost);
  }, [models]);

  const headerClass =
    "px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]";

  if (loading) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className={`${headerClass} text-left`}>Model</th>
              <th className={`${headerClass} text-right`}>Cost</th>
              <th className={`${headerClass} text-right`}>Requests</th>
              <th className={`${headerClass} text-right`}>Input Tokens</th>
              <th className={`${headerClass} text-right`}>Output Tokens</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((i) => (
              <tr key={i} className="border-b border-[var(--border)]">
                <td className="px-4 py-3">
                  <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-12 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (sortedModels.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">
        No model data
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className={`${headerClass} text-left`}>Model</th>
            <th className={`${headerClass} text-right`}>Cost</th>
            <th className={`${headerClass} text-right`}>Requests</th>
            <th className={`${headerClass} text-right`}>Input Tokens</th>
            <th className={`${headerClass} text-right`}>Output Tokens</th>
          </tr>
        </thead>
        <tbody>
          {sortedModels.map((model) => (
            <tr
              key={model.name}
              className="border-b border-[var(--border)] transition-colors hover:bg-[var(--muted)]/50"
            >
              <td className="px-4 py-3 font-medium text-[var(--foreground)]">
                {model.name}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                {usdFormat.format(model.cost)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                {numberFormat.format(model.requests)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                {numberFormat.format(model.inputTokens)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)]">
                {numberFormat.format(model.outputTokens)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
