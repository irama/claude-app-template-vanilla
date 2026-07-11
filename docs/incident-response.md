# Incident Response Runbook

When production breaks. Goal: restore service first, diagnose second, document third.

## 0. Triage (2 minutes)

- What changed last? `vercel ls` / Vercel dashboard → most recent deploy time vs incident start.
- Scope: one user, one route, or everyone? Check `/api/health`, Sentry issue volume, uptime monitor.
- Data-loss risk? If writes are corrupting data, **pause the writer first** (disable the cron/webhook/feature flag) before anything else.

## 1. Restore service

### Bad deploy (most common)

Vercel dashboard → Project → Deployments → previous good deployment → **⋯ → Promote to Production** (alias rollback, ~seconds). Or CLI:

```bash
vercel rollback            # interactive, or: vercel promote <deployment-url>
```

Note: rollback does NOT undo migrations or revert server-action IDs — clients with stale pages may need a hard refresh.

### Bad migration

Forward-fix by default (write a corrective migration); restore from backup only for data corruption.

```bash
# corrective migration, applied the same way the project applies migrations
psql "$PROD_POOLER_URL" -f data/supabase/migrations/<fix>.sql
```

If data is corrupted: Supabase dashboard → Database → Backups → PITR → restore to timestamp _just before_ the bad write. PITR restore replaces the whole DB — coordinate with the client, expect minutes of downtime.

### Wedged service worker (PWA)

Symptom: users stuck on old version even after redeploy. Verify `curl -sI https://<app>/sw.js` → must be 200 signed-out. If it was 307/blocked: fix the middleware matcher, redeploy, bump the SW `CACHE_BUSTER`; users recover on next visit.

### Runaway job / spend spike

Cancel in-flight runs at the platform (trigger.dev dashboard / n8n executions), THEN fix the code. Check for orphans: jobs whose parent row was deleted keep running — cancel by ID at the platform, not via the app.

## 2. Diagnose

- Sentry issue → stack + release SHA → `git log <sha>` for the offending commit.
- Vercel logs are retained ~1h on hobby/short on pro — Sentry (and any stage-events table) is the durable record.
- Admin error JSON (copy button) from the affected user pastes straight into a Claude thread.
- Prod-only + build-green? Suspect `'use server'` export shapes, deploy skew, middleware matchers — reproduce with `npm run build && npm start`, not `next dev`.

## 3. Document

Same day, append to `docs/gotchas.md`:

```markdown
## <date> — <one-line symptom>

- Symptom: what users saw
- Root cause: actual mechanism (not the first plausible story)
- Fix: commit SHA(s)
- Rule: what we now do differently (graduate to production-playbook.md if cross-project)
```

## Escalation & comms

- Client-facing apps: tell the client within the hour for user-visible outages — what broke, service restored or ETA, follow-up when postmortem done.
- Never hand-fix prod data ad hoc: fix through a migration/script committed to the repo, so the fix is reviewable and repeatable.
