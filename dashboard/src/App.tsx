import { Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import AuthGate from "./components/AuthGate";
import AppLayout from "./components/layout/AppLayout";
import OverviewPage from "./pages/OverviewPage";
import CostsPage from "./pages/CostsPage";
import PoliciesPage from "./pages/PoliciesPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import AlertsPage from "./pages/AlertsPage";
import AgentCostDetailPage from "./pages/AgentCostDetailPage";
import PolicyDetailPage from "./pages/PolicyDetailPage";
import NewPolicyPage from "./pages/NewPolicyPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <AuthGate>
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
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster richColors position="bottom-right" />
    </AuthGate>
  );
}
