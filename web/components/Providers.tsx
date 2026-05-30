"use client";

import { Auth0Provider } from "@auth0/auth0-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import AuthSetup from "@/components/AuthSetup";
import { RoleSwitcher } from "@/components/RoleSwitcher";

/**
 * Client-side provider stack. Wraps everything in Auth0Provider so React Router
 * pages can call useAuth0(); also fires /users/sync via AuthSetup and renders
 * the dev-only RoleSwitcher overlay.
 *
 * `window.location.origin` is read lazily from the useState initializer so the
 * value is stable across renders and we don't trigger React 19's
 * set-state-in-effect rule.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Lazy initializer keeps origin stable across renders.
  // On SSR `window` is undefined → origin stays undefined → we short-circuit below.
  const [origin] = useState<string | undefined>(() =>
    typeof window !== "undefined" ? window.location.origin : undefined,
  );

  // One QueryClient per Providers mount. Lazy initializer ensures we don't
  // recreate it on every render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s — matches our previous manual-refresh cadence
            refetchOnWindowFocus: false, // keep parity with existing useEffect+useState hooks
            retry: 1,
          },
        },
      }),
  );

  // Skip Auth0 entirely until we know the redirect origin — prevents Auth0
  // from initializing with `window` undefined during SSR.
  if (!origin) return <>{children}</>;

  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  );
}
