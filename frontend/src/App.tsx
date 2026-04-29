import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { GroupId } from './permissions/groups';
import { AppLayout } from './components/layout/AppLayout';
import { RoleSwitcher } from './components/RoleSwitcher';

import AgentDashboard from './pages/agent/AgentDashboard';
import Pipeline from './pages/agent/Pipeline';
import DealDetail from './pages/agent/DealDetail';
import BuyerView from './pages/buyer/BuyerView';
import SellerView from './pages/seller/SellerView';
import AdminDashboard from './pages/admin/AdminDashboard';
import TCDashboard from './pages/tc/TCDashboard';
import PermissionsDebug from './pages/PermissionsDebug';
import ComingSoon from './pages/ComingSoon';
import SettingsPage from './pages/settings/SettingsPage';
import AgentOnboarding from './pages/onboarding/AgentOnboarding';
import BuyerOnboarding from './pages/onboarding/BuyerOnboarding';
import SellerOnboarding from './pages/onboarding/SellerOnboarding';
import FastPassDetail from './pages/onboarding/FastPassDetail';
import FastPassSurvey from './pages/onboarding/FastPassSurvey';
import SmoothExitDetail from './pages/onboarding/SmoothExitDetail';
import SmoothExitSurvey from './pages/onboarding/SmoothExitSurvey';

// Smart root redirect based on active user group
function RootRedirect() {
  const activeUser = useAuthStore((s) => s.activeUser);
  const groupId = activeUser?.groupId as GroupId | undefined;

  if (groupId === 'admin') return <Navigate to="/admin" replace />;
  if (groupId === 'buyer') return <Navigate to={`/buyer/${activeUser?.id}`} replace />;
  if (groupId === 'seller') return <Navigate to={`/seller/${activeUser?.id}`} replace />;
  if (groupId === 'tc') return <Navigate to="/tc" replace />;
  // Default: agent
  return <Navigate to="/agent" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root smart redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Agent routes */}
        <Route
          path="/agent"
          element={
            <AppLayout>
              <AgentDashboard />
            </AppLayout>
          }
        />
        <Route
          path="/agent/pipeline"
          element={
            <AppLayout>
              <Pipeline />
            </AppLayout>
          }
        />
        <Route
          path="/agent/deals/:dealId"
          element={
            <AppLayout>
              <DealDetail />
            </AppLayout>
          }
        />
        <Route path="/agent/deals" element={<AppLayout><Pipeline /></AppLayout>} />
        <Route path="/agent/calendar" element={<AppLayout><ComingSoon title="Calendar" /></AppLayout>} />
        <Route path="/agent/messages" element={<AppLayout><ComingSoon title="Messages" /></AppLayout>} />
        <Route path="/agent/documents" element={<AppLayout><ComingSoon title="Documents" /></AppLayout>} />
        <Route path="/agent/settings" element={<AppLayout><SettingsPage /></AppLayout>} />

        {/* Buyer routes */}
        <Route
          path="/buyer/:userId"
          element={
            <AppLayout>
              <BuyerView />
            </AppLayout>
          }
        />

        {/* Seller routes */}
        <Route
          path="/seller/:userId"
          element={
            <AppLayout>
              <SellerView />
            </AppLayout>
          }
        />

        {/* Admin routes */}
        <Route path="/admin/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
        <Route
          path="/admin"
          element={
            <AppLayout>
              <AdminDashboard />
            </AppLayout>
          }
        />
        <Route
          path="/admin/:section"
          element={
            <AppLayout>
              <AdminDashboard />
            </AppLayout>
          }
        />

        {/* TC routes */}
        <Route path="/tc/settings" element={<AppLayout><SettingsPage /></AppLayout>} />
        <Route path="/tc/deals/:dealId" element={<AppLayout><DealDetail /></AppLayout>} />
        <Route
          path="/tc"
          element={
            <AppLayout>
              <TCDashboard />
            </AppLayout>
          }
        />
        <Route
          path="/tc/:section"
          element={
            <AppLayout>
              <TCDashboard />
            </AppLayout>
          }
        />

        {/* Onboarding — no layout wrapper */}
        <Route path="/onboard/agent" element={<AgentOnboarding />} />
        <Route path="/onboard/buyer" element={<BuyerOnboarding />} />
        <Route path="/onboard/seller" element={<SellerOnboarding />} />
        <Route path="/fast-pass" element={<FastPassDetail />} />
        <Route path="/fast-pass/survey" element={<FastPassSurvey />} />
        <Route path="/smooth-exit" element={<SmoothExitDetail />} />
        <Route path="/smooth-exit/survey" element={<SmoothExitSurvey />} />

        {/* Debug — no layout wrapper */}
        <Route path="/debug/permissions" element={<PermissionsDebug />} />
      </Routes>

      {/* RoleSwitcher renders on every page (fixed position) */}
      <RoleSwitcher />
    </BrowserRouter>
  );
}
