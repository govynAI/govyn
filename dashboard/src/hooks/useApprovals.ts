import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { ApprovalRequest, ApprovalStatus, ApprovalsApiResponse } from "@/types/api";

interface UseApprovalsResult {
  approvals: ApprovalRequest[];
  total: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch approval requests from the proxy's /api/approvals endpoint.
 *
 * Gates on proxy connection. Auto-refreshes when statusFilter includes
 * 'pending' (every autoRefreshMs, default 10s). Stops auto-refresh
 * for history views to reduce DB load.
 */
export function useApprovals(
  statusFilter: ApprovalStatus | "all" | string,
  options?: { autoRefreshMs?: number },
): UseApprovalsResult {
  const { isConnected } = useProxyConnection();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshMs = options?.autoRefreshMs ?? 10_000;

  // Track latest statusFilter in a ref so the interval callback
  // always sees the current value without re-creating the interval
  const filterRef = useRef(statusFilter);
  filterRef.current = statusFilter;

  const fetchApprovals = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filterRef.current !== "all") {
        params.set("status", filterRef.current);
      }
      params.set("limit", "100");

      const queryString = params.toString();
      const path = `/api/approvals${queryString ? `?${queryString}` : ""}`;
      const response = await apiFetch(path);

      if (!response.ok) {
        throw new Error(`Failed to fetch approvals: ${response.status}`);
      }

      const json = (await response.json()) as ApprovalsApiResponse;
      setApprovals(json.approvals);
      setTotal(json.total);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error fetching approvals";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  // Fetch on mount and when connection/filter changes
  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals, statusFilter]);

  // Auto-refresh for pending view only
  useEffect(() => {
    if (!isConnected) return;

    const isPending = statusFilter === "pending" || statusFilter.includes("pending");
    if (!isPending) return;

    const interval = setInterval(() => {
      fetchApprovals();
    }, refreshMs);

    return () => clearInterval(interval);
  }, [isConnected, statusFilter, refreshMs, fetchApprovals]);

  return { approvals, total, loading, error, refetch: fetchApprovals };
}
