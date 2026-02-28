import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { PolicySummary } from "@/types/api";

interface UsePoliciesResult {
  policies: PolicySummary[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  toggleEnabled: (name: string, enabled: boolean) => void;
}

/**
 * Fetch and manage policies from the proxy's /api/policies endpoint.
 *
 * Only fetches when the proxy connection is active.
 * Provides optimistic toggle for enable/disable with rollback on error.
 */
export function usePolicies(): UsePoliciesResult {
  const { isConnected } = useProxyConnection();
  const [policies, setPolicies] = useState<PolicySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/policies");

      if (!response.ok) {
        throw new Error(`Failed to fetch policies: ${response.status}`);
      }

      const json = (await response.json()) as { policies: PolicySummary[] };
      setPolicies(json.policies);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error fetching policies";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const toggleEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      // Optimistic update: immediately flip local state
      setPolicies((prev) =>
        prev.map((p) => (p.name === name ? { ...p, enabled } : p)),
      );

      try {
        const response = await apiFetch(`/api/policies/${encodeURIComponent(name)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        });

        if (!response.ok) {
          throw new Error(`Failed to toggle policy: ${response.status}`);
        }

        // Refetch to ensure consistency
        fetchPolicies();
      } catch {
        // Revert optimistic update on error
        setPolicies((prev) =>
          prev.map((p) => (p.name === name ? { ...p, enabled: !enabled } : p)),
        );
      }
    },
    [fetchPolicies],
  );

  return { policies, loading, error, refetch: fetchPolicies, toggleEnabled };
}
