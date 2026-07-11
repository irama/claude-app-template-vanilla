import * as Sentry from '@sentry/nextjs';

// No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (local dev).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.VERCEL_ENV ?? 'development',
  tracesSampleRate: 0.1,
});
