# claude-app-template

A reusable starting point for building production-quality **Next.js apps with Claude Code**. It ships the guardrails, docs, subagents, and skills that make Claude produce consistent, accessible, well-tested code from the first prompt — so each new project starts with the conventions already in place instead of re-explaining them every time.

## Stack

Next.js 15 (App Router) · TypeScript (strict) · Tailwind CSS · Vitest + Testing Library · ESLint + Prettier · Vercel. Database/Auth is per-project (Supabase by default).

## Start a new project from this template

1. Clone or "Use this template", then update `CLAUDE.md` (app name, one-liner, database choice) and fill in `PROJECT_SPEC.md` — the source of truth for features, data models, and scope. Delete the template note at the top of `CLAUDE.md`.
2. `npm install`, then `npm run dev`.
3. (Optional) apply a stack option — see below.

`npm run check` runs the full gate: `typecheck` + `lint` + `test`.

## How Claude is guided (progressive disclosure)

`CLAUDE.md` stays short and links out to `docs/*.md` for detail — Claude reads a doc only when the task calls for it, keeping per-session context lean. Add a new practice area by creating `docs/that-area.md` and adding a one-line link in `CLAUDE.md`; never inline the detail.

| Doc                                                    | Read before…                                                                                                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/ui-gates.md`](docs/ui-gates.md)                 | **any UI task** — the single mandatory checklist (search, mobile 375px, WCAG AA, keyboard, motion, optimistic mutations, undo toasts, loading/error, tokens, performance), with a per-task-type scoping table |
| [`docs/ui-patterns.md`](docs/ui-patterns.md)           | building a component — registry + Design Tokens                                                                                                                                                               |
| [`docs/ux-principles.md`](docs/ux-principles.md)       | anything that shows/hides/animates/moves UI                                                                                                                                                                   |
| [`docs/accessibility.md`](docs/accessibility.md)       | keyboard hierarchy, Radix widget map, ARIA                                                                                                                                                                    |
| [`docs/performance.md`](docs/performance.md)           | data-fetching, image, font, or bundle-heavy work                                                                                                                                                              |
| [`docs/conventions.md`](docs/conventions.md)           | TypeScript, component, API, commit rules                                                                                                                                                                      |
| [`docs/testing-workflow.md`](docs/testing-workflow.md) | when to write tests first vs. alongside                                                                                                                                                                       |
| [`docs/agents.md`](docs/agents.md)                     | the full agent + command reference                                                                                                                                                                            |

**ui-gates.md is the one mandatory pre-UI read**; the rest are lookup references consulted when a gate needs detail.

## Agents, commands & skills (`.claude/`)

- **Subagents** — `frontend-dev`, `backend-dev`, `db-architect`, `data-engineer`, `test-writer`, `security-reviewer`, `semble-search`. Use proactively; see [`docs/agents.md`](docs/agents.md).
- **Slash commands** — `/commit`, `/session-review` (session-end quality gate), `/security-check`, `/spec`, `/a11y-audit`.
- **Skills** — `tooltip` (drop-in anchored + cursor-follow engine with a debug playbook).

## Stack options (`.claude/stack-options/`)

Opt-in setup prompts — **not installed by default**. Run one as a prompt at project setup to install, configure, and document a library per the template's conventions:

- [`echarts.md`](.claude/stack-options/echarts.md) — Apache ECharts for data visualisation.
- [`data-warehouse.md`](.claude/stack-options/data-warehouse.md) — BigQuery + dbt pipeline, data-quality conventions, `data-engineer` subagent, optional Cube.dev.

## Key rules

Strict TypeScript (no `any`) · tests mandatory alongside new code · Zod on all API inputs · conventional commits · SQL/migrations live under `data/` (never top-level `supabase/` or `bigquery/`). See [`~/.claude/CLAUDE.md`](https://github.com/irama/claude-config) for cross-project rules (task-summary format, git-auth routing).
