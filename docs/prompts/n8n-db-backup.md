# Hackerman prompt — combined keepalive + streaming DB backup (n8n)

Hand this to the hackerman thread. It sets up nightly Supabase backups on the self-hosted
n8n (VPS), folded into the existing keepalive workflow, streaming dumps to Cloudflare R2.

---

Extend our n8n setup so the existing **Supabase keepalive** workflow
(`https://n8n.srv944543.hstgr.cloud/workflow/Gdcllakvd3f6nE2v`) also takes a nightly
backup of each Supabase project — one workflow, two jobs (keepalive + backup). Do NOT
build this as a naive "pg_dump into a Function/HTTP node" workflow.

## The one hard constraint (read first)

A previous n8n Supabase-backup workflow **ran the VPS out of memory** because it buffered
the entire dump in n8n's Node heap; that's why backups were moved to GitHub Actions. We're
only coming back to n8n because it must now **stream** the dump: `pg_dump` piped directly
to the R2 upload via an **Execute Command** node, so bytes go disk → pipe → R2 and never
enter n8n's JS memory. If you cannot use a streaming Execute Command pipe on this host, stop
and tell me — do not fall back to buffering the dump in a node.

## Prerequisites on the n8n host (verify/install first)

- `pg_dump` **version 17** (must match the Supabase Postgres major; `pg_dump 16` against a
  17 server errors). `postgresql-client-17`.
- `aws` CLI (or `rclone`) for the S3-compatible R2 upload.
- The **Execute Command** node enabled in this n8n instance.
- Network egress from the host to R2 (`*.r2.cloudflarestorage.com`) and to the Supabase
  session pooler (`*.pooler.supabase.com:5432`).
  Confirm each before wiring the workflow; report anything missing instead of working around it.

## Design

Keep the workflow **per-project** in a loop (the keepalive already iterates projects). For
each project, in this order:

1.  **Keepalive (the guaranteed floor).** Run the existing lightweight query (`SELECT 1` or
    the current keepalive touch). This must run FIRST and independently, so a project never
    pauses even if its backup step later fails.
2.  **Streaming backup** — an Execute Command node running exactly this shape (adjust conn +
    prefix per project; credentials from n8n credential store / env, never inline):

        pg_dump "$CONN" --format=custom --no-owner \
          | aws s3 cp - "s3://$BACKUP_BUCKET/$APP/$(date +%F).dump" \
              --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

    `pg_dump -Fc` writes compressed to stdout; `aws s3 cp -` multipart-uploads from stdin in
    chunks. Nothing holds the whole dump. Env for the node: `AWS_ACCESS_KEY_ID`,
    `AWS_SECRET_ACCESS_KEY` (R2 Object Read+Write token), `AWS_DEFAULT_REGION=auto`,
    `R2_ACCOUNT_ID`, `BACKUP_BUCKET`, `CONN`, `APP`.

3.  **Heartbeat ping (only on backup success).** HTTP GET the project's Better Uptime
    heartbeat so a missed/failed backup pages us:
    - nav → `https://uptime.betterstack.com/api/v1/heartbeat/JRcRx4MiLW87pfgN9fnrbGLS`
    - books → `https://uptime.betterstack.com/api/v1/heartbeat/2Zmu5aY7bCrHtQXUfK9nLhAZ`
    - (other projects: create a heartbeat in Better Uptime first, or ask for the URLs.)
4.  **On failure** — surface the error the way the other workflows do (the Errors tab /
    notification), and do NOT ping the heartbeat, so it goes stale and alerts.

## Config

- **Backup bucket:** a DEDICATED PRIVATE R2 bucket for DB dumps (`peakstate-db-backups`) —
  never an app's public media bucket. Key layout `s3://peakstate-db-backups/<app>/<YYYY-MM-DD>.dump`.
- **Retention:** set an R2 lifecycle rule on the bucket (delete after 90 days) in the
  Cloudflare dashboard — don't manage retention in the workflow.
- **Connection strings:** session-pooler URIs, per project, from n8n credentials (the
  keepalive workflow already holds DB access — reuse it). Projects to cover first: **nav,
  books**; then extend to the rest the keepalive already loops (wealth, zero, prima, space,
  spark, …) — add each project's R2 prefix + heartbeat as you go.
- **Schedule:** nightly, staggered a few minutes apart per project so N dumps don't run
  concurrently and spike host memory/CPU.

## Verify before calling it done

- Trigger once manually. Confirm: keepalive ran, an object landed at
  `s3://peakstate-db-backups/nav/<today>.dump` (and books), the heartbeat flipped to
  "received" in Better Uptime, and **host memory stayed flat during the dump** (watch
  `free -m` / container stats — this is the specific thing that failed last time).
- Download one dump and `pg_restore --list` it to confirm it's a valid archive, not a
  truncated stream.

## After it works

Tell me, and I'll disable the GitHub Actions `db-backup.yml` in nav + books so backups
don't run in two places. Until then they're harmless (Actions is billing-blocked anyway).
