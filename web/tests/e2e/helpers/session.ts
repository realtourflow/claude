import type { Page } from "@playwright/test";

/**
 * Seeded-session helper (test-only). Mints a session via the test-auth endpoint
 * and stashes it in the `rtf_e2e_session` cookie the app reads on load
 * (`TestAuthSetup`). After this resolves, navigating to a protected page lands
 * the user authenticated — no real Auth0 login.
 *
 * Requires the dev server to run with `E2E_AUTH=1` / `NEXT_PUBLIC_E2E_AUTH=1`
 * (Playwright's webServer sets both — see `playwright.config.ts`).
 */
const COOKIE = "rtf_e2e_session";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ??
  `http://localhost:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

export type SeededSession = {
  token: string;
  id: string;
  name: string;
  email: string;
  role: string;
};

export async function seedSession(
  page: Page,
  opts: { role?: string; name?: string; email?: string; sub?: string } = {}
): Promise<SeededSession> {
  const res = await page.request.post("/api/test-auth", {
    data: {
      role: opts.role ?? "agent",
      name: opts.name,
      email: opts.email,
      sub: opts.sub,
    },
  });
  if (!res.ok()) {
    throw new Error(
      `POST /api/test-auth failed: ${res.status()} ${await res.text()}`
    );
  }
  const session = (await res.json()) as SeededSession;

  await page.context().addCookies([
    {
      name: COOKIE,
      value: encodeURIComponent(JSON.stringify(session)),
      url: BASE_URL,
    },
  ]);

  return session;
}
