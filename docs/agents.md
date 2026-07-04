# Agents & Commands

This project ships with specialised subagents and slash commands. Use them proactively — don't wait to be asked.

## Subagents (`.claude/agents/`)

| Agent               | When to use                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `frontend-dev`      | Building components, pages, forms, client-side interactions                                   |
| `backend-dev`       | API routes, server actions, data layer, server-side logic                                     |
| `db-architect`      | Schema design, migrations, RLS policies, query optimisation                                   |
| `test-writer`       | Writing tests for new or existing code                                                        |
| `security-reviewer` | Any time you add auth, handle payments, or touch user data                                    |
| `data-engineer`     | ETL pipelines, data warehouse schemas, query optimisation, data quality, background data jobs |

## Slash Commands (`.claude/commands/`)

| Command           | When to use                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/commit`         | Stage and commit all session changes with a conventional commit message                                                                                                                                       |
| `/session-review` | Quality review at session end — lint, typecheck, tests, debug cleanup (renamed from `/review` to avoid colliding with the built-in PR-review command)                                                         |
| `/security-check` | Full security audit before deploying a sensitive feature                                                                                                                                                      |
| `/spec`           | Re-read PROJECT_SPEC.md and report what's built vs what remains                                                                                                                                               |
| `/a11y-audit`     | Full accessibility & UX audit — inventories keyboard management, ARIA, tabindex, and UX violations; produces a prioritised upgrade plan. Run this on existing apps before migrating to Radix/shadcn patterns. |

## Quality Gates

- **Any UI task**: complete the applicable gates in [`docs/ui-gates.md`](ui-gates.md) before finishing.
- **Any task that adds, changes, or removes user-facing functionality**: update `PROJECT_SPEC.md` to reflect the current state before marking the task complete.
- **Before finishing any task that touches auth, API routes, or data mutation**: run a quick security spot-check using the `security-reviewer` subagent.
- **Any pipeline, ingestion, or transformation task**: use `data-engineer` — verify idempotency and data quality gates before finishing.
- **Run `/session-review` at the end of significant sessions** to catch debug leftovers, TypeScript errors, and failing tests before committing.
- **Run `/security-check` before the first deploy of a new feature** that handles user data, auth, or payments.
