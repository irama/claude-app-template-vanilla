# Accessibility & Responsive Design

Reference detail for a11y and responsive behaviour. The mandatory checklist lives in [`ui-gates.md`](ui-gates.md) — read this file when a gate there needs the rationale, decision hierarchy, or code.

---

## 1. Mobile-first layout

Build mobile-first: base Tailwind classes apply at all sizes; `md:`/`lg:` prefixes add layout for larger screens only. Never design desktop-first and shrink.

- Renders correctly at **375px** (iPhone SE — most constrained common viewport).
- Stacks vertically on mobile; row/grid at `md:` and above.
- No horizontal overflow — nothing past the viewport edge.
- Touch targets ≥ **44×44px** (`min-h-[44px]` or `p-3` on small icons).
- Text readable without zooming — effective minimum ~14px.

```tsx
// Bad: desktop-first, mobile is an afterthought
<div className="flex gap-4 sm:flex-col">

// Good: mobile-first, desktop is the enhancement
<div className="flex flex-col gap-4 md:flex-row">
```

---

## 2. Light and dark mode

Every colour class works in both modes. Use Tailwind dark pairs consistently: `text-slate-900 dark:text-slate-100`, `bg-white dark:bg-slate-900`, `border-slate-200 dark:border-slate-700`, muted `text-slate-500 dark:text-slate-400`.

**WCAG AA contrast:**

| Text type                                    | Minimum ratio |
| -------------------------------------------- | ------------- |
| Normal text (<18px regular / <14px bold)     | **4.5 : 1**   |
| Large text (≥18px regular / ≥14px bold)      | **3 : 1**     |
| UI components (buttons, inputs, focus rings) | **3 : 1**     |

Secondary/muted text, placeholders, and disabled states commonly fail — check them. Never rely on colour alone; pair with a text label, icon, or pattern.

---

## 3. Keyboard navigation

### The decision hierarchy

Resolve keyboard behaviour in this order — do not skip levels:

```
1. Native HTML element  →  <button>, <a>, <input>, <select>, <textarea>
       keyboard behaviour is free, correct, and cross-browser
2. Radix UI / shadcn primitive  →  Dialog, DropdownMenu, Select, Tabs, etc.
       complex ARIA (focus trap, roving tabindex, arrow-key routing) pre-built
3. Manual ARIA implementation  →  only for genuinely bespoke patterns Radix
       does not cover — this should be rare
```

Never implement level 3 when 1 or 2 applies. The [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) defines correct — but hand-implementing those patterns per project is where bugs accumulate. Radix exists to solve this.

**Use semantic HTML always:** `<button>` for actions, `<a href>` for navigation (incl. Next.js `<Link>`), native `<input>`/`<select>`/`<textarea>` for fields (never faked with `div`), heading hierarchy `h1`→`h2`→`h3` with no level skipping.

```tsx
// Wrong — invisible to keyboard and assistive tech
<div onClick={handleClick} className="cursor-pointer">Click me</div>
// Right
<button onClick={handleClick}>Click me</button>
```

### tabindex — three rules only

| Value           | Rule                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `tabindex > 0`  | **Never.** Creates a custom tab order impossible to maintain; breaks AT navigation. No exceptions.                      |
| `tabindex="0"`  | Only to make a genuinely non-interactive element focusable when no native element fits. Rare — prefer a native element. |
| `tabindex="-1"` | Programmatic focus only: `ref.current?.focus()` on modal open, return-to-trigger on close, focus a validation summary.  |

**Roving tabindex** (toolbars, menus, tab lists, radio groups): one element `tabindex="0"` at a time, rest `-1`, arrows move within, Tab moves out. **Don't implement manually** — use the Radix primitive; it handles roving internally.

### Radix / shadcn widget map

Need one of these patterns → use the primitive. Don't build custom.

| Pattern                    | Radix primitive                    | shadcn         |
| -------------------------- | ---------------------------------- | -------------- |
| Modal / dialog             | `@radix-ui/react-dialog`           | `Dialog`       |
| Dropdown menu              | `@radix-ui/react-dropdown-menu`    | `DropdownMenu` |
| Context menu               | `@radix-ui/react-context-menu`     | `ContextMenu`  |
| Select (single)            | `@radix-ui/react-select`           | `Select`       |
| Combobox / command palette | `cmdk`                             | `Command`      |
| Tabs                       | `@radix-ui/react-tabs`             | `Tabs`         |
| Accordion                  | `@radix-ui/react-accordion`        | `Accordion`    |
| Tooltip                    | `@radix-ui/react-tooltip`          | `Tooltip`      |
| Popover                    | `@radix-ui/react-popover`          | `Popover`      |
| Radio group                | `@radix-ui/react-radio-group`      | `RadioGroup`   |
| Checkbox                   | `@radix-ui/react-checkbox`         | `Checkbox`     |
| Toggle / toggle group      | `@radix-ui/react-toggle-group`     | `ToggleGroup`  |
| Alert dialog (confirm)     | `@radix-ui/react-alert-dialog`     | `AlertDialog`  |
| Sheet / drawer             | `@radix-ui/react-dialog` (or Vaul) | `Sheet`        |

Building a widget not covered → consult the [APG patterns index](https://www.w3.org/WAI/ARIA/apg/patterns/) for correct roles, properties, and keyboard contract before writing code.

### Focus management contract

- **Modal opens** → focus moves to its first focusable element (Radix automatic).
- **Modal closes** → focus returns to the trigger (Radix automatic).
- **Page mutation** (item added/deleted/filtered) → don't steal focus; announce via `aria-live`.
- **Form validation error** → move focus to the error summary or first invalid field (not an alert dialog).
- **`autofocus`** → only in modals and first-run onboarding. Never on page load for general content.

### ARIA live regions

Screen readers won't announce content that changes without a navigation unless you use a live region.

```tsx
// Status, toasts, counts — polite (waits for the user to finish)
<div aria-live="polite" aria-atomic="true">{statusMessage}</div>
// Critical errors only — assertive (interrupts immediately)
<div aria-live="assertive" aria-atomic="true">{criticalError}</div>
```

- `polite` for: toasts, submission results, filter counts, background sync.
- `assertive` sparingly — session expiry, critical errors, security alerts.
- The live region must be in the DOM **before** the content changes — inserting element+content simultaneously is unreliable.

### Focus visibility — never suppress without replacement

```tsx
// Bug — removes ring with nothing to replace it
className = 'focus:outline-none';
// Correct — removes browser default, provides explicit ring
className = 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';
```

Focus rings must be visible against both light and dark backgrounds. Tab order follows visual reading order.

### ARIA labelling

- Icon-only buttons/links: `<button aria-label="Close dialog">`.
- Images: `alt="descriptive text"` (use `alt=""` for purely decorative — never omit `alt`).
- Don't manually add `aria-expanded`/`aria-selected`/`aria-haspopup` to elements inside a Radix primitive — Radix sets these; adding them creates conflicts.

---

## 4. Motion and animation

Respect user preferences; avoid disorienting movement (overlaps WCAG 2.3.3). Wrap decorative animation in `motion-safe:`. No layout-shifting hover effects. Durations: `duration-150`/`duration-200` hover/focus, `duration-300` max modals/drawers.

```tsx
// Bad — animates even for reduced-motion users; hover shifts layout
<div className="animate-pulse hover:p-4 transition-all">
// Good — reduced-motion safe; appearance change without layout shift
<div className="motion-safe:animate-pulse hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150">
```
