import { describe, expect, it } from 'vitest';

import {
  candidates,
  classify,
  clamp,
  rawPos,
  solve,
  solveFollow,
  type AnchorRect,
  type Bounds,
} from './solve';

const VIEWPORT: Bounds = { left: 0, top: 0, right: 1000, bottom: 800 };

// a 40×24 anchor centred at (cx, cy)
function anchorAt(cx: number, cy: number, w = 40, h = 24): AnchorRect {
  return {
    left: cx - w / 2,
    top: cy - h / 2,
    right: cx + w / 2,
    bottom: cy + h / 2,
    width: w,
    height: h,
  };
}

const TIP = { w: 120, h: 40 };

describe('clamp', () => {
  it('bounds a value to [lo, hi]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('candidates', () => {
  it('orders preferred → opposite → perpendiculars', () => {
    expect(candidates('top')).toEqual(['top', 'bottom', 'right', 'left']);
    expect(candidates('bottom')).toEqual(['bottom', 'top', 'right', 'left']);
    expect(candidates('left')).toEqual(['left', 'right', 'bottom', 'top']);
    expect(candidates('right')).toEqual(['right', 'left', 'bottom', 'top']);
  });
});

describe('rawPos', () => {
  it('centres on the cross-axis for each side', () => {
    const a = anchorAt(500, 400);
    expect(rawPos('top', a, TIP.w, TIP.h, 12)).toEqual({ x: 500 - 60, y: 388 - 40 - 12 });
    expect(rawPos('bottom', a, TIP.w, TIP.h, 12)).toEqual({ x: 500 - 60, y: 412 + 12 });
    expect(rawPos('left', a, TIP.w, TIP.h, 12)).toEqual({ x: 480 - 120 - 12, y: 400 - 20 });
    expect(rawPos('right', a, TIP.w, TIP.h, 12)).toEqual({ x: 520 + 12, y: 400 - 20 });
  });
});

describe('solve — no collision', () => {
  it('uses the preferred placement with room, no shift', () => {
    const sol = solve(anchorAt(500, 400), TIP.w, TIP.h, 'top', 12, VIEWPORT);
    expect(sol.placement).toBe('top');
    expect(sol.shifted).toBe(0);
    expect(sol.overflow).toBe(0);
    // centred horizontally on the anchor
    expect(sol.x).toBeCloseTo(440, 5);
  });
});

describe('solve — shift before flip', () => {
  it('slides along the cross-axis for a small edge clip, keeping the preferred side', () => {
    // anchor near the left edge: a top tip centred would overflow left, but there's
    // room above — so it must SHIFT right, not flip.
    const sol = solve(anchorAt(30, 400), TIP.w, TIP.h, 'top', 12, VIEWPORT);
    expect(sol.placement).toBe('top'); // did NOT flip
    expect(sol.shifted).toBeGreaterThan(0); // slid right
    expect(sol.x).toBe(8); // clamped to pad
    expect(sol.overflow).toBe(0);
  });
});

describe('solve — flip on genuine collision', () => {
  it('flips to the opposite side when the preferred side has no room', () => {
    // anchor flush to the top edge: no room above → flip below.
    const sol = solve(anchorAt(500, 10), TIP.w, TIP.h, 'top', 12, VIEWPORT);
    expect(sol.placement).toBe('bottom');
    expect(sol.overflow).toBe(0);
    expect(classify('top', sol.placement, sol.shifted)).toContain('flip');
  });

  it('flips left→right at the left edge (still same axis = a flip, not a re-anchor)', () => {
    const sol = solve(anchorAt(20, 400), TIP.w, TIP.h, 'left', 12, VIEWPORT);
    expect(sol.placement).toBe('right');
    expect(classify('left', sol.placement, sol.shifted)).toBe('flip');
    expect(sol.overflow).toBe(0);
  });
});

describe('solve — boundary constrains collisions', () => {
  const box: Bounds = { left: 300, top: 300, right: 700, bottom: 500 };

  it('a left-placed tip that fits the viewport still flips inside a tight boundary', () => {
    // anchor at the boundary's left edge: viewport has room to the left, but the
    // BOUNDARY does not → must flip to the right, inside the box.
    const a = anchorAt(300, 400);
    const viewportSol = solve(a, TIP.w, TIP.h, 'left', 12, VIEWPORT);
    expect(viewportSol.placement).toBe('left'); // no boundary → stays left

    const boxSol = solve(a, TIP.w, TIP.h, 'left', 12, box);
    expect(boxSol.placement).toBe('right'); // boundary → flips inside
    expect(boxSol.x).toBeGreaterThanOrEqual(box.left);
  });
});

describe('solve — least-bad fallback', () => {
  it('returns the lowest-overflow candidate when nothing fits', () => {
    // boundary smaller than the tip on every side → all candidates overflow;
    // solve must still return a placement (the least-bad), never null.
    const tiny: Bounds = { left: 490, top: 390, right: 510, bottom: 410 };
    const sol = solve(anchorAt(500, 400), TIP.w, TIP.h, 'top', 12, tiny);
    expect(sol.placement).toBeDefined();
    expect(sol.overflow).toBeGreaterThan(0);
  });
});

describe('classify', () => {
  it('names each pipeline outcome', () => {
    expect(classify('top', 'top', 0)).toBe('none');
    expect(classify('top', 'top', 5)).toBe('shift');
    expect(classify('top', 'bottom', 0)).toBe('flip');
    expect(classify('top', 'bottom', 5)).toBe('flip + shift');
    expect(classify('top', 'left', 0)).toBe('re-anchor');
  });
});

describe('solveFollow', () => {
  it('offsets to the bottom-right of the cursor when there is room', () => {
    const sol = solveFollow(200, 200, TIP.w, TIP.h, 16, 1000, 800);
    expect(sol.x).toBe(216);
    expect(sol.y).toBe(216);
    expect(sol.flipped).toBe(false);
  });

  it('flips left/up near the right/bottom edge', () => {
    const sol = solveFollow(980, 780, TIP.w, TIP.h, 16, 1000, 800);
    expect(sol.flipped).toBe(true);
    expect(sol.x).toBeLessThan(980);
    expect(sol.y).toBeLessThan(780);
    // stays within padding
    expect(sol.x).toBeGreaterThanOrEqual(8);
    expect(sol.y).toBeGreaterThanOrEqual(8);
  });
});
