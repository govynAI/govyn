import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import { toApiPeriod, type CostsApiResponse, type DashboardPeriod } from "@/types/api";

interface UseCostsResult {
  data: CostsApiResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch cost data from the proxy's /api/costs endpoint.
 *
 * Only fetches when the proxy connection is active.
 * Re-fetches automatically when the selected period or agentId changes.
 *
 * @param period  Dashboard period to query
 * @param agentId Optional agent ID to filter costs for a single agent
 */
export function useCosts(period: DashboardPeriod, agentId?: string): UseCostsResult {
  const { isConnected } = useProxyConnection();
  const [data, setData] = useState<CostsApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCosts = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const apiPeriod = toApiPeriod(period);
      let url = `/api/costs?period=${apiPeriod}`;
      if (agentId) {
        url += `&agent=${encodeURIComponent(agentId)}`;
      }
      const response = await apiFetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch costs: ${response.status}`);
      }

      const json = (await response.json()) as CostsApiResponse;
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error fetching costs";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected, period, agentId]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  return { data, loading, error, refetch: fetchCosts };
}
