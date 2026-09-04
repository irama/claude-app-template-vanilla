'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { ErrorDetail } from '@/components/error-detail';

export default function Error({
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
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-gray-600">
        The error has been reported.{error.digest ? ` Reference: ${error.digest}` : ''}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded bg-black px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
      {/* Wire isAdmin to the app's admin flag once auth exists */}
      <ErrorDetail error={error} isAdmin={false} />
    </main>
  );
}
