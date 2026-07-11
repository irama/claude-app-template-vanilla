import * as Sentry from '@sentry/nextjs';

// No-ops when NEXT_PUBLIC_SENTRY_DSN is unset (local dev).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
