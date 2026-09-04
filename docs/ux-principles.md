# UX Principles

Reference detail for UI behaviour. The mandatory checklist lives in [`ui-gates.md`](ui-gates.md) — read this file when a gate there needs the rationale, pattern, or code.

---

## 1. User retains locus of control

The user drives. The interface follows their intent — it never acts on their behalf without a signal.

- Never auto-scroll content the user may be reading. Only scroll on explicit user action (a "Jump to bottom" click, a form submit that moves focus).
- Never steal focus from an element the user is interacting with.
- Never close a menu, sheet, or popover because of a timer or background event — only on user action (click outside, Escape, explicit close).
- Never redirect or navigate away without user intent. Background refreshes must not cause navigation.

---

## 2. No unmotivated movement

Fast, purposeful animation is fine. Unsolicited jiggle, bounce, grow-on-hover, and auto-scroll are not. **The test:** can you point to the user action that caused this movement? If yes — motivated. If no — remove it.

- No scale/size transforms on hover (`hover:scale-105`). Use colour, shadow, or border for hover feedback.
- No layout shifts from adding padding/margin on interaction (a card gaining `p-4` on hover pushes surrounding content).
- No entrance animations on content already visible on load — reserve for things appearing in response to user action.
- Transitions short: `duration-150`/`duration-200` for hover/focus; `duration-300` max for modals and drawers.
- Always respect `prefers-reduced-motion` — wrap decorative animation in `motion-safe:`.

```tsx
// Bad — unsolicited movement, ignores reduced motion
<div className="hover:scale-105 transition-transform duration-300">

// Good — colour feedback only, no movement
<div className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors duration-150">

// Good — animated entrance, but respects reduced motion
<div className="motion-safe:animate-fade-in">
```

---

## 3. Optimistic updates and immediate feedback

Change the UI instantly, then reconcile with the server in the background. Never make the user wait for a round-trip before seeing their action reflected.

- Apply state changes to the UI before the server request completes; roll back with an error toast on failure.
- Always acknowledge a user action immediately — disable submit buttons, show a spinner, or change state — even if the work takes time.
- Show visible content as fast as possible; lazy-load hidden/below-fold content in the background.
- If an async operation takes >300ms, show a progress indicator.

```tsx
// Optimistic delete with useSWR mutate
async function handleDelete(id: string) {
  mutate('/api/items', (current) => current?.filter((item) => item.id !== id), {
    revalidate: false,
  });
  try {
    await deleteItem(id);
    mutate('/api/items'); // confirm with server
  } catch {
    mutate('/api/items'); // roll back by revalidating
    toast.error('Could not delete — changes reverted');
  }
}
```

---

## 4. Easy undo over confirmation dialogs

When something disappears (deleted, archived, moved out of filter scope), don't interrupt with a confirmation dialog. Let the action complete immediately and offer a time-limited undo toast.

**Undo instead of confirm** for: deleting an item the user just created or is viewing; archiving/hiding content; removing a tag, relation, or link; any action reversible within ~30s.

**A confirmation dialog IS appropriate** for: irreversible destructive actions (deleting an account, purging a dataset); significant not-obviously-undoable consequences; actions affecting other people's data.

```tsx
toast('Item deleted', {
  action: { label: 'Undo', onClick: () => restoreItem(id) },
  duration: 8000, // enough time to notice and act
});
```

Undo must restore the item to exactly its previous state and position.

---

## 5. Consistent, familiar UI elements

Users build trust through pattern recognition. Once a widget solves a problem, use it everywhere that problem recurs.

- Before building any new interactive element, check [`ui-patterns.md`](ui-patterns.md) first.
- If a standard element exists, use it — even if you could build something slightly more bespoke.
- Add genuinely new patterns to `ui-patterns.md` so they can be reused.
- Never keep two slightly different versions of the same element in parallel — consolidate into one component with props.

---

## 6. Consistent rhythm and sizing

Canonical button sizes, heading scale, spacing, and modal widths live in **[`ui-patterns.md` — Design Tokens](ui-patterns.md)**. Use only those tiers — no ad-hoc `text-lg font-bold` headings, no arbitrary `px-[18px]` spacing, no off-scale button classes. Spacing is always a multiple of 4.

---

## 7. PWA / fullscreen mode

In PWA mode (standalone display) the browser chrome is gone — content can reach the top of the screen and collide with the notch or status bar.

- Add `pt-safe` (or `padding-top: env(safe-area-inset-top)`) to any fixed header or top-of-screen element.
- Never place interactive elements in the top ~44px without safe-area padding — unreachable on notched devices.
- Test with Safari "Add to Home Screen" or the Xcode simulator's notched profiles.

```tsx
<header className="fixed top-0 inset-x-0 pt-safe bg-white dark:bg-slate-900">
// CSS fallback: style={{ paddingTop: 'env(safe-area-inset-top)' }}
```

---

## 8. Responsive design collapse rules

| Screen size      | Layout rule                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Mobile (`< md`)  | Single column, everything stacks. Side panels/drawers become modals or bottom sheets.                        |
| Tablet (`md–lg`) | Two-column max; overflow flows below (not truncated). Horizontal scroll OK for data tables/timelines/kanban. |
| Desktop (`> lg`) | Full layout — multi-column sidebars and panels fine.                                                         |

Never hide content on mobile with bare `hidden md:block`. If it matters, surface it mobile-appropriately (collapsed section, bottom sheet, secondary screen).

---

## 9. Skeleton screens over generic spinners

For initial content loads, use a skeleton that mirrors the actual content layout — not a centred spinner. Preserves layout stability, reduces perceived load, prevents shifts when content arrives.

- Spinner only for discrete actions (button submit, file upload) where there's no content shape to mirror.
- Skeletons match the approximate height and column structure of the loaded content.
- Pulse with `motion-safe:animate-pulse` to respect reduced motion.

```tsx
<div className="space-y-3">
  <div className="h-5 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" />
  <div className="h-4 w-full rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" />
  <div className="h-4 w-5/6 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-700" />
</div>
```

---

## 10. Inline editing over modal editing

Let users edit content in place rather than opening a modal where possible. Reserve modals for: multi-field forms needing a clean context (creating a new entity); multi-step flows; actions that must clearly block the underlying page. For single-field edits (rename, change a value, toggle), use click-to-edit inline with explicit save/cancel.

---

## 11. Error states need recovery actions

An error state must tell the user what to do next. "Something went wrong" with no action is a dead end. Every error state includes at least one of: a retry action, a navigation escape ("Go back", "Return to dashboard"), or contact/support info for non-self-recoverable errors.

```tsx
// Bad
<p className="text-red-500">Something went wrong.</p>

// Good
<div>
  <p className="text-red-500">Could not load your data.</p>
  <button onClick={retry}>Try again</button>
</div>
```

---

## 12. No orphaned loading states

A component that enters a loading state must always exit it — to content or to an error state. A spinner running forever because a fetch silently failed destroys trust.

- All data fetches have a timeout or error boundary.
- Never leave `isLoading: true` as a possible permanent state.
- With SWR, always handle `error` alongside `data`.

```tsx
const { data, error, isLoading } = useSWR('/api/items', fetcher);
if (isLoading) return <ItemsSkeleton />;
if (error) return <ErrorState onRetry={() => mutate('/api/items')} />;
return <ItemsList items={data} />;
```
