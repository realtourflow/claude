# Frontend Migration Plan (Phase 11 — Follow-up PR)

This PR (Phases 0–10) ports the entire Go backend to Next.js 16 + Prisma 7
and lands it under `web/`. The React + Vite frontend at `frontend/` is
untouched and continues to run as a separate Vercel deployment until this
follow-up lands.

Skipping the frontend move in this PR keeps the diff reviewable. The
backend port is already 5,000+ LOC across ~70 endpoints and 14 test files;
folding in the frontend migration would push it past 10K and make it
impossible to review meaningfully.

## What this follow-up will do

Move every UI file out of `frontend/` and into `web/` so the whole app is a
single Next.js deployment. After this lands, you delete `frontend/` and
collapse everything to one Vercel project.

### Step-by-step

1. **Drop a `web/.nvmrc`-pinned shell** (`nvm use`) and confirm `npm run dev`
   serves the current placeholder `web/app/page.tsx` on `:3000`.

2. **Move file trees** (use `git mv` so blame survives):
   - `frontend/src/components/` → `web/components/`
   - `frontend/src/store/` → `web/lib/store/` (Zustand modules, unchanged)
   - `frontend/src/hooks/` → `web/lib/hooks/`
   - `frontend/src/data/` → `web/lib/data/`
   - `frontend/src/api/client.ts` → `web/lib/api.ts`
     - Change the base URL from `import.meta.env.VITE_API_URL` to `/api`
       (same-origin now — no CORS, no separate domain)

3. **Convert React Router routes to App Router file structure.** Every
   route defined in `frontend/src/App.tsx` becomes a directory under
   `web/app/`:
   - `/` → `web/app/page.tsx`
   - `/pipeline` → `web/app/pipeline/page.tsx`
   - `/deals/:id` → `web/app/deals/[id]/page.tsx`
   - `/buyer` → `web/app/buyer/page.tsx`
   - …repeat for every entry in `App.tsx`
   - Pages are client components (`"use client"` at top) so Zustand and the
     existing hooks work unchanged.

4. **Swap Auth0 SDK:**
   - Remove `@auth0/auth0-react` (deps in `frontend/`)
   - Add `@auth0/nextjs-auth0` (already in `web/package.json`)
   - `Auth0Provider` becomes `UserProvider` in `web/app/layout.tsx`
   - `useAuth0()` becomes `useUser()` from `@auth0/nextjs-auth0/client`
   - `getAccessTokenSilently()` is replaced by server-side token retrieval;
     for client-side calls, ship the token to the page via a server
     component → client component handoff, or call internal `/api/*` routes
     that already have the cookie-based session.

5. **Env vars:** every `import.meta.env.VITE_*` becomes `process.env.NEXT_PUBLIC_*`.
   - `VITE_API_URL` is **dropped** — API is now same-origin
   - `VITE_AUTH0_DOMAIN` → `NEXT_PUBLIC_AUTH0_DOMAIN` (already in `.env.example`)
   - `VITE_AUTH0_CLIENT_ID` → `NEXT_PUBLIC_AUTH0_CLIENT_ID`
   - `VITE_AUTH0_AUDIENCE` → `NEXT_PUBLIC_AUTH0_AUDIENCE`

6. **Tailwind config:** copy `frontend/tailwind.config.ts` into
   `web/tailwind.config.ts`. Tailwind 4 is already installed in `web/`,
   just need the custom theme tokens.

7. **`RoleSwitcher` dev tool:** keeps working unchanged — it just toggles
   Zustand state. Continues to be dev-only (`process.env.NODE_ENV !== "production"`).

8. **Playwright E2E:** add a golden-path test at `web/tests/e2e/golden.spec.ts`:
   ```ts
   test("login → pipeline → create deal → advance stage", async ({ page }) => {
     await page.goto("/");
     // Auth0 login flow (uses dev tenant credentials from env)
     // Create deal via UI
     // Advance stage
     // Assert stage updated in UI + persisted on reload
   });
   ```

9. **Cutover commit:**
   - Delete `frontend/` entirely
   - Delete `backend/` (Go code — no longer needed)
   - Update `Makefile`: `dev` runs `cd web && npm run dev`; `migrate` becomes
     `cd web && npx prisma migrate deploy`
   - Update root `CLAUDE.md` — new stack, new layout, new deploy story

10. **Vercel setup:**
    - One Vercel project pointed at `web/`
    - Env vars from `web/.env.example` populated in Vercel dashboard
    - `prisma migrate deploy` runs at build time
    - Single deploy = backend + frontend together

## Why not in this PR

- **Reviewability**: the backend port is already large. Stacking the frontend
  migration on top makes line-by-line review impossible.
- **Risk isolation**: if something breaks, you want to know whether it's
  backend or frontend. A second PR gives you a clean bisect.
- **Frontend still works**: `frontend/` (Vite app) keeps running against its
  current production backend. You can deploy this PR's `web/` to a Vercel
  preview, point Vite at it via `VITE_API_URL`, A/B test, and only cut over
  the frontend when you're satisfied.

## Estimated effort

- Step 2 (file moves): ~1 hour
- Step 3 (router conversion): ~3-4 hours (manual per-page)
- Step 4 (Auth0 SDK swap): ~2 hours including testing protected pages
- Step 5-7 (env + tailwind + RoleSwitcher): ~1 hour
- Step 8 (E2E test): ~2 hours
- Step 9 (cutover): ~1 hour
- Step 10 (Vercel): ~30 min

**Total: ~10-12 hours of focused work.** Best done as a dedicated session
after this backend PR is reviewed and merged.
