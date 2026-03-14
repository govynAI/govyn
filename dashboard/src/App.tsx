import { Suspense, lazy } from "react";
import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import AuthGate from "./components/AuthGate";
import AppLayout from "./components/layout/AppLayout";
import OverviewPage from "./pages/OverviewPage";
import {
  loadAgentCostDetailPage,
  loadAlertsPage,
  loadApprovalsPage,
  loadCostsPage,
  loadGuidePage,
  loadNewPolicyPage,
  loadPoliciesPage,
  loadPolicyDetailPage,
  loadSettingsPage,
} from "@/lib/dashboard-imports";

const CostsPage = lazy(loadCostsPage);
const PoliciesPage = lazy(loadPoliciesPage);
const ApprovalsPage = lazy(loadApprovalsPage);
const AlertsPage = lazy(loadAlertsPage);
const AgentCostDetailPage = lazy(loadAgentCostDetailPage);
const PolicyDetailPage = lazy(loadPolicyDetailPage);
const NewPolicyPage = lazy(loadNewPolicyPage);
const GuidePage = lazy(loadGuidePage);
const SettingsPage = lazy(loadSettingsPage);

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8 text-sm text-[var(--muted-foreground)]">
      Loading page...
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/costs" element={<CostsPage />} />
            <Route path="/costs/:agentId" element={<AgentCostDetailPage />} />
            <Route path="/policies" element={<PoliciesPage />} />
            <Route path="/policies/new" element={<NewPolicyPage />} />
            <Route path="/policies/:policyName" element={<PolicyDetailPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
      <Toaster richColors position="bottom-right" />
    </AuthGate>
  );
}
