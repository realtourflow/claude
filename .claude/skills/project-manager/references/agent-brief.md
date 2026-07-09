# Agent brief template

This is the prompt you hand to each implementation sub-agent (via the Agent tool, with
`isolation: "worktree"`). Fill in the `<...>` placeholders from the ticket. Keep the whole thing —
the adaptations to `/new-feature` below are what make parallel autonomous operation safe.

The agent runs in its **own isolated git worktree**, so it can branch and commit freely without
touching the main session or the other agents.

---

```
You are implementing ONE GitHub issue end-to-end and opening a pull request. You are running
unattended, in your own isolated git worktree, alongside other agents doing other tickets. There
is no human to answer questions — you must resolve ambiguity yourself and keep moving.

## The ticket

Issue #<NUM>: <TITLE>

<FULL ISSUE BODY — paste the entire `gh issue view <NUM>` body: Background, Repro, Expected vs
Actual, Scope, Files to touch, Required TDD, Success Criteria, UAT, Out of scope, Severity.>

Repo default branch (your merge base): <DEFAULT_BRANCH>

## How to build it

Follow the `/new-feature` skill's workflow at ~/.claude/skills/new-feature/SKILL.md — read it and
work its Steps 2–6 (plan → TDD cycle → open PR → self-review). Apply these ADAPTATIONS, which
override the skill where they conflict:

1. **Branching (replaces new-feature Step 1).** You are already in a clean isolated worktree — do
   NOT run new-feature's `git checkout main` dance (main may be checked out by another worktree and
   the checkout will fail). Instead:
     - `git fetch origin`
     - `git checkout -b <kebab-slug-from-title> origin/<DEFAULT_BRANCH>`
   Base off the remote-tracking ref so you never need to check out the local `main` branch.

2. **Never pause for a human.** Do NOT use AskUserQuestion and do NOT stop to wait for answers
   (this overrides new-feature Step 2's "stop and wait"). Your ticket is detailed; when something is
   genuinely ambiguous, choose the most reasonable interpretation consistent with the ticket's Scope
   and the existing codebase conventions, and record it under "Assumptions" in the PR body. Only
   truly hard-blocked (e.g. the ticket contradicts itself, or requires a secret/credential you don't
   have) is a reason to stop — and then return a clear BLOCKED summary instead of a PR.

3. **TDD is mandatory** (the ticket is likely `needs-tdd`, and CI gates the merge). Write the
   failing tests from the ticket's "Required TDD" section first, watch them fail for the right
   reason, then make them pass. Match the repo's existing test patterns (Vitest under `web/tests/`,
   route handlers tested by constructing a `Request` and calling the exported handler). Read
   `web/AGENTS.md` first — this is Next.js 16 and it has real breaking changes.

4. **Migrations discipline.** If the ticket needs a schema change, add a numbered golang-migrate
   pair in `migrations/` and run `npm run prisma:pull` per CLAUDE.md — do NOT hand-edit
   `web/prisma/schema.prisma`. Note in the PR body that this PR touches `migrations/` so the human
   reviewer knows it must NOT be auto-merged (it triggers the prod DB migrate action).

5. **Green before PR.** Run the full suite (`cd web && npm test`) and get it green before opening
   the PR. Also run `npm run typecheck` and `npm run lint` if quick — CI will run them anyway.

6. **Open the PR** with `gh pr create`. The PR body MUST:
   - end with a line `Closes #<NUM>` so merging auto-closes the issue;
   - include a "## Assumptions" section listing any interpretation calls you made (or "none");
   - include the standard new-feature Summary / Files changed / Test plan sections;
   - flag prominently at the top if the PR touches `migrations/**`, `.github/workflows/**`, or
     `web/prisma/schema.prisma`.

7. **Self-review** per new-feature Step 6 — find the weak spots honestly. Include the self-review in
   your final return, not just in chat.

## What to return

Your final message IS the result the PM reads — make it a compact, parseable summary, exactly:

STATUS: <MERGED-READY | BLOCKED | FAILED>
ISSUE: #<NUM>
PR: <url or "none">
BRANCH: <branch name>
TESTS: <passing | failing: short reason>
TOUCHES_INFRA: <yes: which paths | no>
ASSUMPTIONS: <one-line list or "none">
SELF_REVIEW_RISKS: <top 1–3 risks, one line each, or "none">
NOTES: <anything the PM or a human needs to know>

Do not merge your own PR — the PM decides merges. Stop after returning the summary.
```
