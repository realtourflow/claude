"use client";

import { Auth0Provider } from "@auth0/auth0-react";
import { ReactNode, useEffect, useState } from "react";
import AuthSetup from "@/components/AuthSetup";
import { RoleSwitcher } from "@/components/RoleSwitcher";

/**
 * Client-side provider stack. Wraps everything in Auth0Provider so React Router
 * pages can call useAuth0(); also fires /users/sync via AuthSetup and renders
 * the dev-only RoleSwitcher overlay.
 *
 * `window.location.origin` is read inside useEffect so the server render and
 * client first paint don't disagree.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Skip Auth0 entirely until we know the redirect origin — prevents Auth0
  // from initializing with `window` undefined during SSR.
  if (!origin) return <>{children}</>;

  return (
    <Auth0Provider
      domain={process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? ""}
      clientId={process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID ?? ""}
      authorizationParams={{
        redirect_uri: origin,
        audience: process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
      }}
    >
      <AuthSetup>{children}</AuthSetup>
      <RoleSwitcher />
    </Auth0Provider>
  );
}
