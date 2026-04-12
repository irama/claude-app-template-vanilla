# UI Patterns Registry

**Before building any new UI, check this file first.** If a pattern exists, reuse it. If you build something new that could be reused, add it here.

## Registered Patterns

| Pattern                                                     | Component(s) | Keywords |
| ----------------------------------------------------------- | ------------ | -------- |
| _(none yet — add entries as you build reusable components)_ |              |          |

## Before you build — mandatory search process

Before writing any new component, complete all three steps:

1. **Check this registry** — scan the table above for anything matching your use case (use the Keywords column liberally).
2. **Glob the component tree** — run `Glob src/components/**/*.tsx` and scan file names for anything similar. Similarity in name = read that file before proceeding.
3. **Grep for the concept** — search for the core noun (e.g. `grep -r "ActionItem"` or `grep -r "Lightbox"` in `src/components/`).

If you find an existing component that's close but not identical: **add a prop, don't fork.** Read the component, understand its interface, and extend it.

**When you do create something new**, add a one-line note in your task summary: _"Created X — no existing component matched because Y."_ This keeps the decision visible and auditable.

## Rules

1. **No new component without the 3-step search above** — this is a gate, not a suggestion.
2. **Update this registry** when you add a genuinely reusable pattern.
3. **No silent divergence** — if a component is used in two places, they share one source file. Never copy-paste to make a "slightly different version".
4. **Variant props over duplication** — if you need a minor variant, add an optional prop. Only create a new component if the variants are fundamentally incompatible (different data shape, different interaction model).
