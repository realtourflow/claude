# RealTourFlow — CLAUDE.md

> This file is the authoritative orientation guide for every Claude session.
> Read this before writing any code. Keep it updated whenever architecture, migrations, or
> real/mock boundaries change.

---

## What This Is

RealTourFlow is a stage-based real estate deal operating system built for real estate agents.
It tracks buyer and seller deals through 7 stages (intake → post_close), manages tasks per deal,
coordinates with a transaction coordinator (TC), surfaces client portals for buyers/sellers,
and integrates with ARIVE (loan milestone sync) for Mountain Mortgage / Fast Pass buyers only.

**Owner:** Paul Leara (paul@mountain.mortgage, Mountain Mortgage)
**Target launch:** Real agents on it before end of June 2026
**Build philosophy:** Production-grade, not prototype. Build it right.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, Zustand state, React Router |
| Backend | Go 1.23, chi router, database/sql + pgx driver |
| Database | PostgreSQL 16.13 (AWS RDS) |
| Auth | Auth0 (SPA + API, JWT RS256, JWKS validation) |
| Hosting | AWS ECS Fargate (backend), frontend not yet deployed to production |
| Container registry | AWS ECR |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions — push to `main` → build → ECR → ECS deploy |
| Local DB | Docker Compose (postgres:16-alpine) |

---

## Infrastructure (Production)

| Resource | Value |
|---|---|
| AWS Account | 508859666048 |
| Region | us-east-1 |
| ECS Cluster | realtourflow |
| ECS Service | realtourflow-api |
| ECR Repo | 508859666048.dkr.ecr.us-east-1.amazonaws.com/realtourflow-api |
| Task Execution Role | arn:aws:iam::508859666048:role/realtourflow-task-execution-role |
| CloudWatch Log Group | /ecs/realtourflow-api |
| Auth0 Tenant | dev-30md8ukv8qd3u27c.us.auth0.com |
| Auth0 Audience | https://api.realtourflow.com |
| Auth0 Client ID | JMIZVqGbZ6KRmJGHyowg5kopHRmHGVhe |

**Secrets Manager ARNs** (used verbatim in task-definition.json):
- DATABASE_URL: `arn:aws:secretsmanager:us-east-1:508859666048:secret:realtourflow/database-url-DvT938`
- AUTH0_DOMAIN: `arn:aws:secretsmanager:us-east-1:508859666048:secret:realtourflow/auth0-domain-hHsuRD`
- AUTH0_AUDIENCE: `arn:aws:secretsmanager:us-east-1:508859666048:secret:realtourflow/auth0-audience-vsItjS`

**Known issue:** `ALLOWED_ORIGINS` in `backend/task-definition.json` is currently set to
`http://localhost:5173`. This must be updated to the real production frontend URL before
the live frontend can call the API. No production frontend deployment exists yet.

---

## Local Development

### Prerequisites
- Go 1.23+
- Node 20+
- Docker Desktop (for local Postgres)
- `golang-migrate` CLI: `brew install golang-migrate`

### Run everything

```bash
# 1. Start local Postgres
make db

# 2. Apply migrations to local DB
DATABASE_URL="postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable" make migrate

# 3. Start backend + frontend in parallel
make dev
```

### Environment files

**Backend** — copy `.env.example` to `.env` and fill in:
```
PORT=8080
DATABASE_URL=postgres://postgres:postgres@localhost:5432/realtourflow?sslmode=disable
ALLOWED_ORIGINS=http://localhost:5173
AUTH0_DOMAIN=dev-30md8ukv8qd3u27c.us.auth0.com
AUTH0_AUDIENCE=https://api.realtourflow.com
```

**Frontend** — copy `frontend/.env.example` to `frontend/.env.local` and fill in:
```
VITE_API_URL=http://localhost:8080/api
VITE_AUTH0_DOMAIN=dev-30md8ukv8qd3u27c.us.auth0.com
VITE_AUTH0_CLIENT_ID=JMIZVqGbZ6KRmJGHyowg5kopHRmHGVhe
VITE_AUTH0_AUDIENCE=https://api.realtourflow.com
```

---

## Database Migrations

### Protocol — follow this every time

1. Write migration files: `backend/migrations/{version}_{title}.up.sql` + `.down.sql`
   - Naming: `000001_init`, `000002_add_task_fields`, `000003_...`  (6-digit zero-padded)
2. Test locally: `DATABASE_URL="..." make migrate`
3. Push code — **migrations run automatically on ECS startup** (golang-migrate in main.go)
4. Verify: hit the relevant endpoint, check CloudWatch logs if anything errors.

> **No manual CLI access needed.** The server calls `migrate.Up()` before accepting requests.
> ErrNoChange is handled gracefully — already-applied migrations are skipped automatically.

### Migration state

| Migration | Description | Local | **Production** |
|---|---|---|---|
| 000001_init | Full schema: users, deals, tasks, documents, messages, deal_stage_history | ✅ Applied | ✅ Applied |
| 000002_add_task_fields | Adds priority, source, stage_context, role columns to tasks | ✅ Applied | ✅ Applied |
| 000003_add_message_channel | Adds channel column (client_thread / internal) to messages | ✅ Applied | ✅ Applied |
| 000004_add_document_fields | Adds mime_type, file_size columns to documents | ✅ Applied | ✅ Applied |
| 000005_add_vendors | Creates preferred_vendors table with sort_order and is_featured | ✅ Applied | ✅ Applied on next deploy |

---

## API Endpoints

All routes are mounted at `/api`. Protected routes require `Authorization: Bearer <Auth0 JWT>`.

| Method | Path | Auth | Handler | Notes |
|---|---|---|---|---|
| GET | /health | — | Health | Returns `{"status":"ok"}` |
| POST | /users/sync | ✅ | SyncUser | Upserts user from JWT; requires role in Auth0 custom claim |
| GET | /deals | ✅ | ListDeals | Returns agent's deals ordered by updated_at desc |
| POST | /deals | ✅ | CreateDeal | Creates deal at intake stage |
| GET | /deals/:dealId | ✅ | GetDeal | Ownership-checked |
| PATCH | /deals/:dealId/stage | ✅ | AdvanceStage | Writes deal_stage_history row |
| GET | /deals/:dealId/tasks | ✅ | ListTasks | Ownership-checked via deal |
| POST | /deals/:dealId/tasks | ✅ | CreateTask | Creates task; auto-tasks posted here on stage advance |
| PATCH | /tasks/:taskId/status | ✅ | UpdateTaskStatus | Ownership-checked via deal join |
| GET | /deals/:dealId/messages | ✅ | ListMessages | `?channel=client_thread\|internal`; JOIN users for sender name/role |
| POST | /deals/:dealId/messages | ✅ | CreateMessage | CTE insert+join; returns full message with sender info |
| GET | /deals/:dealId/documents | ✅ | ListDocuments | Ownership-checked via deal; returns docs with uploader name |
| POST | /deals/:dealId/documents/upload-url | ✅ | GetUploadURL | Returns S3 pre-signed PUT URL (15 min) + s3_key |
| POST | /deals/:dealId/documents | ✅ | CreateDocument | Confirms upload; stores name, s3_key, mime_type, file_size |
| GET | /documents/:documentId/download-url | ✅ | GetDownloadURL | Returns S3 pre-signed GET URL (15 min) |
| DELETE | /documents/:documentId | ✅ | DeleteDocument | Deletes DB record + best-effort S3 object delete |
| GET | /vendors | ✅ | ListVendors | Agent-scoped; ordered by category, sort_order |
| POST | /vendors | ✅ | CreateVendor | Auto-sets sort_order = max in category + 1 |
| PATCH | /vendors/:vendorId | ✅ | UpdateVendor | Partial update — company, contact, phone, email, website, notes, is_featured, sort_order |
| DELETE | /vendors/:vendorId | ✅ | DeleteVendor | Ownership-checked |

### Auth0 JWT custom claims

The Post-Login Action in Auth0 injects roles into the JWT under:
```
https://realtourflow.com/roles: ["agent"]  // or buyer, seller, admin, lending_partner
```
`SyncUser` reads this claim. A user with no role gets 403.

---

## Real vs Mock Inventory

This tracks what's wired to the real database vs what still uses mock data.
**Before touching any feature, check this table.**

### Wired to real API ✅

| Feature | Endpoints used |
|---|---|
| Pipeline deal list | GET /deals |
| New deal creation | POST /deals |
| Deal detail load | GET /deals/:id |
| Stage advance / retreat | PATCH /deals/:id/stage |
| Task list per deal | GET /deals/:id/tasks |
| Toggle task complete | PATCH /tasks/:id/status |
| Stage auto-tasks on advance | POST /deals/:id/tasks |
| User sync on login | POST /users/sync |
| Messages per deal | GET/POST /deals/:id/messages |
| Documents per deal | GET /deals/:id/documents, POST /deals/:id/documents/upload-url, POST /deals/:id/documents, GET /documents/:id/download-url, DELETE /documents/:id |
| Vendor directory | GET /vendors, POST /vendors, PATCH /vendors/:id, DELETE /vendors/:id |

### Still on mock data ⚠️

| Feature | Mock file | Notes |
|---|---|---|
| authStore (active user) | ~~wired to real Auth0~~ | **Closed.** `setFromAuth0()` populates authStore from `/users/sync` response. `RoleSwitcher` is dev-only. |
| Messages tab | ~~wired to real API~~ | **Closed.** `GET/POST /deals/:id/messages?channel=` live. 10s polling. Send wired. |
| Documents tab | ~~DEAL_DOCS mock~~ | **Closed.** S3 pre-signed upload/download/delete wired. `useDocuments` hook. |
| Vendor directory | ~~vendorStore.ts~~ | **Closed.** `useVendors` hook. GET/POST/PATCH/DELETE /vendors live. SettingsPage, VendorDirectory, DealDetail all wired. |
| Loan milestones | `data/mockDeals.ts` | ARIVE integration not yet built |
| Properties / offers | `store/propertyStore.ts`, `store/offerStore.ts` | Full UI, writes nowhere |
| Net sheet | `store/netSheetStore.ts` | Full UI, writes nowhere |
| Deal health (green/yellow/red) | Hardcoded in mock deals | Should be computed server-side |
| Notifications | `store/notificationStore.ts` | In-memory only |
| Buyer / Seller portals | `BuyerView.tsx`, `SellerView.tsx` | Reads mock deals |
| TC Dashboard | `TCDashboard.tsx` | Reads mock deals + tasks |
| Admin Dashboard | `AdminDashboard.tsx` | Reads mock deals |
| Onboarding flows | `store/intakeStore.ts`, `store/clientContactStore.ts` | Writes to in-memory stores only |
| Fast Pass / Smooth Exit | `mockFastPass.ts`, `mockSmoothExit.ts` | Full UI, no payment/backend |
| Checklist (TC) | `store/checklistStore.ts` | In-memory only |
| Settings (all tabs) | Various stores | Writes to in-memory stores |
| Deal stage store | `store/dealStageStore.ts` | Keeps local overrides in memory on top of API stage; server is authoritative on reload |

---

## Auth Architecture

Single unified identity system — Auth0 JWT is the source of truth end-to-end.

**Auth0 JWT (backend-facing)**
- `Auth0Provider` in `main.tsx` wraps the whole app
- `AuthSetup.tsx` calls `setTokenGetter(getAccessTokenSilently)` so all `api.*` calls attach a real Bearer token
- The backend validates every protected request via JWKS

**authStore (frontend-facing)**
- On login, `AuthSetup.tsx` calls `POST /users/sync` to upsert the user in the DB
- The sync response (DB UUID, name, email, role) is passed to `authStore.setFromAuth0()`
- `authStore.activeUser` is now the real Auth0-authenticated user — name, email, DB UUID, groupId, permissions
- `usePermission` / `PermissionGate` derive from `activeUser.groupId` (mapped from Auth0 role claim)
- `authStore.isLoaded` is `false` until the sync completes; `RootRedirect` waits on this before routing

**Role → GroupId mapping** (in `authStore.ts`):
- `agent` → `agent`, `buyer` → `buyer`, `seller` → `seller`, `admin` → `admin`, `tc` → `tc`, `lending_partner` → `agent`

**Dev RoleSwitcher**
- Still present in dev (`import.meta.env.DEV`) for testing buyer/seller/TC views
- Calls `setActiveUser(mockId)` to override identity with a mock user; navigate is handled by the switcher itself
- Invisible / no-op in production builds

---

## Key Files

| File | Purpose |
|---|---|
| `backend/cmd/api/main.go` | Entry point, wires config → DB → chi router → handlers |
| `backend/internal/config/config.go` | Reads env vars; add new config here |
| `backend/internal/middleware/auth0.go` | JWT validation + custom claims extraction |
| `backend/internal/handlers/handlers.go` | Route registration — add new routes here |
| `backend/internal/models/` | Go structs for DB types |
| `backend/migrations/` | golang-migrate SQL files |
| `backend/task-definition.json` | ECS task definition — update ALLOWED_ORIGINS before prod frontend launch |
| `frontend/src/main.tsx` | Auth0Provider + AuthSetup wrapper |
| `frontend/src/api/client.ts` | All HTTP calls — uses tokenGetter for Bearer tokens |
| `frontend/src/api/AuthSetup.tsx` | Wires Auth0 token getter + fires /users/sync on login |
| `frontend/src/hooks/useDeals.ts` | `useDeals()`, `useDeal()`, `apiDealToFrontend()`, `patchStage()` |
| `frontend/src/hooks/useTasks.ts` | `useTasks()`, `patchTaskStatus()`, `postTask()` |
| `frontend/src/store/authStore.ts` | Real identity — `AppUser` type, `setFromAuth0()`, `isLoaded` flag |
| `frontend/src/data/mockDeals.ts` | Frontend `Deal` type definition (authoritative) |
| `frontend/src/data/mockTasks.ts` | Frontend `Task` type definition (authoritative) |
| `frontend/src/pages/agent/Pipeline.tsx` | Deal list page — uses `useDeals()` |
| `frontend/src/pages/agent/DealDetail.tsx` | Deal detail + tasks — uses `useDeal()` + `useTasks()` |
| `BACKEND_TODO.md` | Full backlog of unbuilt backend features |
| `UAT.md` | Mermaid flowcharts of every user flow (based on mock state) |

---

## Deploy Protocol

Follow this checklist on every push that includes backend changes:

1. **Pre-push**
   - `cd backend && go build ./...` — must compile clean
   - `cd frontend && npx tsc --noEmit` — must have zero type errors
   - If new migrations: test locally with `make migrate` against local Docker DB

2. **Push to main**
   - GitHub Actions builds Docker image → pushes to ECR → deploys to ECS
   - Wait for CI green (≈3–5 min)

3. **Migrations run automatically** — server applies all pending migrations on startup before accepting requests. Check CloudWatch logs for `migrations up to date`.

4. **Smoke test**
   - Hit `GET /api/health` → expect `{"status":"ok"}`
   - Log in via Auth0 → expect `/users/sync` to return 200
   - Create a deal → verify it appears in Pipeline
   - Advance a stage → verify it persists on reload

5. **Update this file**
   - If real/mock boundaries changed, update the inventory table
   - If new endpoints were added, add them to the endpoints table

---

## Logical Next Steps

In rough priority order:

1. **Update ALLOWED_ORIGINS** — set real production frontend domain in task-definition.json once frontend is deployed
2. **Documents backend** — S3 upload, `POST /deals/:id/documents`, `GET /deals/:id/documents`
5. **Documents backend** — S3 upload, `POST /deals/:id/documents`, `GET /deals/:id/documents`
6. **Vendor persistence** — `GET/POST/PATCH/DELETE /vendors`, agent-scoped preferred vendor list
7. **Deal health computation** — server-side scoring: green/yellow/red based on task status + days in stage
8. **Buyer/Seller user accounts** — invite flow, onboarding writes to DB, client portal reads real data
9. **ARIVE integration** — webhook or polling for Mountain Mortgage loan milestones (only for arive_linked=true deals)

---

## Design Principles (Don't Drift From These)

- **ARIVE scope:** The ARIVE API integration is only for deals where the buyer uses Mountain Mortgage / Fast Pass. Outside lender deals are manual updates. Do not build ARIVE logic for deals where `arive_linked = false`.
- **Role enforcement:** All data scoping happens server-side. Agents only see their own deals. The frontend filter is a UX convenience only, not a security control.
- **Stage history:** Every stage transition — advance or retreat — writes a row to `deal_stage_history`. Never update stage without this.
- **No mock IDs in real API calls:** The mock user IDs (`agent-sarah`, `buyer-smith`, etc.) are frontend-only. The database uses UUIDs. Never send a mock ID to the backend.
- **Migration discipline:** Never alter a production table by hand. Every schema change goes through a numbered migration file.
