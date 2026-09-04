'use client';

import { useState } from 'react';

/**
 * Admin-only expandable error detail (see production-playbook.md, failure class 2).
 * Normal users see nothing; admins get the full error as copyable JSON to paste
 * straight into a debugging thread. Wire `isAdmin` to the app's own admin flag
 * (e.g. profile.is_platform_admin) — never expose to non-admins.
 */
export function ErrorDetail({
  error,
  isAdmin,
  context,
}: {
  error: unknown;
  isAdmin: boolean;
  context?: Record<string, unknown>;
}) {
  const [copied, setCopied] = useState(false);
  if (!isAdmin) return null;

  const e = error as { message?: string; digest?: string; stack?: string; code?: string };
  const detail = JSON.stringify(
    {
      message: e?.message ?? String(error),
      digest: e?.digest,
      code: e?.code,
      stack: e?.stack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      time: new Date().toISOString(),
      ...context,
    },
    null,
    2
  );

  return (
    <details className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-left text-sm">
      <summary className="font-medium text-red-800">Error detail (admin)</summary>
      <button
        type="button"
        className="mt-2 rounded border border-red-300 bg-white px-2 py-1 text-xs"
        onClick={() => {
          void navigator.clipboard.writeText(detail);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? 'Copied' : 'Copy JSON'}
      </button>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-red-900">
        {detail}
      </pre>
    </details>
  );
}
