function cacheImport<T>(loader: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;

  return () => {
    promise ??= loader();
    return promise;
  };
}

export const loadCostsPage = cacheImport(() => import("@/pages/CostsPage"));
export const loadPoliciesPage = cacheImport(() => import("@/pages/PoliciesPage"));
export const loadApprovalsPage = cacheImport(() => import("@/pages/ApprovalsPage"));
export const loadAlertsPage = cacheImport(() => import("@/pages/AlertsPage"));
export const loadAgentCostDetailPage = cacheImport(() => import("@/pages/AgentCostDetailPage"));
export const loadPolicyDetailPage = cacheImport(() => import("@/pages/PolicyDetailPage"));
export const loadNewPolicyPage = cacheImport(() => import("@/pages/NewPolicyPage"));
export const loadGuidePage = cacheImport(() => import("@/pages/GuidePage"));
export const loadSettingsPage = cacheImport(() => import("@/pages/SettingsPage"));
export const loadCostAreaChartModule = cacheImport(() => import("@/components/costs/CostAreaChart"));
export const loadPolicyEditorModule = cacheImport(() => import("@/components/policies/PolicyEditor"));

const prefetchers = new Map<string, Array<() => Promise<unknown>>>([
  ["/costs", [loadCostsPage, loadAgentCostDetailPage, loadCostAreaChartModule]],
  ["/policies", [loadPoliciesPage, loadNewPolicyPage, loadPolicyDetailPage, loadPolicyEditorModule]],
  ["/approvals", [loadApprovalsPage]],
  ["/alerts", [loadAlertsPage]],
  ["/guide", [loadGuidePage]],
  ["/settings", [loadSettingsPage]],
]);

export function prefetchDashboardPath(path: string): void {
  for (const [prefix, loaders] of prefetchers.entries()) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      for (const load of loaders) {
        void load();
      }
      return;
    }
  }
}
