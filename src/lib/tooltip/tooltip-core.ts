// Imperative tooltip engine — anchored (default) + cursor-following. Zero deps,
// SSR-safe (lazy-boots on first client attach). Portals to the top layer (Popover
// API where available, z-index fallback) so it is never clipped by an ancestor's
// overflow. Geometry lives in ./solve; this file owns DOM, timing, and a11y.
//
// Prefer the React bindings in ./index (useTooltip / <Tip>). Use this directly
// only for non-React call sites. See the tooltip skill's SKILL.md for the API,
// tuning knobs, and the symptom → cause → fix playbook.

import { solve, solveFollow, classify, type Placement, type Bounds } from './solve';

export interface Pt {
  x: number;
  y: number;
}
export interface TipObj {
  title: string;
  sub?: string;
}
export type TipResolved = string | TipObj | HTMLElement;
export type TipContent = TipResolved | ((e: Pt) => TipResolved);

export interface TipOptions {
  content: TipContent;
  placement?: Placement;
  mode?: 'anchored' | 'follow';
  showDelay?: number;
  hideDelay?: number;
  offset?: number;
  hoverable?: boolean;
  onlyIfTruncated?: boolean;
  boundary?: HTMLElement | null;
  /** Hide the moment the trigger is pressed; don't re-pin from the mouse-focus that follows. */
  hideOnClick?: boolean;
  /**
   * Decorative tip: the trigger already has its own `aria-label`, so mark the bubble
   * `aria-hidden` and skip `aria-describedby` — the screen reader reads the control
   * once, not twice. Default false (link via `aria-describedby`, announcing the tip).
   */
  decorative?: boolean;
  /**
   * Position relative to a different element than the hover trigger. Use when the
   * trigger is a large hit area but the tip should point at a small mark inside it
   * (e.g. hover a tall gutter column, but anchor to the little dot). Getter form so
   * the element is resolved fresh at show time.
   */
  anchor?: () => HTMLElement | null;
  /**
   * For a top/bottom tip, land on the side opposite the cursor: cursor above the
   * anchor → tip below, cursor below → tip above. Keeps the bubble out from under
   * the arriving pointer. Falls back to `placement` when there's no cursor (focus).
   */
  awayFromCursor?: boolean;
}

interface ResolvedOptions {
  content: TipContent;
  placement: Placement;
  mode: 'anchored' | 'follow';
  showDelay: number;
  hideDelay: number;
  offset: number;
  hoverable: boolean;
  onlyIfTruncated: boolean;
  boundary: HTMLElement | null;
  hideOnClick: boolean;
  decorative: boolean;
  anchor: (() => HTMLElement | null) | null;
  awayFromCursor: boolean;
}

export interface ResolveInfo {
  mode: 'anchored' | 'follow';
  pref: string;
  resolved: string;
  collision: string;
  x: number;
  y: number;
}

let PAD = 8;
let GROUP_WINDOW = 400;
// Class applied to the portal container. The layer mounts on <body>. If your
// design tokens live only inside a scoping class (e.g. `.app-scope`) rather than
// at :root, set this to that class so the bubble resolves them. Not needed when the
// tokens (or the bundled tooltip.css --tt-* tokens) are defined at :root.
let LAYER_CLASS = '';

// ---- lazy boot (SSR-safe: no DOM work until first client attach) ----------
let booted = false;
let layer: HTMLElement | null = null;
let canPopover = false;
let layerShown = false;
let reduceMotion = false;
const registry: Tip[] = [];

function boot(): void {
  if (booted || typeof document === 'undefined') return;
  booted = true;
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div');
  el.id = 'tt-layer';
  if (LAYER_CLASS) el.className = LAYER_CLASS;
  canPopover = typeof (el as HTMLElement & { showPopover?: () => void }).showPopover === 'function';
  if (canPopover) el.setAttribute('popover', 'manual');
  (document.body ?? document.documentElement).appendChild(el);
  layer = el;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') registry.forEach((t) => t.dismiss());
  });
  const reflow = (): void => registry.forEach((t) => t.reflow());
  window.addEventListener('scroll', reflow, { passive: true, capture: true });
  window.addEventListener('resize', reflow);
}

function ensureLayerShown(): void {
  if (canPopover && layer && !layerShown) {
    try {
      (layer as HTMLElement & { showPopover: () => void }).showPopover();
      layerShown = true;
    } catch {
      /* already shown / unsupported */
    }
  }
}

const group = { open: 0, lastClose: 0 };
const groupWarm = (): boolean => group.open > 0 || Date.now() - group.lastClose < GROUP_WINDOW;

let reporter: ((info: ResolveInfo) => void) | null = null;
const report = (info: ResolveInfo): void => reporter?.(info);

function boundsOf(el: HTMLElement | null): Bounds {
  const v: Bounds = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (!el) return v;
  const r = el.getBoundingClientRect();
  return {
    left: Math.max(v.left, r.left),
    top: Math.max(v.top, r.top),
    right: Math.min(v.right, r.right),
    bottom: Math.min(v.bottom, r.bottom),
  };
}

let seq = 0;

class Tip {
  private t: HTMLElement;
  private o: ResolvedOptions;
  private el: HTMLElement | null = null;
  private arrow: HTMLElement | null = null;
  private showT: ReturnType<typeof setTimeout> | null = null;
  private hideT: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private open = false;
  private overBubble = false;
  private suppressed = false; // set by hideOnClick until the pointer leaves
  private lastDown = 0; // timestamp of the last pointerdown, to spot mouse-driven focus
  private mouse: Pt = { x: 0, y: 0 };
  private followMove: ((e: PointerEvent) => void) | null = null;
  readonly id: string;

  constructor(target: HTMLElement, opts: TipOptions) {
    this.t = target;
    this.o = {
      content: opts.content,
      placement: opts.placement ?? 'top',
      mode: opts.mode ?? 'anchored',
      showDelay: opts.showDelay ?? 420,
      hideDelay: opts.hideDelay ?? 90,
      offset: opts.offset ?? 12,
      hoverable: opts.hoverable ?? false,
      onlyIfTruncated: opts.onlyIfTruncated ?? false,
      boundary: opts.boundary ?? null,
      hideOnClick: opts.hideOnClick ?? false,
      decorative: opts.decorative ?? false,
      anchor: opts.anchor ?? null,
      awayFromCursor: opts.awayFromCursor ?? false,
    };
    this.id = `tt-${++seq}`;
    this.bind();
  }

  private resolveContent(ev?: Pt): TipResolved {
    const c = this.o.content;
    return typeof c === 'function' ? c(ev ?? this.mouse) : c;
  }

  private fill(el: HTMLElement, c: TipResolved): void {
    Array.from(el.childNodes).forEach((n) => {
      if (n !== this.arrow) el.removeChild(n);
    });
    const frag = document.createDocumentFragment();
    if (c instanceof HTMLElement) {
      frag.appendChild(c);
    } else if (typeof c === 'object') {
      const t = document.createElement('div');
      t.className = 'tt-title';
      t.textContent = c.title;
      frag.appendChild(t);
      if (c.sub) {
        const s = document.createElement('div');
        s.className = 'tt-sub';
        s.textContent = c.sub;
        frag.appendChild(s);
      }
    } else {
      frag.appendChild(document.createTextNode(c));
    }
    el.insertBefore(frag, this.arrow ?? null);
  }

  private build(ev?: Pt): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tt' + (this.o.hoverable && this.o.mode === 'anchored' ? ' tt-hoverable' : '');
    el.setAttribute('role', 'tooltip');
    if (this.o.decorative) el.setAttribute('aria-hidden', 'true');
    el.id = this.id;
    if (this.o.mode === 'anchored') {
      const arrow = document.createElement('div');
      arrow.className = 'tt-arrow';
      el.appendChild(arrow);
      this.arrow = arrow;
    }
    this.fill(el, this.resolveContent(ev));
    if (this.o.hoverable && this.o.mode === 'anchored') {
      el.addEventListener('pointerenter', () => {
        this.overBubble = true;
        this.clearHide();
      });
      el.addEventListener('pointerleave', () => {
        this.overBubble = false;
        this.scheduleHide();
      });
    }
    return el;
  }

  private place(): void {
    if (!this.el) return;
    let w = this.el.offsetWidth;
    let h = this.el.offsetHeight;
    const off = this.o.offset;

    if (this.o.mode === 'follow') {
      if (typeof this.o.content === 'function') {
        this.fill(this.el, this.resolveContent());
        w = this.el.offsetWidth;
        h = this.el.offsetHeight;
      }
      const sol = solveFollow(
        this.mouse.x,
        this.mouse.y,
        w,
        h,
        off,
        window.innerWidth,
        window.innerHeight,
        PAD
      );
      this.el.style.left = `${sol.x}px`;
      this.el.style.top = `${sol.y}px`;
      report({
        mode: 'follow',
        pref: 'cursor',
        resolved: sol.flipped ? 'flipped' : 'bottom',
        collision: sol.flipped ? 'flip' : 'none',
        x: Math.round(this.mouse.x),
        y: Math.round(this.mouse.y),
      });
      return;
    }

    // Position relative to the anchor element if given, else the trigger itself.
    const anchorEl = this.o.anchor?.() ?? null;
    const a = anchorEl ? anchorEl.getBoundingClientRect() : this.t.getBoundingClientRect();
    // Cursor-aware: for a vertical tip, land on the side opposite the pointer.
    let pref = this.o.placement;
    if (this.o.awayFromCursor && (pref === 'top' || pref === 'bottom')) {
      pref = this.mouse.y < a.top + a.height / 2 ? 'bottom' : 'top';
    }
    const sol = solve(a, w, h, pref, off, boundsOf(this.o.boundary), PAD);
    this.el.style.left = `${sol.x}px`;
    this.el.style.top = `${sol.y}px`;
    this.placeArrow(sol.placement, sol.x, sol.y, a, w, h);
    report({
      mode: 'anchored',
      pref,
      resolved: sol.placement,
      collision: classify(pref, sol.placement, sol.shifted),
      x: Math.round(a.left + a.width / 2),
      y: Math.round(a.top + a.height / 2),
    });
  }

  private placeArrow(p: Placement, x: number, y: number, a: DOMRect, w: number, h: number): void {
    if (!this.arrow) return;
    const arw = 8;
    const acx = a.left + a.width / 2;
    const acy = a.top + a.height / 2;
    const s = this.arrow.style;
    s.left = s.top = s.right = s.bottom = s.transform = '';
    if (p === 'top' || p === 'bottom') {
      s.left = `${Math.min(Math.max(acx - x, 11), w - 11) - arw / 2}px`;
      if (p === 'top') {
        s.bottom = `${-arw / 2}px`;
        s.transform = 'rotate(45deg)';
      } else {
        s.top = `${-arw / 2}px`;
        s.transform = 'rotate(225deg)';
      }
    } else {
      s.top = `${Math.min(Math.max(acy - y, 11), h - 11) - arw / 2}px`;
      if (p === 'left') {
        s.right = `${-arw / 2}px`;
        s.transform = 'rotate(-45deg)';
      } else {
        s.left = `${-arw / 2}px`;
        s.transform = 'rotate(135deg)';
      }
    }
  }

  private show(ev?: Pt): void {
    if (this.open || !booted || !layer) return;
    if (this.o.onlyIfTruncated) {
      // Measure the anchored element (the text) when given, else the trigger.
      const measured = this.o.anchor?.() ?? this.t;
      if (measured.scrollWidth <= measured.clientWidth + 1) return;
    }
    ensureLayerShown();
    const el = this.build(ev);
    el.style.visibility = 'hidden';
    layer.appendChild(el);
    this.el = el;
    this.place();
    el.style.visibility = '';
    if (!this.o.decorative) this.t.setAttribute('aria-describedby', this.id);
    const target = el;
    requestAnimationFrame(() => {
      if (this.el === target) target.classList.add('tt-in');
    });
    this.open = true;
    group.open += 1;
    if (this.o.mode === 'follow') {
      this.followMove = (e: PointerEvent): void => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        if (!this.raf) {
          this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.place();
          });
        }
      };
      window.addEventListener('pointermove', this.followMove, { passive: true });
    }
  }

  private hide(): void {
    if (!this.open) return;
    this.open = false;
    group.open = Math.max(0, group.open - 1);
    group.lastClose = Date.now();
    if (!this.o.decorative) this.t.removeAttribute('aria-describedby');
    if (this.followMove) {
      window.removeEventListener('pointermove', this.followMove);
      this.followMove = null;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    const el = this.el;
    this.el = null;
    this.arrow = null;
    if (!el) return;
    if (reduceMotion) {
      el.remove();
      return;
    }
    el.classList.remove('tt-in');
    setTimeout(() => el.remove(), 160);
  }

  private clearHide(): void {
    if (this.hideT) {
      clearTimeout(this.hideT);
      this.hideT = null;
    }
  }

  private clearShow(): void {
    if (this.showT) {
      clearTimeout(this.showT);
      this.showT = null;
    }
  }

  private scheduleShow(ev?: PointerEvent): void {
    if (this.suppressed) return;
    this.clearHide();
    this.clearShow();
    const pt: Pt = { x: ev ? ev.clientX : 0, y: ev ? ev.clientY : 0 };
    if (ev) this.mouse = { x: ev.clientX, y: ev.clientY };
    const delay = groupWarm() ? 0 : this.o.showDelay;
    this.showT = setTimeout(() => this.show(pt), delay);
  }

  private scheduleHide(): void {
    this.clearShow();
    this.clearHide();
    if (this.overBubble) return;
    this.hideT = setTimeout(() => this.hide(), this.o.hideDelay);
  }

  /**
   * Focus-driven show, gated so a mouse click never pins the tip. A focus that
   * lands right after a pointerdown is mouse-driven (the click's residual focus);
   * a focus with no recent press is keyboard navigation, which should show. This
   * is env-independent — it doesn't rely on `:focus-visible` support.
   */
  private focusShow(): void {
    if (this.o.mode === 'follow') return;
    if (Date.now() - this.lastDown < 300) return; // residual focus from a mouse press
    this.scheduleShow();
  }

  private bind(): void {
    this.t.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this.scheduleShow(e);
    });
    this.t.addEventListener('pointerleave', () => {
      this.suppressed = false;
      this.scheduleHide();
    });
    this.t.addEventListener('pointermove', (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    this.t.addEventListener('pointerdown', () => {
      this.lastDown = Date.now();
      if (this.o.hideOnClick) {
        this.suppressed = true;
        this.clearShow();
        this.hide();
      }
    });
    this.t.addEventListener('focus', () => this.focusShow(), true);
    this.t.addEventListener('blur', () => this.scheduleHide(), true);
  }

  /** Reposition if open — called on scroll/resize. */
  reflow(): void {
    if (this.open && this.o.mode === 'anchored') this.place();
  }

  /** Dismiss immediately (Escape). */
  dismiss(): void {
    this.clearShow();
    this.hide();
  }

  destroy(): void {
    this.clearShow();
    this.clearHide();
    this.hide();
    const i = registry.indexOf(this);
    if (i >= 0) registry.splice(i, 1);
  }
}

export type TipHandle = Pick<Tip, 'destroy' | 'id'>;

/** Attach a tooltip to an element. Returns a handle — call `.destroy()` to remove. */
export function attach(target: HTMLElement, opts: TipOptions): TipHandle {
  boot();
  const t = new Tip(target, opts);
  registry.push(t);
  return t;
}

/** Global tuning. `layerClass` scopes the portal to an app design-token class. */
export function configure({
  padding,
  groupWindow,
  layerClass,
}: {
  padding?: number;
  groupWindow?: number;
  layerClass?: string;
}): void {
  if (padding != null) PAD = padding;
  if (groupWindow != null) GROUP_WINDOW = groupWindow;
  if (layerClass != null) {
    LAYER_CLASS = layerClass;
    if (layer) layer.className = layerClass;
  }
}

/** Debug hook — fires on every placement with what the pipeline decided. */
export function onResolve(fn: ((info: ResolveInfo) => void) | null): void {
  reporter = fn;
}
