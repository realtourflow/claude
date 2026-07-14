"use client";

import { Auth0Provider } from "@auth0/auth0-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api-client";
import AuthSetup from "@/components/AuthSetup";
import TestAuthSetup from "@/components/TestAuthSetup";

// E2E-only: when Playwright seeds a session we bypass Auth0 entirely (see
// TestAuthSetup). Off in every normal/production build.
const E2E_AUTH = process.env.NEXT_PUBLIC_E2E_AUTH === "1";

// useSyncExternalStore returns the server snapshot (`false`) during SSR AND the
// first client/hydration render, then the client snapshot (`true`) — so the
// hydration render matches the server output without a setState-in-effect.
const subscribeNoop = () => () => {};
const getIsClient = () => true;
const getIsServer = () => false;

/**
 * Client-side provider stack. Wraps everything in Auth0Provider so React Router
 * pages can call useAuth0(); also fires /users/sync via AuthSetup.
 *
 * The provider stack is deferred until the client (see the `isClient` flag) so
 * the first client render matches the server-rendered HTML — otherwise the
 * client-only Auth0Provider subtree triggers a hydration mismatch.
 */
export function Providers({ children }: { children: ReactNode }) {
  // Defer the entire client-only provider stack until after the first client
  // render. SSR and the initial client render must produce the SAME tree or
  // React throws a hydration mismatch. Reading `window.location.origin` in a
  // useState initializer broke that: the server rendered just `children` (no
  // `window` → no providers), while the client's first render injected
  // the Auth0Provider subtree the server never produced
  // (issue #102). Gating on a client flag keeps the first client render
  // identical to SSR, then swaps in the providers once `window` is guaranteed.
  const isClient = useSyncExternalStore(subscribeNoop, getIsClient, getIsServer);

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

  // First client render matches the server (children only) → clean hydration.
  // Once we're on the client we know `window` exists, so the providers can
  // read the redirect origin.
  if (!isClient) return <>{children}</>;

  const origin = window.location.origin;

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
      </Auth0Provider>
    </QueryClientProvider>
  );
}
