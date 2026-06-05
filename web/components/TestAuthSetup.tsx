"use client";

import { useEffect } from "react";
import { setTokenGetter } from "@/lib/api-client";
import { useAuthStore } from "@/lib/store/authStore";

/**
 * E2E-only replacement for {@link AuthSetup}. Reads the seeded session from the
 * `rtf_e2e_session` cookie (set by the Playwright helper), wires the API client
 * to send the test JWT, and populates the auth store — the same end-state real
 * login produces via Auth0 + `/users/sync`, minus the Auth0 round-trip.
 *
 * Only mounted when `NEXT_PUBLIC_E2E_AUTH === "1"` (see `Providers`). On reload
 * the cookie persists, so the session is re-established automatically.
 */
type E2ESession = {
  token: string;
  id: string;
  name: string;
  email: string;
  role: string;
};

const COOKIE = "rtf_e2e_session";

function readSessionCookie(): E2ESession | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!entry) return null;
  try {
    return JSON.parse(decodeURIComponent(entry.slice(COOKIE.length + 1)));
  } catch {
    return null;
  }
}

export default function TestAuthSetup({
  children,
}: {
  children: React.ReactNode;
}) {
  const setFromAuth0 = useAuthStore((s) => s.setFromAuth0);
  const setSyncError = useAuthStore((s) => s.setSyncError);

  useEffect(() => {
    const session = readSessionCookie();
    if (!session) {
      setSyncError("E2E session cookie missing — call POST /api/test-auth");
      return;
    }
    // Token getter must be set before the auth store flips `isLoaded`, so the
    // first authed API call from a protected page already carries the token.
    setTokenGetter(() => Promise.resolve(session.token));
    setFromAuth0(session.id, session.name, session.email, session.role, true);
  }, [setFromAuth0, setSyncError]);

  return <>{children}</>;
}
