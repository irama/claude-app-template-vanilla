// Pure tooltip-placement geometry. No DOM, no `window` — feed it rects, get back
// coordinates. This is the collision pipeline (offset → shift → flip → re-anchor)
// isolated so it can be unit-tested exhaustively and reused by the imperative
// engine in `tooltip-core.ts`. See docs/ui-patterns.md → Tooltip.

export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** How the pipeline resolved a placement, for telemetry/debugging. */
export type Collision = 'none' | 'shift' | 'flip' | 'flip + shift' | 're-anchor';

/** A `getBoundingClientRect`-shaped anchor (viewport coordinates). */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** The clipping rectangle a tip must stay inside (viewport, or a boundary ∩ viewport). */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Solution {
  x: number;
  y: number;
  placement: Placement;
  /** px the tip was slid along the cross-axis to stay on-screen. */
  shifted: number;
  /** px the tip still overflows the bounds on its main axis (0 = fits). */
  overflow: number;
}

const OPP: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};
const AXIS: Record<Placement, 'x' | 'y'> = { top: 'y', bottom: 'y', left: 'x', right: 'x' };

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Ordered fallback list: preferred → its opposite → the two perpendiculars. */
export function candidates(pref: Placement): Placement[] {
  const perp: Placement[] = AXIS[pref] === 'y' ? ['right', 'left'] : ['bottom', 'top'];
  return [pref, OPP[pref], perp[0], perp[1]];
}

/** Raw (pre-shift) top-left for a placement, cross-axis centred on the anchor. */
export function rawPos(
  p: Placement,
  a: AnchorRect,
  w: number,
  h: number,
  off: number
): { x: number; y: number } {
  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  if (p === 'top') return { x: cx - w / 2, y: a.top - h - off };
  if (p === 'bottom') return { x: cx - w / 2, y: a.bottom + off };
  if (p === 'left') return { x: a.left - w - off, y: cy - h / 2 };
  return { x: a.right + off, y: cy - h / 2 }; // right
}

/**
 * Resolve an anchored placement against a boundary. Walks the candidate order,
 * shifting each along its cross-axis to fit, and returns the first with no
 * main-axis overflow — else the least-bad one.
 */
export function solve(
  a: AnchorRect,
  w: number,
  h: number,
  pref: Placement,
  off: number,
  b: Bounds,
  pad = 8
): Solution {
  const L = b.left + pad;
  const T = b.top + pad;
  const R = b.right - pad;
  const B = b.bottom - pad;
  let best: Solution | null = null;

  for (const p of candidates(pref)) {
    const r = rawPos(p, a, w, h, off);
    let x = r.x;
    let y = r.y;
    let shifted = 0;
    let overflow = 0;

    if (p === 'top' || p === 'bottom') {
      const nx = clamp(x, L, Math.max(L, R - w));
      shifted = Math.abs(nx - x);
      x = nx;
      overflow = p === 'top' ? Math.max(0, T - y) : Math.max(0, y + h - B);
    } else {
      const ny = clamp(y, T, Math.max(T, B - h));
      shifted = Math.abs(ny - y);
      y = ny;
      overflow = p === 'left' ? Math.max(0, L - x) : Math.max(0, x + w - R);
    }

    const candidate: Solution = { x, y, placement: p, shifted, overflow };
    if (overflow <= 0.5) return candidate; // fits — stop at first
    if (!best || overflow < best.overflow) best = candidate; // else keep least-bad
  }
  // `candidates` is never empty, so `best` is always set by the loop.
  return best as Solution;
}

/** Classify what the pipeline did, relative to the preferred placement. */
export function classify(pref: Placement, chosen: Placement, shifted: number): Collision {
  if (chosen === pref) return shifted > 0.5 ? 'shift' : 'none';
  if (AXIS[chosen] === AXIS[pref]) return shifted > 0.5 ? 'flip + shift' : 'flip';
  return 're-anchor';
}

export interface FollowSolution {
  x: number;
  y: number;
  flipped: boolean;
}

/** Cursor-follow placement: offset to bottom-right of the pointer, flip to stay on-screen. */
export function solveFollow(
  mx: number,
  my: number,
  w: number,
  h: number,
  off: number,
  vw: number,
  vh: number,
  pad = 8
): FollowSolution {
  let x = mx + off;
  let y = my + off;
  let flipped = false;
  if (x + w > vw - pad) {
    x = mx - w - off;
    flipped = true;
  }
  if (y + h > vh - pad) {
    y = my - h - off;
    flipped = true;
  }
  x = clamp(x, pad, Math.max(pad, vw - w - pad));
  y = clamp(y, pad, Math.max(pad, vh - h - pad));
  return { x, y, flipped };
}
