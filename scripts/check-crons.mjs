#!/usr/bin/env node
/**
 * Pre-push guard: reject a `vercel.json` cron that fires more than once a day.
 *
 * Vercel Hobby allows daily crons only, and it enforces that when a deployment is
 * CREATED — `cron_jobs_limits_reached`, HTTP 400. That means no deployment record
 * exists at all: the push succeeds, the dashboard shows nothing new, and production
 * silently stays on the previous build. It has stranded this repo's prod twice
 * (47619d0 health-poll, 3b8709c triage-errors), both times found only by someone
 * wondering why a deploy never appeared.
 *
 * The guard is the cheap half of that lesson. It knows nothing about plans — it just
 * refuses a schedule that can fire twice in one day, which is the only thing Hobby
 * rejects. On Pro, delete this hook rather than loosening the rule.
 */
import { readFileSync } from 'node:fs';

/**
 * True when `schedule` can fire more than once per day.
 *
 * A 5-field cron fires once daily only when BOTH minute and hour name a single
 * concrete value. Any `*`, step, list or range in those two fields multiplies the
 * daily count. The day/month/weekday fields can only make it rarer, so they're not
 * this guard's business.
 */
export function firesMoreThanDaily(schedule) {
  const fields = String(schedule).trim().split(/\s+/);
  if (fields.length !== 5) return true; // unparseable → refuse rather than guess
  const [minute, hour] = fields;
  const single = (f) => /^\d+$/.test(f);
  return !(single(minute) && single(hour));
}

export function violations(crons) {
  return (crons ?? [])
    .filter((c) => firesMoreThanDaily(c?.schedule))
    .map((c) => `${c.path ?? '(no path)'} — "${c.schedule}"`);
}

// --- CLI ---------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? 'vercel.json';
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    // No vercel.json (or unreadable) → nothing to guard. Not every repo has one.
    if (err.code === 'ENOENT') process.exit(0);
    console.error(`check-crons: could not read ${path}: ${err.message}`);
    process.exit(1);
  }

  const bad = violations(config.crons);
  if (bad.length > 0) {
    console.error('check-crons: BLOCKED — Vercel Hobby allows daily crons only.\n');
    for (const line of bad) console.error(`  ${line}`);
    console.error(
      '\nThese schedules make Vercel refuse to CREATE the deployment' +
        ' (cron_jobs_limits_reached),\nso the push would succeed while production' +
        ' silently stays on the previous build.\nGive each one a concrete minute and' +
        ' hour (e.g. "45 6 * * *"), or upgrade to Pro.'
    );
    process.exit(1);
  }
}
