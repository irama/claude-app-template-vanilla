# Robustness Roadmap

Actions over time to reach fleet-wide reliability. Status: ☐ todo · ◐ partial · ☑ done.
When a GitHub remote exists for the template, mirror open items as issues; keep this file as the index.
Source analysis: July 2026 cross-project failure sweep (see [production-playbook.md](production-playbook.md)).

## Phase 1 — Foundations (this template, now)

- ☑ Production playbook + setup checklist + incident runbook (`docs/`)
- ☑ Error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`)
- ☑ Sentry scaffold (client + server, DSN-gated, release-tagged)
- ☑ `/api/health` route with commit SHA
- ☑ `<ErrorDetail>` admin error component (full JSON + copy button)
- ☑ `src/lib/http.ts` — `fetchWithTimeout` / `withRetry` for all third-party calls
- ☑ CI `npm audit` blocking (was `continue-on-error`)
- ☑ Secret-scan hook blocking (was warn-only)
- ☑ Global `/prod-ready` skill (pre-launch gauntlet)
- ☑ Global migration-lint hook (SECURITY DEFINER / RLS-guard checks at write time)

## Phase 2 — Per-project adoption (each existing live app)

For each of: nav, wealth, books, zero, prima, space, spark, publish, monarch-2, morpho —

- ☐ Backport error boundaries + `/api/health` + Sentry from template
- ☐ Run `/prod-ready`; fix findings (expect RLS + drift findings on Supabase apps)
- ☐ Enable PITR + nightly `pg_dump` GH Action; do one restore drill
- ☐ External uptime monitor on `/api/health`
- ☐ Create `docs/gotchas.md` if missing (nav's is the model)
- ☐ Route external API calls through a timeout/retry wrapper

## Phase 3 — Fleet tooling (build once, serves all clients)

- ☐ **Fleet health dashboard** — one page polling every app's `/api/health` + Sentry API + Vercel deploy status (reuse monarch/morpho patterns)
- ☐ **Synthetic user cron** — nightly Playwright critical-path run against each prod app (login → core action), alert on failure
- ☐ **Contract snapshot tests** — committed fixtures + weekly scheduled re-fetch + shape diff for each third-party API (Gmail, Drive, n8n, …)
- ☐ **Spend tripwires** — daily API/LLM/DB spend vs 7-day baseline per app; >3× → alert
- ☐ **`/new-client-app` skill** — template clone + git identity + Sentry + health + uptime + backup workflow, checklist pre-filled
- ☐ **`/gotchas` skill** — post-incident: append postmortem entry; `/prod-ready` reads all sibling gotchas so every app inherits every lesson
- ☐ **`/load-check` skill** — static scan for unbounded queries, per-item awaits in loops, JSONB full-column selects; 10×/100× blowup estimate

## Phase 4 — Client-business layer

- ☐ `docs/client-access.md` template (account inventory, offboarding steps)
- ☐ Hybrid Sentry decision: our org with per-client projects vs client-owned (pick once, document)
- ☐ Ops retainer template for Model B hosting (SLA, backup, incident commitments)
- ☐ Status page for Model B clients
- ☐ Quarterly audit cadence as scheduled cloud agents (`/schedule`): `/prod-ready` + restore drill + money-math audit where applicable

## Review cadence

Revisit this file at each `/session-review` that touches infra, and quarterly. Move completed items to ☑, graduate recurring lessons into the playbook's failure classes.
