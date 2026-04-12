# Agents & Commands

This project ships with specialised subagents and slash commands. Use them proactively — don't wait to be asked.

## Subagents (`.claude/agents/`)

| Agent               | When to use                                                 |
| ------------------- | ----------------------------------------------------------- |
| `frontend-dev`      | Building components, pages, forms, client-side interactions |
| `backend-dev`       | API routes, server actions, data layer, server-side logic   |
| `db-architect`      | Schema design, migrations, RLS policies, query optimisation |
| `test-writer`       | Writing tests for new or existing code                      |
| `security-reviewer` | Any time you add auth, handle payments, or touch user data  |

## Slash Commands (`.claude/commands/`)

| Command           | When to use                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `/commit`         | Stage and commit all session changes with a conventional commit message |
| `/review`         | Quality review at session end — lint, typecheck, tests, debug cleanup   |
| `/security-check` | Full security audit before deploying a sensitive feature                |
| `/spec`           | Re-read PROJECT_SPEC.md and report what's built vs what remains         |

## Quality Gates

- **Before finishing any task that touches auth, API routes, or data mutation**: run a quick security spot-check using the `security-reviewer` subagent.
- **Run `/review` at the end of significant sessions** to catch debug leftovers, TypeScript errors, and failing tests before committing.
- **Run `/security-check` before the first deploy of a new feature** that handles user data, auth, or payments.
