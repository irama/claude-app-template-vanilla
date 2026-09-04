---
name: tooltip
description: Drop-in tooltip engine (anchored + cursor-follow) with React bindings, plus a symptom→cause→fix debug playbook. Use for any task involving tooltips or hover hints — building one, replacing title=, fixing clip/flicker/lag/wrong-flip/no-keyboard-focus (WCAG 1.4.13), cursor-follow tips for charts/canvas/maps, or deciding tooltip vs popover.
---

# Tooltip — reusable two-mode engine + debug playbook

Tooltips break the same handful of ways in every project: they clip on an
`overflow:hidden` ancestor, flicker, flip too eagerly, never show on keyboard
focus, or vanish before you can read them. This skill fixes that once. It ships a
proven engine and, more importantly, the **decision rules and debug table** so any
tooltip work — new build or "this one feels wrong" — lands right the first time.

**Default action for a tooltip task:** copy the bundled files into the project and
wire them up. Do not hand-roll a new tooltip or reach for `title=`. If the project
already has a tooltip primitive, apply this skill's _rules_ and _playbook_ to it
rather than replacing it.

---

## The one decision: anchored vs follow

Get this right and most pain disappears.

- **Anchored (default).** Pins to a target element, holds still while hovered or
  focused. **Everything with a single anchor is anchored**: icons, buttons,
  truncated text, badges, links, form labels. It must **not** track the mouse.
- **Follow (opt-in, `mode:"follow"`).** Tracks the cursor. **Only** for large hover
  surfaces with no single anchor: charts, canvases, maps, heatmaps, timelines.

If you're unsure, it's anchored. Making tracking universal is the most common way a
tooltip system feels cheap.

## When it's NOT a tooltip

A tooltip is **non-interactive** — text only, no links or buttons inside. The moment
you need something clickable in the floating layer, that's a **popover**, not a
tooltip. Don't add interactivity to this engine; build/adopt a popover primitive
instead. A tooltip also never traps focus or blocks the content under it.

---

## Files in this skill (`reference/`)

TS-canonical (all real consumers are TS/React/Next). Drop the four source files into
`src/lib/tooltip/`; the `.ts` strips to plain JS for a non-TS project.

| File               | What it is                                                                       | Where it goes                                     |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `solve.ts`         | Pure placement geometry (offset → shift → flip → re-anchor). No DOM.             | `src/lib/tooltip/`                                |
| `tooltip-core.ts`  | The engine: DOM, timing, a11y, top-layer portal. Imports `./solve`.              | alongside                                         |
| `index.tsx`        | React bindings — `useTooltip` + `<Tip>`. `'use client'`, SSR-safe.               | alongside; import via `@/lib/tooltip`             |
| `tooltip.css`      | Bubble + `--tt-*` token styles (tokens at `:root`), both themes, reduced-motion. | alongside; import once in the root layout         |
| `solve.test.ts`    | Vitest unit tests for the pure solver.                                           | alongside (recommended)                           |
| `tooltip-lab.html` | Self-contained, dependency-free visual testbed — the living spec.                | open directly to see/feel the target; not shipped |

The lab is the runnable reference; open it to show what "good" feels like or A/B a
tuning change.

---

## Install

**React / Next (the common case)** — copy the four source files into `src/lib/tooltip/`,
then import the styles once:

    // src/app/layout.tsx  (or your root)
    import '@/lib/tooltip/tooltip.css';

    // anywhere
    import { useTooltip, Tip } from '@/lib/tooltip';

    // wrap a single element child
    <Tip content="Archive"><button aria-label="Archive">🗄</button></Tip>

    // the hook, when you own the ref (canvas, follow, boundary, onlyIfTruncated, anchor)
    const ref = useTooltip<HTMLCanvasElement>({ mode: 'follow', content: (e) => readAt(e.x) });
    <canvas ref={ref} role="img" aria-label="…accessible alternative…" />

The bundled `tooltip.css` defines its `--tt-*` tokens at `:root`, so the body-mounted
portal resolves them with no extra wiring. Retint the tokens to match your app; only
if your tokens live inside a scoping class do you need `configure({ layerClass })` once.

**Vanilla / non-React** — the engine is framework-agnostic; call `attach` directly
(strip the TS types if not using TS):

    import { attach } from './tooltip-core';
    import './tooltip.css';
    const tip = attach(el, { content: 'Archive' });   // tip.destroy() to remove

---

## API

Core: `attach(target, opts)` · `configure({padding, groupWindow, layerClass})` · `onResolve(fn)`
React: `useTooltip(opts)` → ref · `<Tip content=… placement=… …>{child}</Tip>`

| opt               | default           | notes                                                                                                                           |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `content`         | —                 | string · `{title, sub}` · DOM node · `(e)=>…` (live-read, esp. follow)                                                          |
| `placement`       | `"top"`           | preferred **only** — fallback is automatic                                                                                      |
| `mode`            | `"anchored"`      | `"anchored"` \| `"follow"`                                                                                                      |
| `showDelay`       | `420`             | ms hover-in                                                                                                                     |
| `hideDelay`       | `90`              | ms hover-out (near-instant)                                                                                                     |
| `offset`          | `12`              | px from anchor/cursor (16 reads well for follow)                                                                                |
| `hoverable`       | `false`           | let the pointer enter the bubble (WCAG 1.4.13)                                                                                  |
| `onlyIfTruncated` | `false`           | show only when the **anchored** text is clipped                                                                                 |
| `boundary`        | `null` (viewport) | element to stay inside — a modal/scroll panel (∩ viewport)                                                                      |
| `hideOnClick`     | `false`           | hide on press; don't re-pin from the mouse-focus that follows (toggles)                                                         |
| `decorative`      | `false`           | trigger has its own `aria-label` → tip `aria-hidden`, skip `aria-describedby`                                                   |
| `anchor`          | `null`            | `() => HTMLElement` — position vs a different element than the hover trigger (e.g. hover a big hit-area, point at a small mark) |
| `awayFromCursor`  | `false`           | a top/bottom tip lands on the side **opposite** the cursor — out from under the arriving pointer                                |

---

## Behaviour baked in (the defaults that make it feel good)

- **Portalled to the top layer** (Popover API, z-index fallback) → never clipped by
  an ancestor `overflow` or a bounding box. This is the single biggest source of the
  "tooltip head gets cut off" bug; the engine makes it structurally impossible.
- **Collision pipeline, in priority order:** offset → **shift** along the cross-axis
  for small clips → **flip** to the opposite side on a genuine collision → **re-anchor**
  to a perpendicular side only as a last resort. Never flips the whole tip for a 5px
  overflow. ~8px viewport padding so it never sits flush to the edge. Collisions are
  measured against the **viewport by default**, or a `boundary` element (∩ viewport)
  when you want the tip kept inside a modal or scroll panel. Note: a centered box on a
  wide screen is _not_ a boundary unless you pass it as one — the viewport still has
  room, so a "left" tip stays left. Set `boundary` to constrain to the box.
- **Offset 10–20px** from anchor/cursor — never rendered directly under the pointer
  (that flickers and hides content).
- **Follow mode** is `requestAnimationFrame`-throttled, not raw `mousemove`.
- **Timing with group warm-up:** ~420ms show, ~90ms hide. Once one tip in the group
  is open (or was, within 400ms), the next skips the delay — scrubbing a toolbar
  feels instant, but a cold hover still waits.
- **Accessibility:** shows on keyboard **focus**, dismissible with **Escape**,
  `role="tooltip"` + `aria-describedby`, `hoverable` keeps it alive when the pointer
  moves onto it and never auto-times-out (WCAG 1.4.13 hoverable + persistent),
  reduced-motion respected. Follow tips are unreachable by keyboard by nature — always
  mirror their content into a visible/`aria` alternative on the region.

## Tuning knobs

Adjust per-instance via opts, or globally:

    configure({ padding: 12, groupWindow: 500, layerClass: 'app-scope' });

Feel dial: sluggish → lower `showDelay`; flickery on quick passes → raise it or
raise `hideDelay`; cramped → raise `offset`; too eager to flip → the engine already
shifts first, so a wrong flip usually means the anchor is genuinely against an edge.
A big hit-area whose tip should point at a small mark inside it → set `anchor` to
that mark; a tip that jumps under the arriving pointer → `awayFromCursor`.

---

## Debug playbook — symptom → cause → fix

The reason tooltips are "the bane": the symptom rarely names the cause. This table does.

| Symptom                                                                          | Likely cause                                                                     | Fix                                                                                                                                                       |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Head/side **clipped**, cut off by a panel                                        | Rendered inside an `overflow:hidden`/scroll ancestor                             | Portal it — use this engine (top layer). Never position a tip inside the clipping box.                                                                    |
| **Flickers** on/off rapidly                                                      | Tip sits under the pointer, or hover leaves onto the tip with no bridge          | Keep `offset` ≥ 10px; enable `hoverable` if the pointer must reach the bubble.                                                                            |
| **Flips** to the wrong side for a tiny overflow                                  | Flip-first logic (no shift stage)                                                | Use this engine — it shifts along the cross-axis before flipping.                                                                                         |
| Doesn't show on **keyboard focus**                                               | Only `mouseenter`/`mouseover` wired                                              | Engine binds `focus`/`blur` too; if hand-rolled, add them.                                                                                                |
| **Traps focus** or blocks clicks underneath                                      | Interactive content / `pointer-events` on a full-screen layer                    | Tooltip must be non-interactive; layer is `pointer-events:none` except a `hoverable` bubble. If it needs buttons, it's a popover.                         |
| **Vanishes before you can read it**                                              | Auto-hide timer, or hides the instant the pointer moves                          | Engine is persistent (no read-timeout) + `hoverable`. Satisfies WCAG 1.4.13.                                                                              |
| Feels **laggy** while following the cursor                                       | Positioning on raw `mousemove`                                                   | Throttle with `requestAnimationFrame` (engine does this).                                                                                                 |
| First hover feels **slow**, but rapid ones fine                                  | No warm-up window                                                                | Group warm-up: first waits `showDelay`, rest skip within `groupWindow`.                                                                                   |
| Shows on **every** truncated-looking row                                         | No truncation check                                                              | `onlyIfTruncated` — tips only when the text is actually clipped (measures the anchored element).                                                          |
| Stale content in **follow** mode                                                 | Content captured once at show                                                    | Pass `content` as a function; engine re-reads per frame in follow.                                                                                        |
| `title=` tip is **unstyled / SR double-reads / invisible on touch**              | Native `title` attribute                                                         | Replace with a real tip node (this engine). Keep the trigger's `aria-label` + pass `decorative: true` so the tip is `aria-hidden` (read once, not twice). |
| Breaks Next **SSR** (`document is not defined`)                                  | DOM access at import                                                             | Core lazy-boots on first client `attach`; keep the wrapper `"use client"` and attach in `useEffect`.                                                      |
| Tip **escapes a modal / scroll panel** edge                                      | Collision measured against the viewport, which has room                          | Pass `boundary` (the panel element) so it flips/shifts to stay inside the panel.                                                                          |
| Tip sits on the **preferred side even though the container edge is right there** | The container isn't the collision boundary — the viewport is                     | Same fix: set `boundary`. A centered box on a wide screen doesn't clip against the viewport.                                                              |
| Tip renders **wrong colour / unstyled** at the body portal                       | Design tokens live in a scoping class, not `:root`; the portal mounts outside it | Define `--tt-*` (or your tokens) at `:root`, or `configure({ layerClass: 'your-scope' })` so the layer inherits them.                                     |
| Tip points **above the whole hit-area**, not at the mark                         | Trigger is a large/`self-stretch` element; the tip anchors to its tall rect      | Set `anchor: () => markEl` — hover the big area, position the bubble on the small mark.                                                                   |
| Tip **jumps under the arriving pointer** (e.g. a tall vertical hit-area)         | Fixed side regardless of approach direction                                      | `awayFromCursor: true` — a top/bottom tip lands opposite the cursor.                                                                                      |

**Placement telemetry (debugging aid).** To see exactly what the pipeline decided:

    onResolve((i) => console.log(i));
    // { mode, pref, resolved, collision: "none|shift|flip|flip + shift|re-anchor", x, y }

The testbed's top strip is this hook wired to a readout — the fastest way to prove a
placement bug is the anchor, not the engine.

---

## Porting notes

- The bundled core hand-rolls the offset→shift→flip→re-anchor solver so it has **zero
  dependencies** and drops into anything. It's the proven-feel default.
- If a project already depends on **Floating UI** (`@floating-ui/dom`), you may swap
  the solver for its `offset()/flip()/shift()` middleware — same pipeline, more battle-
  tested edge cases — while keeping this skill's timing, a11y, group warm-up, and CSS.
  Don't add Floating UI just for this; the core is enough.
- Reskin via the `--tt-*` tokens in `tooltip.css` (retint tokens, don't restyle `.tt`).
  The default bubble is a dark instrument chip that reads on any ground in both themes.

## Aligns with the global tooltip rule

This satisfies `~/.claude/CLAUDE.md`'s tooltip mandate: real element (not `title`),
shows on hover **and** focus, sized to its text, and **never clipped** — the exact
"Labels-button gets its head cut off" bug is prevented by construction via the top-
layer portal + collision-aware placement.
