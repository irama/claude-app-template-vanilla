# pnpm migration — rollback

`claude-app-template-vanilla` moved from npm to pnpm on **2026-08-04** (fleet spec
[#57](https://github.com/peakstate-global/status.peakstate.global/issues/57)). The cutover commit
is `761f054` ("build: cut over to pnpm — remove package-lock.json").

**This repo has no Vercel project and no production deployment** — it is a template that other
projects are scaffolded from. So there is no "instant rollback" step and no live site to protect;
the only rollback is the code revert below. What *is* at stake is every project cloned from this
template after the cutover, which starts on pnpm.

## Revert the whole migration range, not one commit

The migration is **four commits**, not one. Reverting only the cutover commit `761f054` restores
`package-lock.json` but leaves `pnpm-lock.yaml`, `pnpm-workspace.yaml`, the pnpm-shaped CI
workflow, the pnpm-shaped husky hooks, `scripts/ci-gate.sh` and the `packageManager` pin in place —
a state that builds cleanly under neither manager.

**Range: `129f155..761f054`** (exclusive of `129f155`, inclusive of `761f054`).

    4852270  chore(pnpm): pin pnpm 11.1.2 + Node >=22.13, import pnpm-lock (phase 1/4)
    aa890c9  chore(pnpm): allowBuilds allowlist + verifyDepsBeforeRun (phase 2/4)
    36ccabb  chore(pnpm): convert every call site + CI to pnpm (phase 3/4)
    761f054  build: cut over to pnpm — remove package-lock.json (phase 4/4)

Check nothing has landed on top since — a one-line check:

```bash
git log --oneline 761f054..main
```

Empty output means the range above is still the tip of the migration and a clean revert is safe.
Non-empty means later work sits on it; revert the range anyway, then resolve conflicts against
those commits rather than reverting them too.

```bash
git switch main && git pull --ff-only
git revert --no-commit 129f155..761f054
git commit -m "revert: back out the pnpm migration (fleet spec #57) — <reason>"
npm install                 # regenerates node_modules from the restored package-lock.json
npm run check               # typecheck + lint + tests must pass before pushing
git push origin main
```

## Things that are easy to get wrong

- **The revert restores `package-lock.json`** (deleted in `761f054`) — that is the point. If
  `package-lock.json` is missing after the revert, the range was wrong.
- **`.github/workflows/ci.yml` goes back to `node-version: '20'`** and to `npm install`. Node 20 is
  below `engines.node >=22.13.0`, which the revert also removes — self-consistent, and it is the
  state that existed before the migration.
- **Projects already scaffolded from the pnpm version of this template are not affected by the
  revert.** They carry their own copy. Each would need its own decision.

## Not a rollback trigger

These are expected under pnpm and are not reasons to revert:

- `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` in a **fresh worktree or checkout** — that is
  `verifyDepsBeforeRun: error` doing its job. Run `pnpm install` in that directory once. It replaces
  pnpm's default of silently running a full install mid-gate.
- Next warning that it picked a different workspace root in a nested worktree. Harmless; dev and
  build both succeed. Deliberately *not* fixed with a `turbopack.root` setting, because a hardcoded
  root would propagate into every project scaffolded from this template.
- `@sentry/cli`, `sharp` and `unrs-resolver` reporting that their build scripts were not run. Each
  is denied in `pnpm-workspace.yaml`'s `allowBuilds` on purpose — all three ship their platform
  binary as an optional dependency that needs no script. Verified against a cold store, including
  an 8×8 PNG rendered through sharp with its script denied.
- Vercel's warning about an open-ended `engines.node` in any project scaffolded from this template.
  Deliberate: local dev runs Node 25, so a bounded range would warn locally instead.
