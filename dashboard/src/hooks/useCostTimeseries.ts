import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import {
  toApiPeriod,
  type CostTimeSeriesApiResponse,
  type DashboardPeriod,
} from "@/types/api";

interface UseCostTimeseriesResult {
  data: CostTimeSeriesApiResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCostTimeseries(
  period: DashboardPeriod,
  agentId?: string,
): UseCostTimeseriesResult {
  const { isConnected } = useProxyConnection();
  const [data, setData] = useState<CostTimeSeriesApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTimeseries = useCallback(async () => {
    if (!isConnected) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const apiPeriod = toApiPeriod(period);
      let url = `/api/costs/timeseries?period=${apiPeriod}`;
      if (agentId) {
        url += `&agent=${encodeURIComponent(agentId)}`;
      }

      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch cost history: ${response.status}`);
      }

      const json = (await response.json()) as CostTimeSeriesApiResponse;
      setData(json);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error fetching cost history";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [agentId, isConnected, period]);

  useEffect(() => {
    void fetchTimeseries();
  }, [fetchTimeseries]);

  return {
    data,
    loading,
    error,
    refetch: fetchTimeseries,
  };
}
