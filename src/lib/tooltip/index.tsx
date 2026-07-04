'use client';

// React bindings for the tooltip engine. Import the styles once (tooltip.css).
// SSR-safe: the engine lazy-boots on the client; nothing touches the DOM during
// server render. See SKILL.md for the full API + debug playbook.
//
//   import '@/lib/tooltip/tooltip.css';           // once, in the root layout
//   <Tip content="Archive"><button aria-label="Archive">🗄</button></Tip>
//
//   const ref = useTooltip<HTMLCanvasElement>({ mode: 'follow', content: (e) => readAt(e.x) });
//   <canvas ref={ref} role="img" aria-label="…accessible alternative…" />
//
// The bundled tooltip.css defines its --tt-* tokens at :root, so the body-mounted
// portal resolves them with no extra wiring. Only if your design tokens live inside
// a scoping class do you need `configure({ layerClass: 'your-scope' })` once.

import { cloneElement, isValidElement, useEffect, useRef } from 'react';
import type { MutableRefObject, ReactElement, Ref } from 'react';

import { attach, type Pt, type TipObj } from './tooltip-core';
import type { Placement } from './solve';

export type { Placement } from './solve';
export type { TipObj, Pt } from './tooltip-core';
export { configure, onResolve } from './tooltip-core';

export type TipData = string | TipObj;
export type TipContent = TipData | ((e: Pt) => TipData);

export interface UseTooltipOptions {
  content: TipContent;
  /** Preferred side. Fallback (shift → flip → re-anchor) is automatic. Default 'top'. */
  placement?: Placement;
  /** 'anchored' pins to the element (default); 'follow' tracks the cursor. */
  mode?: 'anchored' | 'follow';
  showDelay?: number;
  hideDelay?: number;
  offset?: number;
  /** Let the pointer enter the tip and keep it open (WCAG 1.4.13). */
  hoverable?: boolean;
  /** Show only when the target's text is actually clipped. */
  onlyIfTruncated?: boolean;
  /** Keep the tip inside this element (modal/scroll panel) instead of the viewport. */
  boundary?: HTMLElement | null;
  /** Hide the moment the trigger is pressed; don't re-pin from mouse focus. */
  hideOnClick?: boolean;
  /** Trigger already has an aria-label — mark the tip aria-hidden, skip aria-describedby. */
  decorative?: boolean;
  /** Position relative to a different element than the hover trigger (resolved at show time). */
  anchor?: () => HTMLElement | null;
  /** For a top/bottom tip, land on the side opposite the cursor. */
  awayFromCursor?: boolean;
}

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return (node) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === 'function') r(node);
      else (r as MutableRefObject<T | null>).current = node;
    }
  };
}

/**
 * Attach a tooltip to an element you hold a ref to. Content stays reactive — it is
 * read afresh each time the tip shows (per-frame in follow mode).
 */
export function useTooltip<T extends HTMLElement = HTMLElement>(opts: UseTooltipOptions): Ref<T> {
  const ref = useRef<T>(null);
  const optsRef = useRef(opts);
  // Keep the latest opts reachable by the engine's content/anchor callbacks (read
  // at show/frame time) without re-attaching. Updated in an effect, not in render.
  useEffect(() => {
    optsRef.current = opts;
  });

  const {
    mode,
    placement,
    hoverable,
    offset,
    showDelay,
    hideDelay,
    onlyIfTruncated,
    boundary,
    hideOnClick,
    decorative,
    awayFromCursor,
  } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = attach(el, {
      placement,
      mode,
      showDelay,
      hideDelay,
      offset,
      hoverable,
      onlyIfTruncated,
      boundary,
      hideOnClick,
      decorative,
      awayFromCursor,
      // Resolve the anchor fresh at show time via the live ref (no re-attach on change).
      anchor: () => optsRef.current.anchor?.() ?? null,
      // Wrap content as a function so the latest value is read at show/frame time.
      content: (e: Pt) => {
        const c = optsRef.current.content;
        return typeof c === 'function' ? c(e) : c;
      },
    });
    return () => handle.destroy();
    // Re-attach only on structural change; content + anchor flow live through optsRef.
  }, [
    mode,
    placement,
    hoverable,
    offset,
    showDelay,
    hideDelay,
    onlyIfTruncated,
    boundary,
    hideOnClick,
    decorative,
    awayFromCursor,
  ]);

  return ref;
}

/** Wrap a single element child. For your own ref or non-DOM triggers, use useTooltip. */
export function Tip({
  children,
  ...opts
}: UseTooltipOptions & { children: ReactElement }): ReactElement {
  const ref = useTooltip(opts);
  if (!isValidElement(children)) throw new Error('<Tip> expects a single element child.');
  const childRef = (children as ReactElement & { ref?: Ref<HTMLElement> }).ref;
  return cloneElement(children as ReactElement<{ ref?: Ref<HTMLElement> }>, {
    ref: mergeRefs(childRef, ref),
  });
}
