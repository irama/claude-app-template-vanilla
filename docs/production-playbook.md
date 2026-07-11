# Production Playbook

The manual we run for **every** project, from first commit to steady-state operation.
Derived from a July 2026 cross-project failure analysis of 20+ launched apps
(nav, wealth, books, zero, prima, space, spark, astrolabe, MARIPOSA, hoomans-hackerman, …).
Companion docs: [client-setup-checklist.md](client-setup-checklist.md) (tick-box setup),
[incident-response.md](incident-response.md) (when things break),
[robustness-roadmap.md](robustness-roadmap.md) (improvements over time).

## The 8 failure classes (what actually breaks after launch)

Evidence-ranked. Every defense in this playbook maps to one of these.

| #   | Class                                                                                                                                                                                                  | Canonical incident                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1   | **Silent security/schema drift** — RLS policies & `SECURITY DEFINER` RPCs lose `auth.uid()` guards on later `CREATE OR REPLACE`; prod schema diverges from migration files while CLI says "up to date" | books: 14 RPCs callable with anon key; wealth: tenant isolation was a no-op |
| 2   | **No error monitoring** — bugs discovered by user report; errors swallowed                                                                                                                             | Only 1 of 20 repos had Sentry; "surface real errors" fix commits everywhere |
| 3   | **Prod-only, build-green failures** — `'use server'` export-shape crashes, server-action deploy skew, service worker behind auth matcher                                                               | nav: users wedged on stale SW (costliest single incident)                   |
| 4   | **Capacity blind spots** — unbounded queries, per-item auth in loops, silent 1000-row PostgREST cap, Vercel 60s/300s function walls                                                                    | nav: bulk fetch × retries took prod down                                    |
| 5   | **Third-party contract drift** — API response shapes change, timeouts too low, stale webhook secrets fail silently                                                                                     | PRIMA: captures silently lost for weeks (403 on stale secret)               |
| 6   | **Async job zombies** — deleting a run row doesn't cancel the in-flight chain; retry storms                                                                                                            | astrolabe: one zombie = 78% of a month's spend                              |
| 7   | **Local tooling self-sabotage** — `.next` corruption (build-then-dev, twin dev servers), local dev pointed at prod DB, parallel-thread git collisions                                                  | space: stale middleware artifact → 40GB swap; nav: prod outage              |
| 8   | **Perennial afterthoughts** — mobile regressions, PWA manifest/icon breakage, money-math bugs only audits catch                                                                                        | 4 repos with identical late icon-fix commits                                |

## Lifecycle stages

### Stage 0 — Project setup (day one)

Run the full [client-setup-checklist.md](client-setup-checklist.md). Non-negotiables:

- Clone this template (it ships error boundaries, `/api/health`, Sentry scaffold, timeout/retry wrappers, blocking CI gates).
- Git identity routing per repo (`~/.claude/docs/git-auth-per-repo-routing.md`) — wrong author email blocks Vercel deploys.
- `.env.local` must point at a **local/dev** Supabase, never prod (failure class 7).
- Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel envs; leave empty locally.

### Stage 1 — Build phase rules

- **Every third-party call** goes through `src/lib/http.ts` (`fetchWithTimeout` / `withRetry`) — generous timeouts, explicit retry policy. Never bare `fetch` to an external API. (class 5)
- **Every list query** is paginated; counts use `count: 'exact'` head requests, never `data.length` (PostgREST caps at ~1000 rows silently). No per-item auth/DB calls inside loops. (class 4)
- **Errors are never swallowed**: catch → log with context → rethrow or surface. Admin users see full error detail via `<ErrorDetail>` (`src/components/error-detail.tsx`) with copy-JSON button. (class 2)
- **Migrations**: the global migration-lint hook flags `SECURITY DEFINER` without `auth.uid()` guards and missing `REVOKE FROM PUBLIC`. Don't bypass it — fix the SQL. Every `CREATE OR REPLACE FUNCTION` must re-state its guards (replace = full overwrite, prior guards are gone). (class 1)
- **Cleanup cancels work**: any delete/abort path for a background job must cancel the in-flight chain (trigger.dev/n8n/queue), not just delete the row. Retry caps must live somewhere that survives the deletion. (class 6)
- **Mobile + PWA are build-time, not fix-passes**: 375px check per UI gate; icons/manifest via `/app-icons` skill before launch, not after. (class 8)
- **Never `npm run build` then `next dev` in the same worktree** without clearing `.next`; one dev server per worktree via `/localhost`. (class 7)

### Stage 2 — Pre-launch gate

Run **`/prod-ready`** (global skill). It verifies:

- Error boundaries present (`error.tsx`, `global-error.tsx`, `not-found.tsx`)
- Sentry wired (client + server) with release tagging
- `/api/health` responds and reports commit SHA
- RLS smoke: anon-key calls against every table/RPC are denied
- Migration drift: `supabase db diff --linked` (or `psql` schema diff) is empty
- Env parity: `.env.example` names ⊆ Vercel env names
- CI gates actually block (no `continue-on-error` on audit)
- Mobile 375px pass on key routes; PWA manifest/icons valid
- Backups: PITR enabled (or nightly dump workflow live) + one restore drill done

Plus `/security-check` for anything touching auth, payments, or user data,
and a `books`-style multi-track audit for money/calculation logic.

### Stage 3 — Deploy

- `/push` is the only prod verb. Its gate: apply migrations first (via `psql` over the IPv4 pooler where the CLI doesn't track files — see per-project memory), production build, push, **then post-deploy smoke**: hit `/api/health`, exercise one critical path.
- Beware server-action deploy skew: a deploy invalidates in-flight client action IDs — forms must recover from rejected server actions. (class 3)
- Exercise the **built** app (`next start`) for any change to `'use server'` modules — build stays green on export-shape crashes. (class 3)
- If the app has a service worker: confirm `/sw.js` and manifest are reachable **signed-out** (curl, expect 200 not 307). (class 3)

### Stage 4 — Operate

- Uptime monitor on `/api/health` (external — UptimeRobot/Better Uptime), alerting to email/Slack.
- Sentry inbox triaged; every prod incident gets a postmortem entry in `docs/gotchas.md` (symptom → root cause → rule). Rules graduate into this playbook.
- Spend tripwires on any LLM/API-heavy pipeline: daily spend vs 7-day baseline; >3× → alert. (class 6)
- Weekly Dependabot PRs triaged; high-severity CVEs patched within the week.
- Quarterly: re-run `/prod-ready` + restore drill + multi-track audit for financial apps.

## Backups & data protection

- **Database**: Supabase PITR on every client project with real user data (paid plan; non-negotiable). Plus nightly `pg_dump` via **GitHub Actions** (not n8n — VPS OOM lesson) to a private repo or R2 bucket.
- **Restore drill before launch**: restore the dump into a scratch project once. A backup never restored is a hope, not a backup.
- **Automation/workflow configs** (n8n, trigger.dev): snapshot JSON to git with a `backup: <name> pre-edit` commit before every edit.
- **Object storage**: second-bucket `rclone sync` monthly + lifecycle rules.
- **Work-in-progress**: commit within the turn on feature branches; a committed SHA survives `git reset --hard`, an uncommitted tree does not.

## Hosting models (multi-client)

**Model A — client pays, we have access (default).** Client owns Vercel team + Supabase org + Sentry org (their card); we're invited as member/developer. Repo under their GitHub org or ours with them as owner; per-repo credential routing handles identity. Clean liability, offboarding = remove access. Optional hybrid: our Sentry org, one project per client, so all errors land in one inbox we triage.

**Model B — we host (agency/platform).** Our Vercel team, per-client Supabase **projects** (not shared multi-tenant DB — tenant-isolation code regresses; see class 1). Implies we own SLAs, backups, incident response, DPAs, rebilling, and status page. Charge an ops retainer. Only at 5+ clients or when clients can't manage accounts.

Setup steps for either model: [client-setup-checklist.md](client-setup-checklist.md).
