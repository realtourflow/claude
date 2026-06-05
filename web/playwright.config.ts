import { defineConfig, devices } from "@playwright/test";

// E2E runs on a dedicated port so it never collides with a developer's normal
// `npm run dev` on :3000, and the dev server it boots gets the test-auth flags
// (`E2E_AUTH` server-side, `NEXT_PUBLIC_E2E_AUTH` client-side) that switch the
// app to the seeded-session path. See `lib/test-auth.ts` / `TestAuthSetup`.
const PORT = process.env.PLAYWRIGHT_PORT ?? "3100";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  // Dev-mode (Turbopack) compiles each route on first hit, so the first test
  // pays a cold-compile tax on every new page. Give it room.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 120_000,
    // Client-side navigations (e.g. clicking a deal card) compile the target
    // route on first hit; the auto-wait on the next locator must absorb that.
    actionTimeout: 60_000,
    // Always trace locally so the manual UAT can open it; lean in CI.
    trace: process.env.CI ? "on-first-retry" : "on",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `next dev -p ${PORT}`,
    // Probe a route handler, not "/": it compiles fast and returns 200, so
    // readiness detection doesn't wait on the full page bundle.
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      E2E_AUTH: "1",
      NEXT_PUBLIC_E2E_AUTH: "1",
    },
  },
});
