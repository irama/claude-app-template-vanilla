'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', textAlign: 'center', padding: '4rem 1rem' }}>
        <h1>Something went wrong</h1>
        <p>The error has been reported.{error.digest ? ` Reference: ${error.digest}` : ''}</p>
        <button type="button" onClick={reset} style={{ cursor: 'pointer', padding: '0.5rem 1rem' }}>
          Try again
        </button>
      </body>
    </html>
  );
}
