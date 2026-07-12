# Client / Project Setup Checklist

Tick every box when standing up a new project. Companion to
[production-playbook.md](production-playbook.md). Copy this file's checklist into the
project's first GitHub issue (or `.scratch/setup.md` pre-remote) and check items off there.

## 1. Accounts & ownership (pick hosting model first — playbook § Hosting models)

**Model A (client pays, default):**

- [ ] Client creates Vercel team (their card) → invites us as **Member**
- [ ] Client creates Supabase org + project (their card) → invites us as **Developer**
- [ ] Sentry: their org (invite us) — or our org with a per-client project (hybrid)
- [ ] GitHub repo under client org (or ours with client as owner/admin)
- [ ] Record account inventory in `docs/client-access.md` (who owns what, no secrets)

**Model B (we host):** our Vercel team + a dedicated Supabase project per client; DPA + ops retainer agreed in writing.

## 2. Repo bootstrap

- [ ] Clone `claude-app-template-vanilla`; update `CLAUDE.md` project section + `PROJECT_SPEC.md`; delete template note
- [ ] Git identity routing: `git config --local credential.helper` set per `~/.claude/docs/git-auth-per-repo-routing.md`; verify `GIT_TERMINAL_PROMPT=0 git push --dry-run origin main`
- [ ] CI green on first push (typecheck, lint, tests, build, size, **blocking** audit)
- [ ] Branch protection on `main` (PRs or the 4-verb flow only)

## 3. Environments & secrets

- [ ] `.env.local` points at **dev/local** Supabase — never prod (verify URL twice)
- [ ] Every env var named in `.env.example` with format placeholder + comment
- [ ] Vercel envs set for Production (and Preview where they differ)
- [ ] Env parity verified: `.env.example` names ⊆ `vercel env ls`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` server-only (never `NEXT_PUBLIC_*`)

## 4. Observability (template ships the code — wire the accounts)

- [ ] Sentry project created; DSN from `https://<org>.sentry.io/settings/projects/<project>/keys/`; `NEXT_PUBLIC_SENTRY_DSN` set in Vercel (+ `SENTRY_AUTH_TOKEN` for source maps)
- [ ] Verify one test error arrives in Sentry from a Preview deploy
- [ ] `/api/health` returns 200 + commit SHA on the deployed URL
- [ ] External uptime monitor on `/api/health` → alert to email/Slack
- [ ] Admin error detail wired: app's admin flag feeds `<ErrorDetail>` so admins get full JSON + copy button

## 5. Database & backups

- [ ] All SQL under `data/supabase/` (template convention)
- [ ] RLS enabled on every table from the first migration; RLS smoke test in CI or `/prod-ready`
- [ ] PITR enabled (Supabase → Database → Backups) for any real user data
- [ ] Nightly `pg_dump` GitHub Action → **dedicated private R2 bucket** (ship `.github/workflows/db-backup.yml`; secrets: `PROD_DATABASE_URL`, `R2_*`, `BACKUP_R2_BUCKET`); set a bucket lifecycle rule. Never the media bucket. Client work → bucket in the client's own Cloudflare account (see playbook § Backups)
- [ ] **Restore drill completed once** (dump → scratch project → app boots against it)
- [ ] Migration application path documented in project CLAUDE.md (CLI-tracked vs direct `psql` over IPv4 pooler)

## 6. Third-party integrations

- [ ] Every external call routed through `src/lib/http.ts` (timeout + retry)
- [ ] Webhook secrets stored in envs; a failed signature check **logs loudly** (never a silent 403)
- [ ] Response-shape assumptions captured as a committed fixture + Zod schema at the boundary
- [ ] Job/queue systems: delete/abort paths cancel in-flight work; retry caps survive row deletion

## 7. Pre-launch

- [ ] `/prod-ready` passes (full gauntlet — see playbook Stage 2)
- [ ] `/security-check` on auth/payment/data surfaces
- [ ] Mobile 375px pass on all key routes; PWA icons/manifest via `/app-icons`
- [ ] `/sw.js` + manifest reachable signed-out (200, not 307) if PWA
- [ ] Legal pages if user-facing (`/legal-pages` skill)
- [ ] `docs/incident-response.md` reviewed; client knows how to report an issue

## 8. Handover / steady state

- [ ] `docs/gotchas.md` created (empty is fine — it's the postmortem log)
- [ ] Dependabot triage owner named; CVE SLA: high severity ≤ 1 week
- [ ] Quarterly re-run of `/prod-ready` + restore drill scheduled
- [ ] Client access doc final: what they own, what we access, offboarding steps
