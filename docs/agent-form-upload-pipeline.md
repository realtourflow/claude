# Agent self-serve form upload + AI field-mapping pipeline (v2)

> **Status: PROPOSAL — review the approach before any feature code is written.**
> This PR contains only the written plan + the data model (migration `000038` +
> the synced Prisma schema). No routes, no AI code, no UI. Nothing here is wired
> to a live deal. Do not merge to ship — merge (or not) to bless the approach.

---

## 1. What we're building (plain English)

Today, every sendable form is hand-built: a developer tags the fields on a
DocuSign template, writes a registry entry in `web/lib/contract-forms.ts`, and we
drop the template id into an env var. That's the **v1 registry**. It works, and
it stays exactly as it is — this feature does not touch it.

The new pipeline lets an **agent** add a form themselves:

1. The agent uploads a blank PDF (buyer-side or seller-side) in their account.
2. They check a box attesting they're licensed/permitted to use and host it. We
   store **who, when, and which file** (down to a content hash).
3. The AI reads the form, finds the fillable fields, and proposes a mapping from
   each field to our existing core field keys (`buyer_name`, `purchase_price`,
   `closing_date`, …). Anything it isn't confident about is flagged
   **"needs human review"** — it never guesses.
4. The proposed form lands in **`pending_review`**. It is **not usable on any
   live deal**.
5. **You (admin)** open a review screen, see every detected field next to the
   AI's proposed key, fix anything wrong, and approve.
6. On approval we create the real DocuSign template and flip the form to
   **`ready`**. It becomes available to **that agent only** (until you promote
   it to everyone).

From that point on, sending it on a deal is **the exact same experience we have
now**: known facts auto-fill, the agent fills the gaps, and it sends in-app or
via DocuSign email. This feature only changes **how a new form gets created** —
not how forms are used.

### Guardrails (non-negotiable)

- **Purely additive.** New tables, new modules, new screens. The v1 registry,
  the env template config, and the two wired forms (BAA, Wire Fraud Notice) are
  untouched and keep working as the fallback + the reference for correct output.
- **Reuse, don't rebuild.** We reuse the existing DocuSign send/sign wiring and
  the existing core field-key registry. We do not invent a parallel set of keys
  or a second send path.
- **The review gate is real.** A form is unusable on a live deal until an admin
  approves it AND a DocuSign template id exists for it.

---

## 2. The core insight: this is ~90% reuse

The whole send/sign pipeline already funnels through one resolved shape. In
`web/lib/docusign-templates.ts`, `getTemplateConfig(formKey)` returns:

```ts
{ templateId, label, roleMapping, purpose, board, routing, consumerRoles, fieldMap }
```

Everything downstream — recipient routing (`docusign-routing.ts`), prefill
(`buildPrefillTabs` in `docusign-prefill.ts`), envelope send
(`sendTemplateEnvelope` in `docusign-documents.ts`), embedded in-app signing, the
webhook, and signed-PDF archival — consumes **only that shape**. It does not care
where the shape came from.

So the plan is: **make an approved uploaded form resolve to that same shape.**
Once it does, the entire existing send/sign machine works on it with zero
changes. The new feature is really just three things bolted onto the front:

1. **Get a blank PDF in** (upload + attestation).
2. **Produce the resolved shape** (extract fields → AI maps to core keys → human
   approves → create DocuSign template → store templateId + fieldMap).
3. **Let that shape be found** (an agent-scoped resolver the existing routes also
   consult).

---

## 3. End-to-end flow

```
AGENT                          PIPELINE                         ADMIN (you)
─────                          ────────                         ───────────
upload blank PDF  ─────────▶   store file in S3
check attestation ─────────▶   record who/when/hash
                               │
                               ▼
                          EXTRACT (deterministic, pdf-lib)
                          read AcroForm fields:
                          name, type, page, position
                               │
                               ▼
                          MAP (AI, swappable provider)
                          each field → core key + confidence
                          low confidence → needs_review
                               │
                               ▼
                          status = pending_review  ──────────▶  review screen:
                                                                detected field
                                                                + AI proposal
                                                                + confidence
                                                  ◀──────────   correct / accept
                                                                approve  ──────┐
                               ┌───────────────────────────────────────────────┘
                               ▼
                          CREATE DocuSign template from the PDF
                          (tabs placed by position, labeled with
                          the approved core keys, assigned to roles)
                          store templateId + assembled field_map
                          status = ready
                               │
                               ▼
   ◀── form now appears   RESOLVE (agent-scoped)
       in this agent's    ready forms for this agent (own + promoted)
       form picker
       │
       ▼
   send on a deal ───────▶  *** EXISTING PIPELINE, UNCHANGED ***
                            routing → prefill → envelope → sign → webhook → archive
```

The dashed box is the only genuinely new logic. Everything below "send on a deal"
is code we already have.

---

## 4. Data model (this PR)

Two new tables — see `migrations/000038_add_uploaded_forms.up.sql`. Applied and
round-tripped locally (up → down → up) against Postgres 16; Prisma schema synced.

### `uploaded_forms` — one row per uploaded form + its lifecycle

The important columns and why they exist:

| Column | Purpose |
|---|---|
| `agent_id` | Owner. The only agent who can use it unless promoted. |
| `label`, `side` | Display name + `buy`/`sell`/`both` (drives the picker). |
| `status` | `pending_review` → `ready` / `rejected` / `archived`. **The gate.** |
| `source_s3_key`, `source_file_name`, `mime_type`, `file_size` | The blank PDF. Never mutated. |
| `file_sha256` | Hash of the exact bytes the agent attested to (audit). |
| `attested_by`, `attested_at`, `attestation_statement` | **Who, when, exact wording.** "Which file" = this row. |
| `docusign_template_id` | NULL until approved; set when the DocuSign template is created. |
| `role_mapping`, `routing`, `consumer_roles`, `field_map`, `purpose` | The **resolved shape** — identical to a `ContractForm`. This is what makes reuse work. |
| `promoted` | false = owner only; true = admin promoted to all agents. |
| `reviewed_by`, `reviewed_at`, `review_notes` | Review audit / rejection reason. |

### `uploaded_form_fields` — one row per detected field (the review surface)

Holds the deterministic extraction, the AI proposal, and the human decision side
by side, so the review screen is a straight read of this table:

| Group | Columns |
|---|---|
| Extraction (pdf-lib) | `detected_name`, `detected_type`, `page_number`, `pos_x/pos_y/width/height`, `nearby_text` |
| AI proposal | `ai_core_key`, `ai_role`, `ai_confidence`, `ai_rationale`, `needs_review` |
| Human decision | `final_core_key`, `final_role`, `final_type`, `decision` (`pending`/`accepted`/`corrected`/`skipped`) |

On approval, the `final_*` values are assembled into the parent's `field_map`
**and** into the DocuSign template's tabs.

Both tables `ON DELETE CASCADE` from their parents. Status/side/routing/decision
are guarded by CHECK constraints (same style as `fee_status` / `docusign_status`).

---

## 5. The AI piece — split detection from mapping

The single most important design choice. We **do not** ask the AI to find fields
by looking at pixels. We split the job:

**A. Extraction — deterministic, no AI (`pdf-lib`, already a dependency).**
A real fillable PDF has an AcroForm: named fields with a type (text, checkbox,
signature, etc.) and a position. `pdf-lib` reads these directly. So "what fields
exist and where" is computed exactly, for free, every time. This is reliable in a
way an LLM scanning an image never will be.

**B. Mapping — AI, behind a swappable interface.**
The AI's job is the *semantic* step it's actually good at: given a field named
`"buyer_printed_name"` near the text "Buyer", which of our core keys is it?
Text in, structured JSON out. This is where the user's "the AI reads the form"
intuition lives, and it's a task LLMs do well and predictably.

```ts
// web/lib/form-ai/types.ts  (proposed — not in this PR)
export type DetectedField = {
  name: string;
  type: "text" | "checkbox" | "signature" | "initial" | "date";
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  nearbyText?: string;
};

export type CoreKeyProposal = {
  coreKey: string | null;   // a canonical key, or null = "I don't know"
  role: string | null;
  confidence: number;       // 0..1; below threshold ⇒ needs_review
  rationale: string;        // short why, shown to the reviewer
};

export interface FieldMapper {
  proposeMappings(input: {
    fields: DetectedField[];
    side: "buy" | "sell" | "both";
    coreKeys: CoreKeyDescriptor[];   // built FROM the existing registry
  }): Promise<CoreKeyProposal[]>;    // aligned to fields by index
}
```

- **Swappable provider:** one interface, plus `setFieldMapperForTesting()` —
  the exact seam already used for Stripe/DocuSign/etc. Default implementation:
  **Anthropic Claude** (we're an Anthropic shop; structured output via tool use).
  Swapping providers later = one new class, no caller changes.
- **Tests never hit a real model:** a deterministic fake `FieldMapper` is
  injected in CI, same as the DocuSign fake. CI has no AI key and won't need one.
- **The AI only ever maps to OUR keys.** `coreKeys` is built directly from the
  existing `FACT_FIELDS` + `AUTO_VALUE_KEYS` in `web/lib/contract-facts.ts`. The
  AI cannot invent a key — its output is validated against that set, and anything
  off-list or low-confidence becomes `needs_review`. This is how we honor "reuse
  the same core key registry, do not invent a parallel set."

### The canonical core keys the AI maps to (existing — unchanged)

From `web/lib/contract-facts.ts`:

- **Facts (17):** `legal_description`, `parcel_or_ppin`, `city`, `state`, `zip`,
  `purchase_price`, `earnest_money_amount`, `earnest_money_holder`,
  `financing_type`, `loan_amount_or_pct`, `offer_date`, `acceptance_binding_date`,
  `closing_date`, `possession`, `buyer_broker_comp`, `agency_role`,
  `included_fixtures`, `additional_provisions`.
- **Auto-sourced (5):** `buyer_name`, `agent_name`, `brokerage_name`,
  `consumer_name`, `consumer_name_2`.

Signature / initial / date-signed fields are handled by the DocuSign template
roles (as today), not prefilled from a fact key.

---

## 6. Reuse map — what we touch vs. what we reuse untouched

### Reused with ZERO changes

- `docusign-routing.ts` — `assignTemplateRoles` / `assignConsumerRoles`
- `docusign-prefill.ts` — `buildPrefillTabs` (prefills by tab label = core key)
- `docusign-documents.ts` — `sendTemplateEnvelope`, recipient rows
- `contract-facts.ts` — `getMergedContractValues` (deal facts → core key values)
- Embedded signing, the DocuSign webhook, signed-PDF archival
- The whole `SendTemplateModal` send experience

### Two small ADDITIVE touches (new code paths, existing behavior unchanged)

1. **`DocusignClient` gains an optional method** to create a template from a PDF
   (`createTemplateFromDocument?(...)`). It's **optional on the interface**, so
   every existing test fake still satisfies the type — nothing breaks. The real
   client implements it via the DocuSign Templates API (we already speak that API
   with raw `fetch`). This is the one new DocuSign capability; today the client
   can only *send from* templates, not *create* them.

2. **A new agent-scoped resolver** (`web/lib/agent-forms.ts`) returns the same
   `TemplateConfig` / `TemplateListing` shapes from `uploaded_forms` (status
   `ready`, owned-or-promoted). Two existing routes consult it **as a fallback**:
   - `GET /api/docusign/templates` — appends the caller's ready uploaded forms to
     the picker list. Committed/env forms are listed exactly as before.
   - `POST /api/deals/:id/docusign/send-template` — tries `getTemplateConfig`
     first; on `UnknownFormError`, falls back to the agent-form resolver.

   Uploaded-form keys are the row's UUID, so they can never collide with a
   committed key like `buyer_agency_agreement`. The committed-form code path is
   byte-for-byte unchanged.

---

## 7. New endpoints (built in later PRs, not this one)

**Agent (self-serve):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/me/forms/upload-url` | Presigned S3 PUT (namespace `agent-forms/{agentId}/…`) |
| POST | `/api/me/forms` | Confirm upload; **requires attestation**; kicks off extract+map; row → `pending_review` |
| GET | `/api/me/forms` | List the agent's uploaded forms + statuses |
| GET | `/api/me/forms/:id` | Detail (read-only while pending) |

**Admin (the review gate):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/forms?status=pending_review` | Review queue |
| GET | `/api/admin/forms/:id` | Form + detected fields + AI proposals + PDF preview URL |
| PATCH | `/api/admin/forms/:id/fields/:fieldId` | Correct a field's key/role/type/decision |
| POST | `/api/admin/forms/:id/approve` | Validate, create DocuSign template, → `ready` |
| POST | `/api/admin/forms/:id/reject` | → `rejected` + notes |
| POST | `/api/admin/forms/:id/promote` | → `promoted = true` (all agents) |

All admin routes enforce `hasRole(["admin"])`; all agent routes scope to
`agent_id = caller`. Same patterns as `/api/admin/agent-invites` and
`/api/me/doc-templates`.

---

## 8. The admin review screen (the gate)

A new section in the existing admin area (mirrors the agent-invites pattern in
`AdminDashboard.tsx`). For one pending form it shows:

- The blank PDF (presigned preview) on one side.
- A table of detected fields on the other: detected name, type, page, the **AI's
  proposed core key + confidence + one-line rationale**, and an editable
  dropdown (core key + role) plus an accept/skip toggle.
- Fields flagged `needs_review` are sorted to the top and visually marked.
- **Approve** is disabled until every `needs_review` field is resolved.
- **Approve** → creates the DocuSign template + flips to `ready`.
  **Reject** → `rejected` with a reason.

---

## 9. Agent upload UX

A new **"My Forms"** area in Settings, beside the existing **Documents** tab
(`SettingsPage.tsx`). Kept separate from the existing `agent_doc_templates`
(dumb file store) because these go through the AI pipeline + review gate and
become *sendable* forms. The upload form:

- File picker (PDF only for v2), label, side (buy/sell/both).
- **A required checkbox:** *"I attest that I am licensed and permitted to use and
  host this form."* — its exact wording is snapshotted into
  `attestation_statement`; submit is blocked until it's checked; the API rejects
  any submit without it.
- After upload: a status chip (Pending review → Ready / Rejected) and, when
  ready, the form simply appears in the deal send picker.

---

## 10. Scope for v2 — decisions for you to confirm

1. **Fillable (AcroForm) PDFs first.** v2 nails the reliable path: PDFs that
   already have form fields (most e-sign-ready board forms). For a flat/scanned
   PDF with no form fields, we'd need vision/OCR to *find* fields — that's a
   harder, less reliable mode. I recommend shipping AcroForm-first and leaving
   vision detection as a clean future swap **behind the same extractor
   interface**. If a flat PDF is uploaded, we detect that and tell the agent
   "this form isn't fillable yet — needs manual setup" rather than guess badly.
   *(Your call: AcroForm-first, or hold for vision too?)*

2. **Per-form custom terms.** v2 maps detected fields to the **existing** core
   keys only. Brand-new per-form term fields (like the BAA's bespoke
   `baa_comp_percent`) are out of scope for the auto-mapper in v2 — unmapped
   fields become blank tabs the signer fills. Expanding the key set is a separate
   decision so we don't quietly fork the registry.

3. **Promote-to-all.** The column + endpoint exist; the default is owner-only.
   Confirm you want admin-only promotion (yes, per your spec).

4. **Inline vs queued pipeline.** Extract + one AI call is fast enough to run
   inline on upload for v2. We already have a durable pg-boss queue if we later
   want it backgrounded for big/slow files. Recommend inline now.

---

## 11. Security & safety

- **Server-side scoping is the boundary.** Agent routes filter by `agent_id`;
  admin routes require the `admin` role. An agent can only ever send their own
  (or promoted) ready forms — the send route already enforces deal ownership too.
- **Nothing is live until two gates pass:** `status = ready` **and** a
  `docusign_template_id` exists. A pending/rejected form is invisible to the
  picker and rejected by the send route.
- **Attestation is captured and immutable:** user id, timestamp, the exact
  statement text, and the file hash. Stored at upload, shown in the admin review.
- **Untrusted PDF handling:** parsing happens server-side with `pdf-lib`; we
  store the original in S3 and never execute anything from it.
- **Production migration note:** per `CLAUDE.md`, new migrations don't auto-apply
  to prod RDS yet — `000038` is applied manually at ship time (it's additive,
  so it's safe to apply ahead of the feature code).

---

## 12. Testing strategy (house style: Vitest + injected fakes)

- **Unit:** `extract.ts` against a fixture PDF with known AcroForm fields;
  `agent-forms.ts` resolver returns a shape identical to `getTemplateConfig`;
  the AI output validator rejects off-registry keys.
- **Integration (route tests, like `baa-form.test.ts`):**
  - upload without attestation → 400.
  - upload → pipeline (fake `FieldMapper`) → `pending_review` with field rows +
    `needs_review` flags.
  - admin correct + approve (fake DocuSign `createTemplateFromDocument`) →
    `ready` with `docusign_template_id` + assembled `field_map`.
  - send via an uploaded-form key reuses the existing prefill/routing path.
  - non-admin approve → 403; agent A cannot see agent B's form.
- **No network in CI:** AI and DocuSign are both injected fakes.

---

## 13. Build sequence (after you bless this approach)

Each step is its own small PR, gated behind the prior:

1. **Data model** *(this PR)* — migration + schema. ✅
2. **Extractor + AI interface** — `form-ai/` (extract, types, Anthropic impl,
   fake) + unit tests. No routes yet.
3. **Agent upload + attestation** — upload-url, confirm route, pipeline call,
   `/api/me/forms` list/detail + the Settings "My Forms" UI.
4. **Admin review gate** — admin routes + the review screen + approve/reject.
5. **DocuSign template creation + resolver** — `createTemplateFromDocument`,
   `agent-forms.ts`, and the two additive route fallbacks. This is the step that
   makes an approved form sendable.
6. **Promote-to-all** — small follow-up.

After step 5, an uploaded → approved form sends through the *existing* pipeline
with no further changes.

---

## 14. Open questions for you

1. **AcroForm-first** for v2 (§10.1) — ship it, or wait for flat-PDF/vision too?
2. **Default AI provider = Anthropic Claude** — agreed? (Swappable regardless.)
3. **Review queue placement** — a new section inside the existing Admin dashboard,
   or a dedicated `/admin/forms` page? (Recommend a section, like agent-invites.)
4. **Attestation wording** — is *"I attest that I am licensed and permitted to use
   and host this form."* the exact text you want stored, or do you have legal
   wording to drop in?
