# RealTourFlow — Agent Form Upload & Sharing Pipeline
## v2 Design Note

*June 2026 · Confidential · Architecture spec, not a build order*

This note captures the full design for letting agents bring their own forms into RTF — uploading them, having AI map the fields, reviewing and approving them, and (once cleared) sharing them with other agents in the same market. It folds together every decision made so far. It is a specification to build against, not an instruction to start coding. The build sequence and the open gate are spelled out at the end.

> **Note:** Decisions already locked are marked **LOCKED**. Decisions still open are marked **OPEN** and must be answered before that piece is built.

---

## 1. The Vision in One Paragraph

An agent joins RTF. Instead of a blank "upload your forms" box, RTF shows them the forms it already has that fit their market and brokerage — contributed by RTF or by other agents and cleared for sharing — and the agent simply confirms "yes, those are mine." For anything RTF doesn't already have, the agent uploads their own blank form, the system reads it, an AI proposes what each field means, and it lands in a review queue. Once approved, that form becomes a real, sendable DocuSign template. From that point on, sending it on a deal is the experience RTF already has today: known facts auto-fill, the agent fills the gaps, and it goes out for signing — in-app or by email. Every agent who joins makes onboarding faster for the next one. The library compounds.

### Why this matters

The hardest part of onboarding a new market or brokerage is form setup. Today that is manual work for Paul. This pipeline turns it into a self-service flow with a safety gate, and — through sharing — turns each agent's contribution into a head start for the next. That compounding library is a genuine competitive moat, not just a convenience.

---

## 2. The Core Architectural Bet

Every form in RTF — however it was created — resolves to one object the send/sign engine consumes. Hand-built forms produce it from code. Uploaded forms produce the same object from a database row. Because the shape is identical, the entire downstream machine (auto-fill, in-app signing, email signing, the completion webhook, signed-PDF archival) runs unchanged on uploaded forms.

> ✅ **This is the ~90% reuse.** The only genuinely new work is the front of the funnel: upload, detect fields, map them, review, approve, share.

### The two halves of field handling — keep them separate

This distinction is the most important technical idea in the whole design. Conflating them is how the pipeline silently breaks.

| | What it means | How reliable |
|---|---|---|
| **Knowing what a field MEANS** | "This box is the buyer's name." Maps to RTF's ~21 core keys. | Easy and reliable. Forms share ~80% of the same skeleton across markets. |
| **Knowing WHERE a field sits** | The exact position on the page to place a signature or text tab. | Easy on fillable PDFs (the file says so). HARD on flat/scanned PDFs (must be found by AI vision). |

Get the meaning right but the position wrong on a flat PDF, and a signature lands on top of printed text on a legally binding contract. The design below is built to make the position problem as small and as supervised as possible.

---

## 3. The Flat-PDF Reality

> **LOCKED** — Paul's working assumption: most agents will upload FLAT PDFs, not fillable ones.

Agents get their blank forms from association member libraries, broker emails, or saved files from past deals. The overwhelming majority of these are flat — printed-then-scanned or plain exports with no interactive fields. A pipeline that only accepts fillable (AcroForm) PDFs would reject most of what real agents actually bring, with an error a non-technical agent can't act on. That is the feature not working for the people it's for.

> ⚠️ The original "fillable PDFs first" decision was a technical-reliability choice that smuggled in an untested product assumption. Paul has overridden it: flat-PDF support is core to making this usable, not a later swap.

### How flat PDFs get handled — three layers, hardest used least

The goal is to lean on AI vision as rarely as possible, because position-detection on flat PDFs is the least reliable part of the system.

1. **Layer 1 — Recognition library:** If the form is one RTF already knows (a "known form"), recognize it and apply the field map already verified for it. Exact placement, zero AI guessing. This is the common case and it is reliable.
2. **Layer 2 — AcroForm extraction:** If the form is fillable, read its fields and positions directly with pdf-lib. Exact, no guessing.
3. **Layer 3 — AI vision:** For a flat PDF RTF has never seen, AI vision takes a best pass at both meaning and position, and everything it's unsure about is flagged for human review. Never a silent guess.

> ℹ️ The recognition library is seeded from the real forms Paul has already verified — wire fraud notice, brokerage services disclosure, inspection addendum, lead-based paint, the ValleyMLS contracts. Those aren't just test cases; they're the seed that makes the common case reliable and shrinks the AI's hard job to genuinely new forms.

---

## 4. The Recognition Library

Because real estate forms are ~80% the same skeleton, RTF should not solve every flat PDF blind, every time. It should remember the forms it has already figured out.

### How it works

- Each verified form has a stored fingerprint (text-layout signature and/or visual hash) plus its validated field map and tab positions.
- On upload, RTF first asks: do I recognize this? If the fingerprint matches a known form, apply the stored mapping directly — no AI, exact placement.
- If there's no match, fall through to the AI-vision path, and the result — once a human approves it — becomes a NEW entry in the library, so the next agent who uploads the same form gets the instant path.

> ✅ This is the compounding effect made concrete: the library starts with Paul's verified forms and grows every time an admin approves a new one. Over time, fewer and fewer uploads need the unreliable vision path.

> **OPEN** — fingerprinting method: How forms are recognized (text-layout signature vs. visual hash vs. both) is an implementation choice for Code to propose. Decide when this layer is built.

---

## 5. The Sharing Model — Private Lane, Public Shelf

This is where one agent's form can help another — and where the licensing risk lives. The design separates a private lane from a public shelf, with Paul as the gate between them.

### The private lane (built — steps 2–5)

An agent uploads a form. It is theirs alone, scoped by ownership, usable only on their own deals. Nobody else sees it. No licensing problem, because the uploader attested they are licensed and the form never leaves them.

### The public shelf (the new work)

Paul reviews a privately-uploaded form, confirms it is clean and cleared, and promotes it into a market-scoped shared library. Only then can it be suggested to other agents in that market — and each receiving agent still gives their own attestation and the form still passes review.

| Decision | Choice | Status |
|---|---|---|
| How wide suggestions reach | Anything in the agent's market | LOCKED (Paul) — see risk note |
| Can an agent's upload be auto-shared? | No — stays private until Paul promotes it | LOCKED (Paul) |
| What the gate is | Paul's promote-to-shared review | LOCKED |
| Receiving agent attestation | Required again per agent | LOCKED |

### How the two answers reconcile

Paul chose the broadest reach (market-wide) AND the gated source (admin-promoted only). These aren't contradictory — they're sequential. The gate comes before the breadth: an agent uploads (private), Paul clears it (gate), then it's offered market-wide (broad). The breadth happens on the output side; the control happens on the input side.

---

## 6. The Licensing Guardrail

> ⛔ This is the highest-risk part of the entire pipeline. Read it before building any sharing feature.

When RTF shows Agent B a form that Agent A uploaded, RTF is redistributing one party's document to another. That is a much bigger legal step than hosting a form for the person who uploaded it. Several of these forms carry explicit restrictions — e.g. "THE USE OF THIS FORM BY ANYONE OTHER THAN A VALLEYMLS MEMBER IS STRICTLY PROHIBITED." If RTF hands a membership-restricted form to an ineligible agent, RTF is the one doing the prohibited distributing.

### Why "anything in their market" is only safe because Paul is the gate

Market is a geographic boundary. Some forms are gated by membership, which is narrower than geography. A Birmingham agent who isn't a ValleyMLS member should never be offered a ValleyMLS form just because it's "in their market." The market-wide reach is safe ONLY because Paul confirms, at promote time, that a form is genuinely market-wide eligible and not membership-locked. The breadth is exactly as safe as the review at the gate. If that promotion is ever rubber-stamped, the breadth becomes the liability.

### Required guardrails

- The uploader's attestation protects the uploader only. It does NOT authorize sharing to others.
- At promote time, Paul must affirm the form is eligible for everyone in the chosen scope (and is not membership-locked beyond it).
- Each receiving agent gives their own attestation before using a suggested form.
- Suggestion scope (market/brokerage) is both the relevance filter AND the legal boundary — they are the same filter.

> ℹ️ Pending real-world task already tracked: confirm with AAR (legalforms@alabamarealtors.com) and the Baldwin County Association that hosting and sharing their forms as SaaS templates is permitted before the public shelf goes live.

---

## 7. Market Routing — the `board` Column

> **LOCKED** — captured at upload, defaulting to the uploading agent's market.

RTF routes forms to agents by market with one rule: a blank `board` means "universal — every market." Uploaded forms originally had a blank `board` as a placeholder, which would make a promoted market-specific form leak into every market. The fix gives uploaded forms a real market identity.

### The design

1. Add a `board` column to `uploaded_forms` (additive migration), defaulted to the uploading agent's market, so the form has an identity from the first upload — no backfill later.
2. At promote time, Paul confirms the scope: this agent's market, a specific board, or explicitly universal. "Promote" means "promote with a market scope," defaulting to the form's board, override to universal only if truly meant for everyone.
3. The promoted-forms resolver reuses RTF's existing filter — `board === '' || board === agentMarket` — so a promoted uploaded form is indistinguishable from a hand-built one for routing. Owner-scoped visibility keeps ignoring `board` (an agent always sees their own uploads).

> ⚠️ Promote-to-all must NEVER silently mean every market. The default is the form's own market; universal is an explicit, deliberate override Paul chooses per form.

---

## 8. Signer Placement & Routing

Two decisions govern how an uploaded form becomes correctly signable. Both are locked.

### Template creation — coordinate-placed tabs

> **LOCKED** — Option 1: coordinate-placed tabs.

Each signing/fill box is placed at the exact captured field position and assigned to the correct signer. This is the most faithful match to the hand-built templates and gives full control over which signer owns each signature line. The rejected alternative (DocuSign auto-detect) dumps all signatures onto one recipient — which would break the single most important promise of the product: the right party signs the right line.

### Signer roles & routing — derive, then confirm

> **LOCKED** — Option 1: derive, then confirm in review.

RTF auto-derives the signer/routing from the field roles tagged during review, then shows them as an editable Signers panel that Paul confirms or tweaks before approving. The machine does the tedious first pass; a human confirms before anything goes live. No silent guessing about who signs a contract — which is exactly what the review gate exists to prevent.

---

## 9. Build Status & Sequence

Where the build stands today, and the order remaining work should follow. Each step is its own gated PR; nothing merges without Paul's explicit say-so; the paused v1 hand-built forms and registry stay untouched throughout.

| Step | What it is | Status |
|---|---|---|
| 1 — Data model | uploaded_forms + uploaded_form_fields tables | ✅ Built (PR #128/#130 stack) |
| 2 — Extractor + AI interface | pdf-lib extraction + swappable Claude mapper | ✅ Built (PR #130) |
| 3 — Agent upload + attestation | "My Forms" upload screen + attestation | ✅ Built |
| 4 — Admin review gate | Form Review screen, approve/reject | ✅ Built (PR #132) |
| 5 — Template creation + resolver | Coordinate tabs, derive-confirm signers, board column | ✅ Built (PR #133) — VALIDATE NEXT |
| 6 — Promote-to-all | Market-scoped shared library | ⏸ Paused — gated on validation |
| NEW — Flat-PDF vision path | AI vision detection for non-fillable PDFs | Not started — now core, not optional |
| NEW — Recognition library | Fingerprint + reuse known forms | Not started |
| NEW — Suggestion flow | Offer cleared forms to new agents by market | Not started — see licensing gate |

### The gate before step 6 and the new work

> ⛔ Validate step 5 against the hand-built Buyer Agency Agreement (the ground truth) before building step 6 or any new work on top of the stack. The pipeline's output must match what a human would build: right tab on right field, right signature to right signer.

**Sequencing recommendation:** because Paul expects mostly flat PDFs, the flat-PDF vision path and recognition library are now prerequisites for the sharing/suggestion features being worth anything — there is no point sharing forms most agents can't get through upload. Validate step 5 first; then prioritize flat-PDF handling; then build the public shelf and suggestions with the licensing guardrail in place.

> ℹ️ The hand-built template path remains the fallback. If the vision pipeline needs more investment than is ready, RTF can still launch v1 on the curated forms and let the pipeline mature behind it. Nothing here is a one-way door.

---

*RealTourFlow · Agent Form Upload & Sharing Pipeline · v2 Design Note · June 2026 · Confidential*
