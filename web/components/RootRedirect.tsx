"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth0 } from "@auth0/auth0-react";
import { useAuthStore } from "@/lib/store/authStore";
import { GroupId } from "@/permissions/groups";

/**
 * Smart root redirect based on active user group.
 * Returns null while Auth0 and /users/sync are still initializing so we never
 * default-route a buyer or seller to /agent. Ported from the legacy frontend.
 */
export default function RootRedirect() {
  const {
    isLoading: auth0Loading,
    isAuthenticated,
    loginWithRedirect,
    error: auth0Error,
  } = useAuth0();
  const isLoaded = useAuthStore((s) => s.isLoaded);
  const syncError = useAuthStore((s) => s.syncError);
  const activeUser = useAuthStore((s) => s.activeUser);
  const router = useRouter();

  useEffect(() => {
    if (!auth0Loading && !isAuthenticated && !auth0Error) {
      void loginWithRedirect();
    }
  }, [auth0Loading, isAuthenticated, auth0Error, loginWithRedirect]);

  useEffect(() => {
    if (auth0Loading || !isAuthenticated || !isLoaded || auth0Error || syncError) return;
    const groupId = activeUser?.groupId as GroupId | undefined;
    const done = activeUser?.onboardingComplete;
    if (groupId === "admin") return router.replace("/admin");
    // Buyers/sellers run their personalization questionnaire once, right after
    // they accept the invite + create their account, then land on the portal.
    if (groupId === "buyer")
      return router.replace(done ? `/buyer/${activeUser?.id}` : "/onboard/buyer");
    if (groupId === "seller")
      return router.replace(done ? `/seller/${activeUser?.id}` : "/onboard/seller");
    if (groupId === "tc") return router.replace("/tc");
    if (!done) return router.replace("/onboard/agent");
    router.replace("/agent");
  }, [auth0Loading, isAuthenticated, isLoaded, auth0Error, syncError, activeUser, router]);

  if (auth0Error) {
    return (
      <div style={{ padding: 32, fontFamily: "monospace" }}>
        <h2 style={{ color: "red" }}>Auth0 error</h2>
        <pre>{auth0Error.message}</pre>
      </div>
    );
  }

  if (syncError) {
    // "no-access" = the user authenticated but has no role yet (e.g. they logged
    // in without accepting an invite). Actionable, not an outage.
    const noAccess = syncError === "no-access";
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h2 style={{ color: "#0f172a", marginBottom: 8 }}>
            {noAccess ? "You're not set up yet" : "We couldn't load your account"}
          </h2>
          <p style={{ color: "#64748b", lineHeight: 1.5 }}>
            {noAccess
              ? "Open the invite link your agent sent you to finish creating your account — or ask them to resend it."
              : "Something went wrong reaching your account. Please refresh the page. If this keeps happening, contact your agent or support."}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
