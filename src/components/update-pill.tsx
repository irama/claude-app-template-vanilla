'use client';

// "new version · reload": shows when the server serves a different commit from
// the bundle in this tab. A tab left open across a deploy keeps running the old
// shell (a single-page app rarely navigates, so the browser never re-checks its
// service worker either); this tells the user and gives them one click.

import { useEffect, useState } from 'react';

/** Commit baked into THIS bundle at build time (next.config.ts → env). */
const CLIENT_SHA = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev';
const POLL_MS = 10 * 60 * 1000;
const HEX_SHA = /^[0-9a-f]{7,40}$/i;

/**
 * True only when BOTH sides name a real commit and they differ. A dev build or
 * a health route that could not read its commit must never nag. Compared by
 * prefix, because bundles usually carry a 7-char SHA and health the full 40.
 */
export function isStale(client: string, server: string | null | undefined): boolean {
  if (!server || !HEX_SHA.test(client) || !HEX_SHA.test(server)) return false;
  const a = client.toLowerCase();
  const b = server.toLowerCase();
  return !(a.startsWith(b) || b.startsWith(a));
}

/**
 * Hand a waiting service worker the go-ahead, then reload. The reload does not
 * depend on the handshake; it exists so a superseded worker is not left in
 * control. `update()` resolves once the new worker starts INSTALLING, so take
 * `installing` too and post when it reaches 'installed'. Never strand the
 * button on a worker that refuses to swap: 2.5s and reload regardless.
 */
export async function reloadToLatest(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const next = reg?.waiting ?? reg?.installing ?? null;
    if (next) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
        const post = () => next.postMessage({ type: 'SKIP_WAITING' });
        if (next.state === 'installed') post();
        else next.addEventListener('statechange', () => next.state === 'installed' && post());
        setTimeout(done, 2500);
      });
    }
  } catch {
    // A refused or absent registration must not block the reload.
  }
  window.location.reload();
}

export function UpdatePill() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/health', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ sha?: string }>) : null))
        .then((d) => {
          // Sticky: once stale, stay stale until the reload.
          if (alive && isStale(CLIENT_SHA, d?.sha)) setStale(true);
        })
        .catch(() => {});
    };
    check();
    const id = window.setInterval(check, POLL_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // The live region is always mounted so the pill's arrival is announced.
  // It is a status, not a dialog: it takes no focus.
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 print:hidden">
      {stale && (
        <button
          type="button"
          onClick={() => void reloadToLatest()}
          className="h-7 cursor-pointer rounded border border-gray-300 bg-white px-2.5 text-xs font-medium tracking-wide text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transition-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          new version · reload
        </button>
      )}
    </div>
  );
}
