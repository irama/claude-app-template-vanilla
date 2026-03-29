# Claude App Template

> This is a reusable template for building production-quality Next.js apps with Claude Code.
> When starting a new project: update this file with project-specific details, fill in PROJECT_SPEC.md, then delete this note.

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

## Conventions

### TypeScript
- Strict mode always — no `any` types
- Prefer `type` over `interface` for simple shapes; use `interface` for objects that may be extended
- Export types from a central `src/types/` directory

### Components
- One component per file, co-located with its test
- File names match component names (PascalCase)
- Props typed explicitly — never infer from usage

### Styling
- Tailwind CSS only — no inline styles, no CSS modules unless unavoidable
- Mobile-first responsive design
- Use `cn()` utility for conditional class merging (install `clsx` + `tailwind-merge`)

### API / Server
- Validate all inputs at the boundary — never trust client data
- Use Zod for runtime validation
- Return consistent error shapes: `{ error: string, code: string }`
- Correct HTTP status codes always

### Testing
- Co-locate tests: `Button.tsx` → `Button.test.tsx`
- Test user behaviour, not implementation details
- Arrange → Act → Assert pattern
- Every test: happy path + invalid input + (if applicable) auth failure

### Commits
Use conventional commits: `type(scope): description`
Types: `feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `style`
Examples:
- `feat(auth): add Google OAuth login`
- `fix(api): handle missing user ID in profile endpoint`
- `chore(deps): update Tailwind to v4`

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
