import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type {
  AlertRule,
  AlertRuleCreatePayload,
  AlertRulesApiResponse,
} from "@/types/api";

interface TestWebhookResult {
  success: boolean;
  status?: number;
  error?: string;
}

interface UseAlertsResult {
  rules: AlertRule[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createRule: (payload: AlertRuleCreatePayload) => Promise<void>;
  updateRule: (id: string, updates: Partial<AlertRuleCreatePayload & { enabled: boolean }>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  toggleEnabled: (id: string, enabled: boolean) => void;
  testWebhook: (url: string) => Promise<TestWebhookResult>;
}

/**
 * Fetch and manage alert rules from the proxy's /api/alerts/rules endpoint.
 *
 * Only fetches when the proxy connection is active.
 * Provides CRUD operations, optimistic toggle, and webhook testing.
 */
export function useAlerts(): UseAlertsResult {
  const { isConnected } = useProxyConnection();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    if (!isConnected) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/alerts/rules");

      if (!response.ok) {
        throw new Error(`Failed to fetch alert rules: ${response.status}`);
      }

      const json = (await response.json()) as AlertRulesApiResponse;
      setRules(json.rules);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error fetching alert rules";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const createRule = useCallback(
    async (payload: AlertRuleCreatePayload) => {
      const response = await apiFetch("/api/alerts/rules", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(
          (err as { error?: string }).error || `Failed to create rule: ${response.status}`,
        );
      }

      await fetchRules();
    },
    [fetchRules],
  );

  const updateRule = useCallback(
    async (id: string, updates: Partial<AlertRuleCreatePayload & { enabled: boolean }>) => {
      const response = await apiFetch(`/api/alerts/rules/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(
          (err as { error?: string }).error || `Failed to update rule: ${response.status}`,
        );
      }

      await fetchRules();
    },
    [fetchRules],
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const response = await apiFetch(`/api/alerts/rules/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(
          (err as { error?: string }).error || `Failed to delete rule: ${response.status}`,
        );
      }

      await fetchRules();
    },
    [fetchRules],
  );

  const toggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      // Optimistic update: immediately flip local state
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled } : r)),
      );

      try {
        const response = await apiFetch(`/api/alerts/rules/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ enabled }),
        });

        if (!response.ok) {
          throw new Error(`Failed to toggle rule: ${response.status}`);
        }

        // Refetch to ensure consistency
        fetchRules();
      } catch {
        // Revert optimistic update on error
        setRules((prev) =>
          prev.map((r) => (r.id === id ? { ...r, enabled: !enabled } : r)),
        );
      }
    },
    [fetchRules],
  );

  const testWebhook = useCallback(
    async (url: string): Promise<TestWebhookResult> => {
      try {
        const response = await apiFetch("/api/alerts/test", {
          method: "POST",
          body: JSON.stringify({ webhook_url: url }),
        });

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}` };
        }

        return (await response.json()) as TestWebhookResult;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [],
  );

  return {
    rules,
    loading,
    error,
    refetch: fetchRules,
    createRule,
    updateRule,
    deleteRule,
    toggleEnabled,
    testWebhook,
  };
}
