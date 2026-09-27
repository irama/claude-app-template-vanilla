#!/usr/bin/env node
/**
 * Pre-push guard: reject a migration that creates a SECURITY DEFINER function and then
 * revokes it from public/anon/authenticated without wrapping both in one transaction.
 *
 * Postgres grants EXECUTE on a NEW function to PUBLIC. Applied the documented way — a bare
 * `psql -f`, which autocommits each statement — there is a window between the CREATE and the
 * REVOKEs where anon can call the function. A definer function bypasses RLS, so for those
 * milliseconds the lockdown the migration is *about* is not in force.
 *
 * It is not theoretical. status.peakstate.global's `backup_registry()` is SECURITY DEFINER and
 * returns every fleet project's decrypted service_role key; the window was open on each apply
 * until 2026-09-25, and no test caught it — a second-model code review did. A fleet audit the
 * same day found 21 more functions across books, wealth, astrolabe and the hub with a live
 * window, none of them touching secrets.
 *
 *   node scripts/check-migration-definer-txn.mjs --changed [--rev <sha>]
 *   node scripts/check-migration-definer-txn.mjs <file.sql> [more.sql ...]
 *
 * `--changed` selects the migrations this push adds or edits, against origin/main (or
 * origin/master), and reads each one out of the commit being pushed rather than the working
 * tree — an uncommitted edit must not vouch for a committed migration. Only changed files are
 * checked: the pre-existing offenders are a hygiene backlog, not a reason to wedge every
 * repo's next push, and this guard exists to stop new ones.
 *
 * The selection lives HERE rather than in ci-gate.sh on purpose. Three rounds of review
 * defects landed in the shell version of it — NUL bytes eaten by command substitution, then
 * a `</dev/null` that starved the pipe — each one making the guard a silent no-op, which is
 * the worst failure a guard has. In here it is covered by the suite next door.
 *
 * A repo whose apply path already wraps every migration in a transaction does not have this
 * window, and is exempted by a `.definer-txn-exempt` file beside its migrations holding the
 * reason. The marker is read from the revision being pushed, so an untracked one cannot
 * turn the gate off. books.peakstate.global is the one such repo today: scripts/db/apply-migration.mjs
 * runs `begin; <migration> <tracking row> commit;`. The reason is printed on every gate run,
 * because a silent security opt-out is the kind that outlives the thing that justified it.
 *
 * No migrations changed → exit 0. A file with no definer function, or one with no revoke (it
 * was meant to be callable), is not this bug and passes.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DEFINER = /security\s+definer/i;
const BEGIN = /^\s*begin\s*;/im;
const COMMIT = /^\s*commit\s*;/im;
/** A revoke that takes EXECUTE away from a role anyone can reach. */
const REVOKE_LOCK =
  /revoke\s+(?:all|execute)[^;]*?\bfrom\b[^;]*?\b(?:public|anon|authenticated)\b/i;
const CREATE_FN = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)/gi;
const DOLLAR_TAG = /^\$([a-zA-Z_][a-zA-Z_0-9]*)?\$/;

/** Where a repo declares that its apply path already wraps migrations. */
export const EXEMPT_FILES = [
  'data/supabase/migrations/.definer-txn-exempt',
  'supabase/migrations/.definer-txn-exempt',
];

/**
 * The reason this repo is exempt, or null. Takes a reader so the suite can drive it without
 * touching disk. A file present but empty is NOT an exemption: the reason is the point, and
 * an unexplained opt-out is exactly what this would otherwise become.
 */
export function exemptReason(read) {
  for (const f of EXEMPT_FILES) {
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    const reason = String(text).trim();
    if (reason) return reason;
  }
  return null;
}

/**
 * SQL with comments, string literals (plain and E-escaped) and dollar-quoted bodies
 * blanked out.
 *
 * One left-to-right pass, not a chain of regexes. Chained regexes cannot tell a `$$` inside a
 * comment from the one that opens a body, so `-- body uses $$ quoting` above a function would
 * pair with the real opening tag and delete the CREATE ... SECURITY DEFINER between them,
 * turning an unsafe migration into a clean bill of health. Scanning in order is the only way
 * to know which construct actually started first.
 */
export function stripNoise(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);

    if (rest.startsWith('--')) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (rest.startsWith('/*')) {
      const close = sql.indexOf('*/', i + 2);
      i = close === -1 ? sql.length : close + 2;
      out += ' ';
      continue;
    }
    // An E-prefixed literal treats a backslash as an escape, so E'can\\'t' does NOT end at
    // that quote. Reading it as if it did would close the string early, and the real closing
    // quote would open an unterminated one that swallows the CREATE and the REVOKE after it.
    const escaped = /^[Ee]'/.test(rest);
    if (sql[i] === "'" || escaped) {
      let j = i + (escaped ? 2 : 1);
      while (j < sql.length) {
        if (escaped && sql[j] === '\\') {
          j += 2; // backslash escapes whatever follows, quote included
        } else if (sql[j] !== "'") {
          j += 1;
        } else if (sql[j + 1] === "'") {
          j += 2; // '' is an escaped quote in any literal, not the end
        } else {
          j += 1;
          break;
        }
      }
      i = j;
      out += "''";
      continue;
    }
    const tag = DOLLAR_TAG.exec(rest)?.[0];
    if (tag) {
      const close = sql.indexOf(tag, i + tag.length);
      i = close === -1 ? sql.length : close + tag.length;
      out += '$$';
      continue;
    }

    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * The definer functions this SQL locks down outside a transaction. Empty array = fine.
 *
 * Whole-file granularity on purpose. A migration that opens a transaction anywhere and closes
 * it is following the rule; one that never does is not, whichever statement you look at. The
 * precision this trades away is not worth a SQL parser in a pre-push hook.
 */
export function unwrappedDefiners(rawSql) {
  const sql = stripNoise(rawSql);
  if (!DEFINER.test(sql)) return [];
  if (!REVOKE_LOCK.test(sql)) return []; // meant to be callable — not this bug
  if (BEGIN.test(sql) && COMMIT.test(sql)) return [];
  // Each function's declaration runs to the next CREATE FUNCTION, or to the end of the file.
  // That is enough to tell which of several functions in one migration are definer.
  const creates = [...sql.matchAll(CREATE_FN)];
  const names = creates
    .filter((m, i) => DEFINER.test(sql.slice(m.index, creates[i + 1]?.index ?? sql.length)))
    .map((m) => m[1].replace(/"/g, ''));
  return [...new Set(names)];
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** The first of origin/main, origin/master that exists here, or null in a repo with neither. */
export function baseRef(resolve) {
  for (const ref of ['origin/main', 'origin/master']) {
    try {
      resolve(ref);
      return ref;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Migration paths added or edited between `base` and `rev`. */
export function changedMigrations(base, rev, run = git) {
  const out = run([
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=d',
    `${base}...${rev}`,
    '--',
    '*migrations/*.sql',
  ]);
  return out.split('\0').filter(Boolean);
}

// --- CLI ---------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2).filter(Boolean);
  const revAt = argv.indexOf('--rev');
  const rev = revAt === -1 ? 'HEAD' : argv[revAt + 1];
  const changed = argv.includes('--changed');

  // From the pushed revision in changed mode, exactly like the migrations. Reading the
  // working tree instead would let an untracked marker - and this one is a dotfile, so it
  // can sit in a checkout unnoticed - turn the gate off for a revision that never had one.
  const exempt = exemptReason((f) =>
    changed ? git(['show', `${rev}:${f}`]) : readFileSync(f, 'utf8')
  );
  if (exempt) {
    console.log(`check-migration-definer-txn: skipped — ${exempt}`);
    process.exit(0);
  }

  let files;
  if (changed) {
    const base = baseRef((ref) => git(['rev-parse', '--verify', ref]));
    if (!base) process.exit(0); // no remote default branch to diff against
    files = changedMigrations(base, rev);
  } else {
    files = argv.filter((a, i) => a !== '--changed' && i !== revAt && i !== revAt + 1);
  }
  if (files.length === 0) process.exit(0);

  const bad = [];
  for (const path of files) {
    let sql;
    try {
      // From the commit being pushed, never the working tree.
      sql = changed ? git(['show', `${rev}:${path}`]) : readFileSync(path, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || changed) continue; // gone in this push — nothing to guard
      console.error(`check-migration-definer-txn: could not read ${path}: ${err.message}`);
      process.exit(1);
    }
    const fns = unwrappedDefiners(sql);
    if (fns.length > 0) bad.push({ path, fns });
  }

  if (bad.length > 0) {
    console.error(
      'check-migration-definer-txn: BLOCKED — a definer function is exposed to PUBLIC' +
        ' while it is created.\n'
    );
    for (const { path, fns } of bad) console.error(`  ${path}\n      ${fns.join(', ')}`);
    console.error(
      '\nPostgres grants EXECUTE on a NEW function to PUBLIC, and a bare `psql -f`' +
        ' autocommits\neach statement, so anon can call these between the CREATE and the' +
        ' REVOKEs.\nPut `begin;` before the create and `commit;` after the last grant.' +
        '\nA `drop function` + `create function` must sit inside that same transaction,' +
        '\nbecause the drop removes the grants too.'
    );
    process.exit(1);
  }
}
