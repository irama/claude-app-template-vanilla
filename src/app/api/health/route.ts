// If this app adds auth middleware, exclude /api/health from its matcher —
// behind auth it 307s to /login and external uptime monitors can't reach it
// (same failure class as a service worker wedged behind the matcher).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    time: new Date().toISOString(),
  });
}
