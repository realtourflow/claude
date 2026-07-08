# Prioritization rubric

How to turn a pile of open issues into a ranked, filtered, conflict-free batch. This encodes
*this repo's* label taxonomy — if the labels change, update this file.

## The label taxonomy (realtourflow/claude)

| Label | Meaning | Effect on ranking |
|---|---|---|
| `launch-blocker` | Must ship before the first real agents (Launch v1) | **Top priority.** Work these first. |
| `bug` | Something is broken | High — a broken thing beats a nice-to-have. |
| `needs-tdd` | Test-first required; CI must pass | Not a priority signal, a *how* signal — the `/new-feature` flow already does TDD, so these fit the pipeline perfectly. CI gates the auto-merge anyway. |
| `web` | Work in the `web/` Next.js app | Scope tag, not priority. Most tickets have it. |
| `fast-follow` | Post-launch enhancement; not blocking Launch v1 | **De-prioritize** below launch-blockers and plain bugs. |
| `enhancement` | New feature / request | Below bugs. |
| `epic` | Large multi-ticket initiative; needs breakdown | **Exclude** — flag for `/prd-to-issues`. |
| `documentation` | Docs | Low. |
| `good first issue`, `help wanted` | Newcomer-friendly / needs attention | Neutral; use as a tiebreak toward "small & self-contained." |
| `wontfix`, `invalid`, `duplicate`, `question` | Not real work | **Exclude.** |

## Ranking order (highest first)

1. `launch-blocker` (any bug/feature that carries it)
2. `bug` **without** `fast-follow`
3. `bug` **with** `fast-follow`
4. `enhancement` (prefer non-`fast-follow` over `fast-follow`)
5. `documentation` / chores

**Tiebreakers within a tier**, in order:
1. **Single-scope & crisp** — the body has a concrete "Files to touch" and "Required TDD" section
   (this repo's house ticket format). These are the sweet spot for one agent and one clean PR.
2. **Smaller blast radius** — fewer files to touch, no schema/migration changes.
3. **Security / data-integrity / crash** bugs over cosmetic ones (a leaked private note or a
   cross-tenant write beats a mis-aligned button).
4. **Lower issue number** (older) as a final deterministic tiebreak.

## Hard exclusions — never spawn an agent on these

- **`epic`** labeled, OR the title contains "(grouped)" / reads as an umbrella that lists many
  independent fixes. One agent can't cleanly land a bundle, and the resulting mega-PR is unreviewable.
  → Flag it: "run `/prd-to-issues` to break this into shippable tickets first."
- **Already assigned** (`assignees` non-empty) — a human has it.
- **Already has an open PR** — someone (or a prior PM run) is on it. Detect with:
  `gh pr list --state open --search "<#num> in:body"` or check the issue's linked PRs.
- **`wontfix` / `invalid` / `duplicate` / `question`** — not implementable work.

## Sizing sanity check (before selecting)

Even without the `epic` label, skip-and-flag a ticket if, reading its body, it clearly is not a
single coherent change an agent can land in one PR:
- It lists many unrelated sub-fixes ("and also…", multiple checkboxes across different subsystems).
- It has no concrete scope — no files, no acceptance criteria, just a vague complaint.
- It requires a product decision the ticket doesn't answer and the codebase can't (pricing, UX
  direction, external vendor behavior).

A ticket like #197 (one route, one hook, one test file, explicit TDD cases) is ideal. A ticket like
"Notifications & email — completeness (grouped)" is not — flag it.

## Conflict-free batch selection

The reason to care about files up front: parallel PRs that edit the same file **conflict on merge**,
and the second one silently can't auto-merge. So:

1. For each ranked candidate, extract its "Files to touch" list.
2. Greedily pick down the ranked list, taking a ticket only if its file set is disjoint from every
   ticket already picked.
3. On a collision, keep the higher-ranked ticket, skip the collider, and continue.
4. If a must-do top ticket collides with everything available, take it alone and note the deferred
   colliders in the plan — better one guaranteed clean landing than five that fight each other.

If a ticket doesn't list files, infer the likely files from the subsystem it names (e.g. an
"audit log" ticket → `web/app/api/admin/audit-log/*`, `web/hooks/useAdmin.ts`). When you genuinely
can't tell, treat it as potentially-overlapping and prefer tickets you *can* de-conflict.
