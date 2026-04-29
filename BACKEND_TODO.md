# To Complete for Backend

This document tracks frontend features that are currently mocked or non-functional and require backend implementation before production. Organized by domain so work can be scoped and assigned cleanly.

---

## Auth & Identity

- [ ] Real login/logout — currently using a dev role-switcher with no auth
- [ ] JWT or session-based authentication with protected routes
- [ ] Role-based access control enforced server-side (not just UI-gated)
- [ ] Email invite flow — `InviteModal` submits a form but sends no actual email
- [ ] Password reset + email verification for new users
- [ ] Agent creates buyer/seller accounts via invite link (onboarding flow wired to real user creation)

---

## Data Layer (Persistence)

All current data is hardcoded in mock files and resets on page refresh.

- [ ] Deals — CRUD, stage transitions, health score logic
- [ ] Tasks — create, update status, assign to role, mark complete (currently local state only)
- [ ] Stage transitions — persist advance/retreat, timestamp each change
- [ ] New Deal creation — currently adds to local component state, lost on refresh
- [ ] Users — full user model, agent ↔ client relationships
- [ ] Vendors — preferred vendor list per agent, deal-level vendor assignments
- [ ] Notes on deals — currently displayed from mock, not editable
- [ ] Admin user deactivation — UI exists, no API call
- [ ] Offer comparison — offers currently hardcoded; need offer submission + storage model

---

## Documents & Files

- [ ] File storage (S3 or equivalent) for uploaded documents
- [ ] Document upload — modal UI is built, no actual upload handler
- [ ] Document status management — signed / pending_review / missing should be server-driven
- [ ] E-signature integration (DocuSign or similar) — currently just status badges, no signing flow
- [ ] Disclosure packet generation and delivery

---

## Real-Time & Messaging

- [ ] In-app messaging — currently static mock messages; needs WebSocket or polling
- [ ] Agent ↔ client message threads per deal
- [ ] Notification persistence — mark as read, notification history; currently local state only
- [ ] Client push notifications — "new message," "doc ready to sign," "task assigned"
  - Client portal has no bell; best delivered as push or in-tab badge when backend is ready
- [ ] Agent/admin notification feed — currently 4 hardcoded mock items

---

## Integrations

- [ ] **ARIVE** — loan milestone sync; currently mocked with a "Synced via ARIVE" badge; needs real API polling or webhook
- [ ] **MLS / Property data** — MetroMap and property details are static; needs MLS feed
- [ ] **Calendar** — agent and TC calendar pages are "Coming Soon"; needs Google Calendar or iCal integration
- [ ] **Payment processing** — Fast Pass ($2,977 base + upsells) and Smooth Exit (1% fee) have enrollment UI but no payment flow
- [ ] Bridge financing coordination for Fast Pass "Buy Before You Sell" feature

---

## Business Logic (Server-Side)

- [ ] Deal health scoring — green/yellow/red currently set manually on mock data; should be computed from task status, days in stage, milestone completion
- [ ] Stage gate enforcement — soft warnings exist in UI; hard rules (if any) belong server-side
- [ ] Commission calculation — currently a static field; should derive from deal price + role splits
- [ ] Stuck deal detection — AdminDashboard "Stuck Deals" view uses hardcoded threshold; needs configurable rule engine
- [ ] Fast Pass upsell purchase tracking — which upsells were selected and paid for per enrollment

---

## Admin & Ops

- [ ] System Config page — currently "Coming Soon"; needs configurable fields (stage thresholds, fee rates, etc.)
- [ ] Promotions page — currently "Coming Soon"; needs promo code / discount management
- [ ] Audit log — who changed what, when (stage transitions, user deactivation, doc uploads)
- [ ] Reporting — pipeline value, commissions, close rate; currently computed from mock data at render time

---

## Notes

- TC dashboard deal cards link to the same `DealDetail` component as agents — backend should use role-scoped data access so TCs only see their assigned deals
- Onboarding flows (BuyerOnboarding, SellerOnboarding, FastPassSurvey, SmoothExitSurvey) collect data but currently write nowhere
- `PermissionsDebug` page at `/debug/permissions` should be removed or auth-gated before production
