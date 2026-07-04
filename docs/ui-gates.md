# UI Quality Gates — mandatory checklist

**This is the one file to read before any UI task.** Every gate below is pass/fail — complete the relevant ones before marking a UI task done. Deep-dive docs (patterns, code examples, rationale) are linked per section; read them when a gate needs detail, not by default.

## Which gates apply

| Task type                    | Search | Mobile | Dark/light | Keyboard | Motion | Mutation | Loading/error |
| ---------------------------- | ------ | ------ | ---------- | -------- | ------ | -------- | ------------- |
| New page or route            | ✓      | ✓      | ✓          | ✓        | ✓      |          | ✓             |
| New component                | ✓      | ✓      | ✓          | ✓        | ✓      |          | ✓             |
| Colour/styling change        |        |        | ✓          |          |        |          |               |
| New interactive element      | ✓      |        |            | ✓        |        |          |               |
| Layout change                |        | ✓      |            |          |        |          |               |
| Animation/transition added   |        |        |            |          | ✓      |          |               |
| Form submit or data mutation |        |        |            |          |        | ✓        | ✓             |
| Destructive action           |        |        |            |          |        | ✓        |               |

## 1. Search before building — [ui-patterns.md](ui-patterns.md)

- [ ] Checked the pattern registry table in `ui-patterns.md`
- [ ] Globbed `src/components/**/*.tsx` for similar names; read near-matches
- [ ] Searched for the core concept noun
- [ ] Close-but-not-identical match → **add a prop, don't fork**; genuinely new → note _"Created X — no existing component matched because Y"_ and update the registry

## 2. Mobile (375px) — [accessibility.md §1](accessibility.md)

- [ ] Mobile-first classes (base = mobile, `md:`/`lg:` add up)
- [ ] Renders at 375px: stacks vertically, no horizontal overflow
- [ ] Touch targets ≥ 44×44px; text ≥ ~14px effective
- [ ] Fixed top-of-screen elements use safe-area padding (`pt-safe` / `env(safe-area-inset-top)`) for PWA/notch
- [ ] Nothing hidden with bare `hidden md:block` — content that matters gets a mobile-appropriate surface

## 3. Dark/light + contrast — [accessibility.md §2](accessibility.md)

- [ ] Every colour class has a `dark:` pair; viewed in both modes
- [ ] WCAG AA: body text 4.5:1, large text and UI components 3:1 — muted/placeholder/disabled states checked (they fail most)
- [ ] No information by colour alone (pair with icon/label/pattern)

## 4. Keyboard + ARIA — [accessibility.md §3](accessibility.md)

- [ ] Hierarchy respected: native HTML element → Radix/shadcn primitive → manual ARIA (rare; consult the widget map in accessibility.md before building any modal/menu/select/tabs by hand)
- [ ] Tab reaches every interactive element in logical order; visible focus ring in both modes (never `outline-none` without a replacement ring)
- [ ] No `tabindex > 0`, ever
- [ ] Icon-only controls have `aria-label`; images have `alt`
- [ ] Modals: focus in on open, back to trigger on close (Radix handles); dynamic updates announce via `aria-live`, never steal focus

## 5. Motion — [ux-principles.md §1–2](ux-principles.md)

- [ ] Every movement traceable to a user action — no unsolicited jiggle/bounce/auto-scroll, no entrance animation on load-visible content
- [ ] No `hover:scale-*` / `hover:translate-*` / layout-shifting hover (colour, shadow, border only)
- [ ] Durations: 150–200ms hover/focus, 300ms max modals/drawers
- [ ] Decorative animation wrapped in `motion-safe:`
- [ ] Never auto-scroll, steal focus, or auto-close/navigate on a timer or background event

## 6. Mutations — [ux-principles.md §3–4](ux-principles.md)

- [ ] Optimistic: UI updates before the server responds; rollback + error toast on failure (SWR `mutate` pattern in the doc)
- [ ] Submit disables + shows spinner immediately; >300ms operations show progress
- [ ] Reversible destructive actions use an **undo toast (≥5s, 8s recommended)**, not a confirmation dialog; confirm dialogs only for the truly irreversible or other people's data

## 7. Loading + error states — [ux-principles.md §9–12](ux-principles.md)

- [ ] Initial loads use skeletons mirroring content shape (`motion-safe:animate-pulse`), spinners only for discrete actions
- [ ] Every loading state exits — to content or to an error state; SWR `error` always handled
- [ ] Every error state offers recovery: retry, escape navigation, or support contact

## 8. Consistency + tokens — [ui-patterns.md — Design Tokens](ui-patterns.md)

- [ ] Buttons use only the `sm`/`md`/`lg` tiers; headings follow the h1–h4 scale; spacing in 4px multiples; modal widths from the table
- [ ] Same problem → same widget everywhere; no parallel near-duplicates — variant props over duplication
- [ ] Cursor: clickables show `cursor: pointer` (global base rule per user CLAUDE.md); tooltips are real elements, never `title=` (use the `tooltip` skill)

## 9. Performance — [performance.md](performance.md)

- [ ] No `select('*')` on tables that grow; enumerate fields
- [ ] Independent server fetches in `Promise.all`
- [ ] Heavy packages (>50KB: editors, charts, PDF, DnD, googleapis) lazy-imported
- [ ] `priority` only on above-fold LCP images; `loading="lazy"` only below fold
- [ ] No debug `console.log` in data paths
