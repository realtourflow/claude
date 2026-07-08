# Merge gate

The policy for landing an agent's PR. The user opted into **auto-merge on green CI**, so the default
is to merge — but only through this gate. The bias is deliberately conservative: a PR left open is a
cheap, safe outcome; a bad merge to a live production app is not.

## Merge only if ALL of these hold

1. **The required checks are green.** Gate on the checks `main`'s branch protection actually
   *requires* — not every check that runs. Confirm which are required once per run:
   ```bash
   gh api repos/<owner>/<repo>/branches/main/protection \
     --jq '.required_status_checks.contexts'   # e.g. ["test"] on this repo
   ```
   Then watch only those and block until they conclude:
   ```bash
   gh pr checks <pr> --watch --required --interval 20
   ```
   On this repo the **only** required check is `test` (the `web-ci.yml` typecheck → lint → Vitest →
   build job). The `Playwright E2E`, `Vercel`, and `opencode-review` checks are **not required** —
   they can be pending, slow, or (for opencode) cancelled without blocking the merge. Don't wait on
   them and don't treat their non-green state as a failure. Note `enforce_admins` is on here, so the
   required check is real even for you — never bypass it.

2. **The PR merges cleanly.** No conflicts with `main`:
   ```bash
   gh pr view <pr> --json mergeable,mergeStateStatus
   ```
   Proceed when `mergeable` is `MERGEABLE` and the state is `CLEAN` **or** `UNSTABLE`. `UNSTABLE`
   is the normal state here once `test` passes — it just means a *non-required* check (E2E, Vercel,
   the cancelled opencode-review) isn't green, which doesn't block. Do **not** proceed on `DIRTY`
   (merge conflict) or `BLOCKED` (a required check still pending/failing, or a required review).

3. **The PR touches no production-infra / config paths.** If the diff includes any of these, do
   **not** auto-merge no matter how green CI is — a human reviews it. Check with
   `gh pr view <pr> --json files -q '.files[].path'`:
   - `migrations/**` — merging to `main` triggers the "Prod DB Migrate" GitHub Action against live
     Neon. Real, irreversible schema changes must not happen unattended.
   - `web/prisma/schema.prisma` — paired with migrations; same reason.
   - `.github/workflows/**` — changes CI/CD itself.
   - `vercel.json` / `vercel.ts`, `web/next.config.*`, or anything under a prod env / secrets path.
   Leave these open, comment "⏸ infra change — needs human review before merge," and report them.

## How to merge

Because each agent works in an isolated **worktree**, its branch is checked out there — and
`gh pr merge --delete-branch` will fail on the *local* branch ("cannot delete branch ... used by
worktree") and that failure aborts the remote-branch deletion too. So remove the worktree **first**,
then merge. The worktree path comes from the agent's completion notification (`<worktree>` block):

```bash
git worktree remove --force "<worktreePath>"   # frees the branch; do this BEFORE merging
gh pr merge <pr> --squash --delete-branch       # now deletes both local and remote cleanly
git worktree prune
```

If you didn't remove the worktree first and the merge errored on branch deletion, the PR still
merged (check `gh pr view <pr> --json state`) — just finish the cleanup by hand:
`git push origin --delete <branch>` + `git worktree remove --force <path>` + `git branch -D <branch>`.

Squash keeps `main` history one-commit-per-ticket and clean. The PR body's `Closes #<n>` auto-closes
the issue on merge; optionally add a comment on the issue linking the merged PR.

## When NOT to merge — what to do instead

| Situation | Action |
|---|---|
| CI red | Leave open. Report which check failed (e.g. "Vitest: 2 failing"). The agent's self-review may already name the gap. |
| Merge conflict (`mergeStateStatus` = `DIRTY`) | Leave open. Report "needs rebase onto main." Common when two batch tickets touched a shared file the pre-selection missed. |
| Touches infra/migrations | Leave open. Report "infra change — review before merge." |
| Branch protection requires review | Leave open. Report "ready to merge, blocked by required review." Don't try to bypass. |
| Agent returned BLOCKED / no PR | Nothing to merge. Report what the agent got done (branch? partial commits?) and leave the ticket for a human or a fresh run. |
| Checks still pending after a long wait | Leave open, report "CI still running." Don't merge on incomplete signal. |

Never use `--admin` to override failing checks or required reviews. Never force-merge. The whole
point of the gate is that `main` stays deployable.
