# RealTourFlow — `web/`

The launch product: a single **Next.js 16 (App Router) + Prisma 7** app that serves
**both the UI and the API**. This is the only app we ship — the legacy Go `backend/`
and Vite `frontend/` are being retired.

This README is the developer runbook: clone → running → tests passing. For architecture,
the real/mock inventory, and the legacy-cutover plan, read the repo-root
[`CLAUDE.md`](../CLAUDE.md).

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| **Node** | **22** (see [`.nvmrc`](.nvmrc)) | Runs the app and the test suite |
| **Docker Desktop** | any recent | Local Postgres 16 via Docker Compose |
| **golang-migrate** CLI | v4.x | Applies migrations — used by `make migrate` **and** by the test setup |

```bash
nvm use                       # picks up .nvmrc → Node 22
brew install golang-migrate   # provides the `migrate` binary
# Docker Desktop must be running before `make db`
```

> Migrations are still golang-migrate SQL (not `prisma migrate`) — see
> [Database & migrations](#database--migrations). The `migrate` CLI is a hard
> requirement: `npm test` shells out to it to build the test database.

---

## First-time setup

Run from the repo root unless noted. `make` targets wrap the `web/` commands.

```bash
# 1. Environment file — copy the template and fill it in (see Environment below)
cp web/.env.example web/.env

# 2. Start local Postgres 16 (Docker, detached)
make db

# 3. Apply all migrations to the local DB
DATABASE_URL="postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable" make migrate

# 4. Install dependencies (clean install from the lockfile)
cd web && npm ci

# 5. Start the app (UI + API) → http://localhost:3000
npm run dev
```

Install runs `prisma generate` automatically (`postinstall`), so the Prisma client is
ready afterward. `npm ci` is the clean, lockfile-strict install CI uses; `make install`
(which runs `npm install`) is the looser equivalent if you prefer make.

---

## Environment

**Source of truth: [`web/lib/env.ts`](lib/env.ts).** It validates `process.env` with Zod
at runtime. Copy [`web/.env.example`](.env.example) to `web/.env` and fill it in; never
commit `.env`.

Almost every variable has a safe default. Only three have **no default** and must be set
for the server to boot:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Postgres connection string. Local: `postgresql://postgres:postgres@localhost:5432/realtourflow?schema=public` |
| `AUTH0_DOMAIN` | Auth0 tenant (server-side JWT validation) |
| `AUTH0_AUDIENCE` | Auth0 API audience |

To actually **log in** through the browser you also need the client-side Auth0 trio
(read directly from `process.env`, so they live in `.env.example`, not `lib/env.ts`):
`NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_AUTH0_AUDIENCE`.

Everything else (Stripe, S3, ARIVE, DocuSign, Google/Microsoft calendar OAuth, Resend)
defaults to empty and the matching feature simply stays inert until you configure it.
Calendar OAuth app registration is documented in the repo-root
[`CLAUDE.md`](../CLAUDE.md).

---

## Commands

Run these from `web/` (or use the `make` wrapper from the repo root).

| Command | make | What it does |
|---|---|---|
| `npm run dev` | `make dev` | Start the app (UI + API) on http://localhost:3000 |
| `npm test` | `make test` | Run the Vitest unit + integration suite once |
| `npm run test:e2e` | — | Run the Playwright end-to-end suite |
| `npm run lint` | `make lint` | ESLint |
| `npm run typecheck` | `make typecheck` | `tsc --noEmit` — zero type errors required |
| `npm run build` | `make build` | Production build |

Extras: `npm run test:watch` (Vitest watch), `npm run test:coverage`,
`npm run prisma:pull`, `npm run prisma:generate`.

CI ([`.github/workflows/web-ci.yml`](../.github/workflows/web-ci.yml)) runs typecheck →
lint → Vitest on every push. Keep all three green.

---

## Tests

### Unit + integration — `npm test` (Vitest)

The integration tests run against a **real local Postgres**, not mocks. Before running
them, make sure `make db` is up and the `migrate` CLI is installed — the Vitest
`globalSetup` ([`tests/setup/global-setup.ts`](tests/setup/global-setup.ts)) drops and
recreates a `realtourflow_test` database and applies the golang-migrate schema into it on
every run. Each test file truncates user-data tables between tests; schema tables persist.

```bash
make db            # if not already running
cd web && npm test
```

### End-to-end — `npm run test:e2e` (Playwright)

One-time, install the browser:

```bash
cd web && npx playwright install chromium
```

Then:

```bash
npm run test:e2e
```

Playwright boots its **own** dev server on port **3100** (so it never collides with your
`npm run dev` on :3000) with the test-auth flags set. Auth is a **seeded session** — a
signed test JWT cookie, never a real Auth0 login — so no Auth0 secrets are needed. See
[`playwright.config.ts`](playwright.config.ts) and [`lib/test-auth.ts`](lib/test-auth.ts).
The `E2E_AUTH` test-auth path is inert unless that flag is set, and the flag is only ever
set by Playwright.

---

## Database & migrations

**Migrations are golang-migrate SQL, not `prisma migrate`.** CI and production both apply
migrations with golang-migrate, so Prisma's schema is **introspected** from the database,
never the other way around.

To add a schema change:

1. Write the pair under `backend/migrations/` — 6-digit zero-padded, e.g. the next one
   after `000033` is `000034_add_thing.up.sql` and `000034_add_thing.down.sql`.
2. Apply it locally:
   ```bash
   DATABASE_URL="postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable" make migrate
   ```
3. Sync Prisma to the new shape:
   ```bash
   cd web && npm run prisma:pull   # introspects the DB → prisma/schema.prisma
   ```

> **Do not run `prisma migrate`.** It is wrong for this repo until the post-cutover step
> that flips migrations over to `prisma migrate deploy`. Until then, golang-migrate is the
> single source of truth for schema.

---

## Conventions

### Next.js 16 — read the docs first

This is **Next.js 16**, which has breaking changes from earlier versions you may know
(route handlers are async `(req, ctx)` where `ctx.params` is a `Promise`, etc.). Before
writing route or rendering code, read the relevant guide in
`node_modules/next/dist/docs/`. This is mandated by [`web/AGENTS.md`](AGENTS.md) — don't
write Next.js code from memory.

### External-client test seam — `setXForTesting()`

Every wrapper around an external API exposes a setter that injects a fake, so tests never
hit the real service (CI has no secrets). Follow this pattern for any new external client:

- [`lib/stripe.ts`](lib/stripe.ts) → `setStripeForTesting(stub)`
- [`lib/arive.ts`](lib/arive.ts) → `setAriveForTesting(stub)`

The module holds a private `stub`; the real client is only constructed when no stub is set.
Tests inject a fake in `beforeEach` and reset it after.

---

## Deploy & cutover

Deployment is to **Vercel**. The legacy → `web/` cutover sequence (promote preview to
production, flip DNS, drain ECS, delete `backend/`/`frontend/`, switch migrations to
`prisma migrate deploy`) is owned by the repo-root [`CLAUDE.md`](../CLAUDE.md) — follow it
there rather than duplicating it here.
