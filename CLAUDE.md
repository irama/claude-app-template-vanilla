# Claude App Template

> This is a reusable template for building production-quality Next.js apps with Claude Code.
> When starting a new project: update this file with project-specific details, fill in PROJECT_SPEC.md, then delete this note.

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
src/
  app/              # Next.js App Router pages and layouts
  components/       # Reusable UI components
    ui/             # Primitive components (Button, Input, etc.)
  lib/              # Utilities, helpers, third-party wrappers
  hooks/            # Custom React hooks
  types/            # Shared TypeScript types
  test/             # Test setup and shared test utilities
```

## Conventions

Read [`docs/conventions.md`](docs/conventions.md) for TypeScript, component, styling, API, testing, and commit rules.
Read [`docs/testing-workflow.md`](docs/testing-workflow.md) for when to write tests first vs. alongside (pragmatic TDD).

**Key rules to always follow:**

- Strict TypeScript — no `any`
- Tests are mandatory alongside new code — write them before marking a task complete
- Utilities and API failure cases: write tests first, then implement
- Zod validation on all API inputs
- Conventional commits

## UI Patterns

Read [`docs/ui-patterns.md`](docs/ui-patterns.md) **before writing any component.** The 3-step search process there is mandatory — not a suggestion. Update the registry when you add a reusable component.

## Performance

Read [`docs/performance.md`](docs/performance.md) before building data-fetching, image, font, or bundle-heavy features. Key rules: no `select('*')`, parallelize server fetches, lazy-import heavy packages, no debug `console.log` in data paths.

## Agents & Commands

Read [`docs/agents.md`](docs/agents.md) for the full list of available subagents and slash commands with guidance on when to use each.

**Key triggers:**

- New component/route → write its test in the same task
- Auth/API/data task → security spot-check with `security-reviewer` before finishing
- End of session → `/review`
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
