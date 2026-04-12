# UI Patterns Registry

**Before building any new UI, check this file first.** If a pattern exists, reuse it. If you build something new that could be reused, add it here.

## Registered Patterns

| Pattern                                                     | Component(s) | Keywords |
| ----------------------------------------------------------- | ------------ | -------- |
| _(none yet — add entries as you build reusable components)_ |              |          |

## Rules

1. **Check before building**: Search the registry above + look in `src/components/ui/` before writing new UI.
2. **Update when adding**: If you add a genuinely new pattern that others might reuse, add it to this table.
3. **No silent divergence**: If a component is used in two places, they must share the same source — never copy-paste a component to make a "slightly different version".
4. **Variant props over duplication**: If you need a minor variant, add an optional prop to the existing component. Only split into a new component if the variants are fundamentally incompatible.
