import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { AlertHistoryEntry, AlertHistoryApiResponse } from "@/types/api";

interface UseAlertHistoryOptions {
  ruleId?: string;
  limit?: number;
}

interface UseAlertHistoryResult {
  alerts: AlertHistoryEntry[];
  total: number;
  loading: boolean;
  error: string | null;
  available: boolean;
  unavailableReason: string | null;
  refetch: () => void;
}

/**
 * Fetch alert history from the proxy's /api/alerts/history endpoint.
 *
 * Only fetches when the proxy connection is active.
 * Supports optional filtering by rule_id and pagination via limit.
 */
export function useAlertHistory(
  options?: UseAlertHistoryOptions,
): UseAlertHistoryResult {
  const { isConnected } = useProxyConnection();
  const [alerts, setAlerts] = useState<AlertHistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  const ruleId = options?.ruleId;
  const limit = options?.limit ?? 50;

  const fetchHistory = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (ruleId) {
        params.set("rule_id", ruleId);
      }

      const queryString = params.toString();
      const path = `/api/alerts/history${queryString ? `?${queryString}` : ""}`;
      const response = await apiFetch(path);

      if (!response.ok) {
        throw new Error(`Failed to fetch alert history: ${response.status}`);
      }

      const json = (await response.json()) as AlertHistoryApiResponse;
      setAlerts(json.alerts);
      setTotal(json.total);
      setAvailable(json.available ?? true);
      setUnavailableReason(
        json.available === false
          ? json.reason ?? "Alerts are unavailable on this proxy."
          : null,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error fetching alert history";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected, ruleId, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    alerts,
    total,
    loading,
    error,
    available,
    unavailableReason,
    refetch: fetchHistory,
  };
}
