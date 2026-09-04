# AGENTS.md

`claude-app-template` — the vanilla starter template for Peak State Next.js apps. Next.js 15
(App Router) + TypeScript (strict) + Tailwind CSS, Vitest + Testing Library, ESLint + Prettier,
Sentry wired, deployed to Vercel. It is a **seed repo**: a new app clones it, replaces the
`[APP_NAME]` / `[ONE_LINE_DESCRIPTION]` placeholders in `CLAUDE.md`, `PROJECT_SPEC.md` and this
file, then builds on top. Nothing here is app-specific by design.

## Commands

| Task | Command |
| --- | --- |
| Install | `npm install` |
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Test (once) | `npm test -- run` (bare `npm test` starts Vitest in watch mode) |
| Test + coverage | `npm run test:coverage` |
| Lint | `npm run lint` (`eslint src --fix`) |
| Typecheck | `npm run typecheck` |
| Format | `npm run format` |
| Everything | `npm run check` — typecheck + lint + tests |
| First-load bundle budget | `npm run size` |

CI (`.github/workflows/ci.yml`, Node 20, PRs + weekly + manual only — no push trigger) runs:
typecheck → `npx eslint src` → `npm run test:coverage` → build → `npm run size` → `npm audit`
(blocking on **critical** production advisories only). Husky `pre-commit` and `pre-push`
(`scripts/ci-gate.sh`) run the same gates locally, which is why CI has no push trigger.
`.github/workflows/db-backup.yml` is a nightly Supabase → Cloudflare R2 dump; it is inert until
the required repo secrets exist.

## Layout

- `src/app/` — App Router routes, `layout.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `api/`
- `src/components/` — shared components; `src/components/ui/` for primitives
- `src/lib/` — utilities. `http.ts` is the wrapper every third-party call goes through
- `src/test/` — Vitest setup and shared test helpers
- `docs/` — conventions, testing workflow, UI gates, accessibility, performance, production playbook
- `scripts/` — `ci-gate.sh` (local gate), `first-load-size.mjs` (bundle budget)
- `data/supabase/`, `data/bigquery/` — create these on demand for SQL/migrations; **never** a
  top-level `supabase/` or `bigquery/` directory

## Conventions

- Strict TypeScript — no `any`.
- Zod validation on every API input.
- Tests live next to the code (`*.test.ts` / `*.test.tsx`) and are written in the same task as
  the code. Utilities and API failure paths are written test-first.
- Tailwind for styling; no parallel CSS system.
- Conventional commits.
- All SQL, migrations, seed data and warehouse definitions live under `data/`.
- Never expose a credential through `NEXT_PUBLIC_*`.

## Gotchas

- **`npm test` watches.** Use `npm test -- run` in any non-interactive context or the process
  never exits.
- **CI installs with `npm install`, not `npm ci`** — deliberate: the macOS-arm64 lockfile misses
  some Linux-only optional transitives. Don't "fix" it back to `npm ci`.
- Every third-party HTTP call goes through `src/lib/http.ts` (timeout + retry). A slow upstream
  must degrade to unknown, never hang a route.
- Sentry is configured in `instrumentation.ts`, `instrumentation-client.ts`,
  `sentry.server.config.ts` and `sentry.edge.config.ts` — a new app supplies its own DSN.
- This is a template: text in `CLAUDE.md` / `PROJECT_SPEC.md` still carries `[APP_NAME]`
  placeholders. Replace them, don't code around them.

## Environment

Copy `.env.example` → `.env.local` and fill it in. Current variables: `NEXT_PUBLIC_APP_URL`,
`NEXT_PUBLIC_SENTRY_DSN`, `HEALTH_READ_TOKENS`. Deployed values live in Vercel's environment
settings. Never commit secrets; `.env.example` carries names and formats only.

## Not in this file

Claude Code workflow rules, skill triggers, agent routing and permissions live in `CLAUDE.md`.
