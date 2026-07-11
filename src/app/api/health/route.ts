export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    time: new Date().toISOString(),
  });
}
