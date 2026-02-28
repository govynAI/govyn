import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { BudgetStatus } from "@/types/api";

interface UseBudgetsResult {
  data: BudgetStatus[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch budget status from the proxy's /api/budgets endpoint.
 *
 * Budgets are current state (no period parameter needed).
 * Only fetches when the proxy connection is active.
 */
export function useBudgets(): UseBudgetsResult {
  const { isConnected } = useProxyConnection();
  const [data, setData] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBudgets = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/budgets");

      if (!response.ok) {
        throw new Error(`Failed to fetch budgets: ${response.status}`);
      }

      const json = (await response.json()) as BudgetStatus[];
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error fetching budgets";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    fetchBudgets();
  }, [fetchBudgets]);

  return { data, loading, error, refetch: fetchBudgets };
}
