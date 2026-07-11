# Claude App Template

> This is a reusable template for building production-quality Next.js apps with Claude Code.
> When starting a new project: update this file with project-specific details, fill in PROJECT_SPEC.md, then delete this note.

> **See also:** `~/.claude/CLAUDE.md` for user-level cross-project rules (task summary format, git push offer convention, etc.).

> **How this file is structured — progressive disclosure:** This file stays short by linking out to `docs/*.md` for detail. If you add a new practice area, create `docs/that-area.md` and add a one-line link here — do not add inline content. Apply the same principle to agent definitions: keep the agent prompt concise and link to or inline only what that agent specifically needs.

## Project Overview

**App name:** [APP_NAME]
**What it does:** [ONE_LINE_DESCRIPTION]

Read `PROJECT_SPEC.md` before writing any code. Treat it as the source of truth for features, data models, and scope.

## Tech Stack

- **Frontend:** Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Testing:** Vitest + Testing Library
- **Linting:** ESLint + Prettier
- **Deployment:** Vercel
- **Database/Auth:** [e.g. Supabase — update per project]

## File Structure

```
data/
  supabase/         # Migrations, seed SQL, RLS policies (never use top-level /supabase)
  bigquery/         # SQL transforms and schema definitions (never use top-level /bigquery)
src/
  app/              # Next.js App Router pages and layouts
  components/       # Reusable UI components
    ui/             # Primitive components (Button, Input, etc.)
  lib/              # Utilities, helpers, third-party wrappers
  hooks/            # Custom React hooks
  types/            # Shared TypeScript types
  test/             # Test setup and shared test utilities
```

**Data & database convention:** All SQL, migrations, seed data, and data warehouse definitions live under `data/` in the project root. Use `data/supabase/` and `data/bigquery/` — never create top-level `supabase/` or `bigquery/` directories.

## Code Search

Pick by question type — one tool per question, don't stack them:

- **Semantic / "how does X work" / "where is the thing that…"** → `semble-search` subagent
- **Structural / exact syntax patterns** (find all `useSWR` calls, every `select('*')`) → `ast-grep` (`sg`) via Bash
- **Known file, known location** → `Read` directly

Never use the Grep tool (disabled globally) or read whole directories to search.

## Conventions

Read [`docs/conventions.md`](docs/conventions.md) for TypeScript, component, styling, API, testing, and commit rules.
Read [`docs/testing-workflow.md`](docs/testing-workflow.md) for when to write tests first vs. alongside (pragmatic TDD).

**Key rules to always follow:**

- Strict TypeScript — no `any`
- Tests are mandatory alongside new code — write them before marking a task complete
- Utilities and API failure cases: write tests first, then implement
- Zod validation on all API inputs
- Conventional commits

## Production Robustness

Read [`docs/production-playbook.md`](docs/production-playbook.md) — the manual run on **every** project (8 post-launch failure classes + lifecycle stages). Companions: [`docs/client-setup-checklist.md`](docs/client-setup-checklist.md) (tick-box project/client setup), [`docs/incident-response.md`](docs/incident-response.md) (prod rollback runbook), [`docs/robustness-roadmap.md`](docs/robustness-roadmap.md) (fleet improvements over time).

**Key triggers:** new project → run the setup checklist; before launch → `/prod-ready`; prod incident → incident runbook, then postmortem in `docs/gotchas.md`. Third-party calls go through `src/lib/http.ts`; admin-facing error detail via `src/components/error-detail.tsx`.

## UI Quality Gates

Read [`docs/ui-gates.md`](docs/ui-gates.md) **before any UI task** — it is the single mandatory checklist (search-before-build, mobile 375px, WCAG AA both modes, keyboard, motion, optimistic mutations, undo toasts, loading/error states, tokens, performance). Its "Which gates apply" table scopes what to check per task type.

Deep-dive references — consult when a gate needs detail, not by default:

- [`docs/ui-patterns.md`](docs/ui-patterns.md) — component registry (update it when adding reusable patterns) + Design Tokens (only permitted button sizes, heading scale, spacing)
- [`docs/ux-principles.md`](docs/ux-principles.md) — locus of control, motion, optimistic/undo patterns with code
- [`docs/accessibility.md`](docs/accessibility.md) — keyboard hierarchy, Radix widget map, ARIA live regions, tabindex rules
- [`docs/performance.md`](docs/performance.md) — data fetching, bundle, image/font patterns

## Agents & Commands

Read [`docs/agents.md`](docs/agents.md) for the full list of available subagents and slash commands with guidance on when to use each.

**Key triggers:**

- Any UI task → complete the applicable gates in `docs/ui-gates.md` (undo toasts for destructive actions and optimistic mutations are gates 6–7 there)
- Any task adding/changing/removing user-facing functionality → update `PROJECT_SPEC.md` before finishing
- New component/route → write its test in the same task
- Auth/API/data task → security spot-check with `security-reviewer` before finishing
- Any pipeline, ingestion, or data transformation task → use `data-engineer` agent; verify idempotency and data quality gates
- End of session → `/session-review`
- Pre-deploy on sensitive features → `/security-check`

## Permissions

You have permission to — no need to ask:

- Read, write, and delete any file in this project directory
- Run npm scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `check`)
- Run git commands (`add`, `commit`, `status`, `log`, `diff`, `branch`, `checkout`)
- Install npm packages
- Create and modify configuration files

Do NOT:

- Commit or push to remote without being asked
- Delete the `.husky/`, `.github/`, or `.claude/` directories
- Hardcode secrets, API keys, or credentials — use environment variables

## Working Style

Work autonomously. Complete the full task before summarising. If two approaches are equally valid, pick the better one and note your choice briefly. Do not pause mid-task to ask clarifying questions unless you are genuinely blocked.

After completing a task, briefly state: what you built, any deviations from the spec, and what remains.

## Environment Variables

Never hardcode secrets. Always use:

- `.env.local` for local development (gitignored)
- Vercel environment variables for deployed environments

Add new env vars to `.env.example` with placeholder values (this file IS committed).
