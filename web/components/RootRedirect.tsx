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
    if (groupId === "admin") return router.replace("/admin");
    if (groupId === "buyer") return router.replace(`/buyer/${activeUser?.id}`);
    if (groupId === "seller") return router.replace(`/seller/${activeUser?.id}`);
    if (groupId === "tc") return router.replace("/tc");
    if (!activeUser?.onboardingComplete) return router.replace("/onboard/agent");
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
    return (
      <div style={{ padding: 32, fontFamily: "monospace" }}>
        <h2 style={{ color: "red" }}>Backend unreachable</h2>
        <pre style={{ whiteSpace: "pre-wrap" }}>{syncError}</pre>
        <p>
          The API server is not responding. Check that the ECS service is
          running and wired to the load balancer.
        </p>
      </div>
    );
  }

  return null;
}
