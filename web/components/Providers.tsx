"use client";

import { Auth0Provider } from "@auth0/auth0-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { ApiError } from "@/lib/api-client";
import AuthSetup from "@/components/AuthSetup";
import TestAuthSetup from "@/components/TestAuthSetup";
import { RoleSwitcher } from "@/components/RoleSwitcher";

// E2E-only: when Playwright seeds a session we bypass Auth0 entirely (see
// TestAuthSetup). Off in every normal/production build.
const E2E_AUTH = process.env.NEXT_PUBLIC_E2E_AUTH === "1";

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
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Never retry auth errors (401/403) — they're permanent until the user
            // re-authenticates. Cap all other errors at 2 retries (issue #108).
            retry: (failureCount: number, error: unknown) => {
              if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
              return failureCount < 2;
            },
            retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 30_000),
          },
        },
      }),
  );

  // Skip Auth0 entirely until we know the redirect origin — prevents Auth0
  // from initializing with `window` undefined during SSR.
  if (!origin) return <>{children}</>;

  // E2E: seeded session via cookie, no Auth0Provider. The E2E flow only visits
  // protected pages (which read identity from the auth store), so nothing calls
  // useAuth0 and we can drop the provider safely.
  if (E2E_AUTH) {
    return (
      <QueryClientProvider client={queryClient}>
        <TestAuthSetup>{children}</TestAuthSetup>
      </QueryClientProvider>
    );
  }

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
