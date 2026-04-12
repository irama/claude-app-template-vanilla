# Accessibility & Responsive Design

These are mandatory quality gates — not aspirational guidelines. Complete each checklist before marking any UI task done.

---

## 1. Mobile-first layout

Build mobile-first: base Tailwind classes apply at all sizes; `md:` and `lg:` prefixes add layout for larger screens only. Never design desktop-first and then try to shrink.

**Checklist — before marking any UI task complete:**

- [ ] Renders correctly at **375px width** (iPhone SE — most constrained common viewport)
- [ ] Stacked vertically on mobile; row/grid layout at `md:` and above
- [ ] No horizontal overflow — nothing extends past the viewport edge (check `overflow-x` in dev tools)
- [ ] Touch targets: all interactive elements are at minimum **44×44px** (`min-h-[44px]` or `p-3` on small icons)
- [ ] Text is readable without zooming — effective minimum ~14px

```tsx
// Bad: desktop-first, mobile is an afterthought
<div className="flex gap-4 sm:flex-col">

// Good: mobile-first, desktop is the enhancement
<div className="flex flex-col gap-4 md:flex-row">
```

---

## 2. Light and dark mode

Every color class must work in both modes. Use Tailwind dark mode pairs consistently:

```tsx
// Text
className = 'text-slate-900 dark:text-slate-100';

// Backgrounds
className = 'bg-white dark:bg-slate-900';

// Borders
className = 'border-slate-200 dark:border-slate-700';

// Muted/secondary text
className = 'text-slate-500 dark:text-slate-400';
```

**WCAG AA contrast requirements:**

| Text type                                    | Minimum ratio |
| -------------------------------------------- | ------------- |
| Normal text (<18px regular / <14px bold)     | **4.5 : 1**   |
| Large text (≥18px regular / ≥14px bold)      | **3 : 1**     |
| UI components (buttons, inputs, focus rings) | **3 : 1**     |

Never rely on color alone to convey information — pair color with a text label, icon, or pattern.

**Checklist — before marking any UI task complete that introduces color:**

- [ ] Viewed in **both dark and light mode**
- [ ] Body text passes 4.5:1 contrast against its background in both modes
- [ ] Secondary/muted text, placeholder text, and disabled states checked — these commonly fail
- [ ] No information conveyed by color alone (error states have icons/labels; status badges have text)

---

## 3. Keyboard navigation

**Use semantic HTML — always:**

```tsx
// Wrong — invisible to keyboard and assistive tech
<div onClick={handleClick} className="cursor-pointer">Click me</div>

// Right
<button onClick={handleClick}>Click me</button>
<a href="/path">Navigate</a>
```

Rules:

- `<button>` for actions that don't navigate
- `<a href>` for navigation (including Next.js `<Link>`)
- Native `<input>` / `<select>` / `<textarea>` for form fields — never fake them with `div`
- Heading hierarchy: `h1` → `h2` → `h3` in document order, no level skipping

**Focus visibility — never suppress without replacement:**

```tsx
// Bug — removes focus ring with nothing to replace it
className = 'focus:outline-none';

// Correct — removes browser default, provides explicit ring
className = 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';
```

Focus rings must be visible against both light and dark backgrounds. Tab order must follow visual reading order.

**ARIA labelling:**

- Icon-only buttons and links: `<button aria-label="Close dialog">`
- Images: `alt="descriptive text"` (use `alt=""` for purely decorative images — never omit `alt`)
- Modals/sheets/drawers: focus must be trapped inside while open; returned to the trigger element on close

**Checklist — before marking any UI task complete:**

- [ ] Tab through all interactive elements — every one is reachable by keyboard
- [ ] Tab order matches visual/logical reading order
- [ ] All interactive elements show a visible focus ring
- [ ] All icon-only buttons have `aria-label`
- [ ] All images have `alt` attributes

---

## 4. When to apply these checks

| Task type                                   | Mobile | Dark/light | Keyboard |
| ------------------------------------------- | ------ | ---------- | -------- |
| New page or route                           | ✓      | ✓          | ✓        |
| New component added to a page               | ✓      | ✓          | ✓        |
| Colour or styling changes                   |        | ✓          |          |
| New interactive element (button, form, etc) |        |            | ✓        |
| Layout change                               | ✓      |            |          |
