import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useAuthStore } from './store/authStore';
import { GroupId } from './permissions/groups';
import { AppLayout } from './components/layout/AppLayout';
import { RoleSwitcher } from './components/RoleSwitcher';

import AgentDashboard from './pages/agent/AgentDashboard';
import CalendarPage from './pages/CalendarPage';
import Pipeline from './pages/agent/Pipeline';
import DealDetail from './pages/agent/DealDetail';
import BuyerView from './pages/buyer/BuyerView';
import SellerView from './pages/seller/SellerView';
import AdminDashboard from './pages/admin/AdminDashboard';
import TCDashboard from './pages/tc/TCDashboard';
import PermissionsDebug from './pages/PermissionsDebug';
import ComingSoon from './pages/ComingSoon';
import SettingsPage from './pages/settings/SettingsPage';
import InvitePage from './pages/invite/InvitePage';
import AgentOnboarding from './pages/onboarding/AgentOnboarding';
import BuyerOnboarding from './pages/onboarding/BuyerOnboarding';
import SellerOnboarding from './pages/onboarding/SellerOnboarding';
import FastPassDetail from './pages/onboarding/FastPassDetail';
import FastPassSurvey from './pages/onboarding/FastPassSurvey';
import SmoothExitDetail from './pages/onboarding/SmoothExitDetail';
import SmoothExitSurvey from './pages/onboarding/SmoothExitSurvey';

// Smart root redirect based on active user group.
// Returns null while Auth0 and /users/sync are still initializing
// so we never default-route a buyer or seller to /agent.
function RootRedirect() {
  const { isLoading: auth0Loading, isAuthenticated, loginWithRedirect, error: auth0Error } = useAuth0();
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const syncError = useAuthStore((s) => s.syncError);
  const activeUser = useAuthStore((s) => s.activeUser);

  useEffect(() => {
    if (!auth0Loading && !isAuthenticated && !auth0Error) {
      loginWithRedirect();
    }
  }, [auth0Loading, isAuthenticated, auth0Error, loginWithRedirect]);

  if (auth0Error) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace' }}>
        <h2 style={{ color: 'red' }}>Auth0 error</h2>
        <pre>{auth0Error.message}</pre>
      </div>
    );
  }

  if (syncError) {
    return (
      <div style={{ padding: 32, fontFamily: 'monospace' }}>
        <h2 style={{ color: 'red' }}>Backend unreachable</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{syncError}</pre>
        <p>The API server is not responding. Check that the ECS service is running and wired to the load balancer.</p>
      </div>
    );
  }

  if (auth0Loading || !isAuthenticated || !isLoaded) return null;

  const groupId = activeUser?.groupId as GroupId | undefined;
  if (groupId === 'admin') return <Navigate to="/admin" replace />;
  if (groupId === 'buyer') return <Navigate to={`/buyer/${activeUser?.id}`} replace />;
  if (groupId === 'seller') return <Navigate to={`/seller/${activeUser?.id}`} replace />;
  if (groupId === 'tc') return <Navigate to="/tc" replace />;
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
        <Route path="/agent/calendar" element={<AppLayout><CalendarPage /></AppLayout>} />
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
        <Route path="/tc/calendar" element={<AppLayout><CalendarPage /></AppLayout>} />
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

        {/* Invite — no layout wrapper */}
        <Route path="/invite/:token" element={<InvitePage />} />

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
