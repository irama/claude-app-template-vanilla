#!/usr/bin/env bash
#
# Local pre-push gate + attestation (plan "c"). ONE versioned script, identical across the
# fleet, so "gate passed" means the same commands everywhere (Codex plan-review: a per-repo
# inlined snippet would drift). Bump GATE_VERSION whenever the gate command-set changes.
#
# Flow, in this order deliberately:
#   1. Read the pushed ref/SHA from stdin (git pre-push protocol) — not from the current
#      branch, so HEAD:main / multi-ref / tag / delete pushes are handled honestly.
#   2. Run the gate (typecheck + lint + tests) with NO secret anywhere in the environment,
#      so a compromised dependency in a repo-controlled test command cannot exfiltrate the
#      attestation secret (Codex).
#   3. Only AFTER the gate, source the secret and BEST-EFFORT POST the result to the hub
#      (3s timeout, fail-open). Telemetry must never block a push — the GATE blocks on
#      failure, the REPORT never does.
#   4. Exit non-zero iff the gate failed (blocks the push).
#
# The attestation says only "the local gate passed/failed for SHA x" — never "x was pushed".
# The hub reads GitHub's real main HEAD + Vercel's deployed SHA as the other two facts.
set -uo pipefail

GATE_VERSION="7"
HUB_URL="${GATE_REPORT_URL:-https://status.peakstate.global/api/gate-report}"
SECRET_FILE="${GATE_REPORT_ENV:-$HOME/.config/peakstate/gate-report.env}"

# owner/name from the origin remote — keeps this script identical in every repo.
origin="$(git remote get-url origin 2>/dev/null || true)"
REPO="$(printf '%s' "$origin" | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##')"

# --- 0. --attest: re-gate the current HEAD by hand ---
# The hub reports a repo as "unattested" whenever main's HEAD carries no gate result: a fleet
# fan-out that pushed from another checkout, a dirty tree, a bypassed hook. Before this flag
# the only way to clear that was to wait for the next ordinary push, so the amber outlived
# the thread that could act on it and became wallpaper.
#
# This is NOT a stand-down and it cannot be used as one. It runs the SAME gate against the
# SAME tree and posts whatever the gate actually says — a broken HEAD goes from "unattested"
# to "gate FAILED on main", which is louder, not quieter. Every honesty rule below still
# applies: a dirty tree refuses to attest, exactly as it does on a push.
#
# `--attest <sha>` takes the commit you MEANT to gate and refuses if HEAD is not it. Without
# that argument the command is a gesture: run it from a feature worktree, a locally-advanced
# main or a stale checkout and it spends a full gate on some other commit, reports THAT, and
# the tile you were trying to clear does not move — while the new row may now speak for an
# unrelated branch. The hub prints the SHA into the command for exactly this reason. The bare
# form still works for "gate whatever I am on", which is the deliberate, local case.
attest_by_hand=0
attest_want=""
if [ "${1:-}" = "--attest" ]; then
  attest_by_hand=1
  attest_want="${2:-}"
  echo "ci-gate: --attest — gating HEAD and reporting it, no push"
fi

# --- 1. pushed ref/SHA from stdin ---
# Three outcomes, and the difference between them is the whole point of this block:
#   * a real ref  → gate it, attest it;
#   * ONLY deletions → exit 0 now: nothing is being pushed, so there is nothing to gate;
#   * no ref list at all (a human running this by hand) → gate, but do NOT attest.
ZERO="0000000000000000000000000000000000000000"
sha=""; branch=""; saw_ref=0; saw_real_ref=0
# --attest has no stdin ref list by definition. Reading anyway would block on a terminal, so
# the loop is skipped and HEAD stands in for the pushed ref below.
[ "$attest_by_hand" = "1" ] && saw_ref=1 && saw_real_ref=1
[ "$attest_by_hand" = "1" ] || while read -r _local_ref local_sha remote_ref _remote_sha; do
  saw_ref=1
  [ "$local_sha" = "$ZERO" ] && continue          # branch deletion — nothing to attest
  saw_real_ref=1
  sha="$local_sha"; branch="${remote_ref#refs/heads/}"
  break                                           # foreground the first real ref
done

# Deletion-only push. `git push origin --delete <branch>` sends no content, so gating it is
# pure waste — and the old HEAD fallback below attributed the result to whatever HEAD
# happened to be, producing a report for a commit the push never touched. That is not a
# theoretical edge: on 2026-08-08 a branch cleanup in space.irama.org ran the full gate
# (including `next build`) and posted `{branch:"", result:"fail"}` against a sha whose real
# gate had passed thirteen minutes earlier, turning the hub's CI tile amber.
if [ "$saw_ref" = "1" ] && [ "$saw_real_ref" = "0" ]; then
  echo "ci-gate: deletion-only push — nothing to gate"
  exit 0
fi

# Attest ONLY what was actually tested. The gate runs against the WORKING TREE, not against
# `$sha`, so the two agree only when HEAD is the commit being pushed and the tree is clean.
# `git push <sha>:main`, a push from a detached or older HEAD, or a dirty checkout all make
# the attestation a claim about code that was never run. Report nothing rather than a lie —
# the hub renders a missing report as "unattested", which is the honest answer.
head_sha="$(git rev-parse HEAD 2>/dev/null || true)"
tree_clean="true"; [ -n "$(git status --porcelain)" ] && tree_clean="false"
# --attest has no pushed ref, so HEAD IS the subject. Everything below then treats it exactly
# like a push of HEAD — including the dirty-tree refusal, which is the whole safety property.
if [ "$attest_by_hand" = "1" ]; then
  sha="$head_sha"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  # Fail before the gate, not after it. The whole cost of this mistake is a full test run
  # spent on the wrong commit, so the check has to happen while it is still free.
  case "$head_sha" in
    "$attest_want"*) ;;
    *)
      if [ -n "$attest_want" ]; then
        echo "ci-gate: --attest asked for ${attest_want} but HEAD is ${head_sha:0:7}." >&2
        echo "         Check out that commit first (git fetch && git switch main && git pull --ff-only), or drop the sha to gate whatever you are on." >&2
        exit 1
      fi
      ;;
  esac
fi
attest=1
if [ "$saw_real_ref" = "0" ]; then
  attest=0                                        # run by hand, no ref list — gate only
elif [ "$sha" != "$head_sha" ]; then
  attest=0
  echo "ci-gate: pushing ${sha:0:7} but HEAD is ${head_sha:0:7} — gating the tree, not attesting"
elif [ "$tree_clean" = "false" ]; then
  attest=0
  echo "ci-gate: working tree is dirty — gating it, but not attesting ${sha:0:7}"
fi
[ -z "$sha" ] && sha="$head_sha"

# Ref parsing is the only real logic in this file, and a pre-push hook cannot be exercised
# for real without pushing something. CI_GATE_DRY_RUN stops here and prints the decision, so
# scripts/ci-gate.test.sh can drive every ref shape (deletion-only, mixed, detached HEAD,
# dirty tree, no ref list) in a throwaway repo without running a gate or touching the hub.
# --- 1a2. a free port for any visual suite (fleet-wide; inert where there is none) ---
# A Playwright config binds ONE fixed port and, locally, reuses whatever already answers it.
# Several threads gate at once across this fleet, so the collision case is not "port busy,
# fail" — it is "screenshot ANOTHER APP and call it a pass". Only a pre-flight probe stands
# between that and a false green, and not every suite has one. So hand the suite a port that
# is actually free. A repo whose config does not read VISUAL_PORT simply ignores this.
# GATE_VERSION is NOT bumped: the command SET is unchanged, this only picks a port for it.
if [ -z "${VISUAL_PORT:-}" ] && command -v lsof >/dev/null 2>&1; then
  candidate=3010
  while [ "$candidate" -le 3030 ]; do
    if ! lsof -ti:"$candidate" >/dev/null 2>&1; then
      export VISUAL_PORT="$candidate"
      break
    fi
    candidate=$((candidate + 1))
  done
  # Nothing free in the range: leave it unset and let the config's own default stand. The
  # suite's pre-flight is then the backstop, exactly as it was before this block existed.
fi

if [ -n "${CI_GATE_DRY_RUN:-}" ]; then
  echo "sha=$sha branch=$branch attest=$attest tree_clean=$tree_clean visual_port=${VISUAL_PORT:-unset}"
  exit 0
fi

# On a push, gating without attesting is still worth doing — the gate is what blocks a bad
# push, and the report is only telemetry. On --attest the report IS the point, so running a
# full gate that can report nothing is pure waste. Stop now and say what to fix instead.
# Sits after the dry-run exit so the test harness can still inspect the refused decision.
if [ "$attest_by_hand" = "1" ] && [ "$attest" = "0" ]; then
  echo "ci-gate: --attest cannot report on a dirty tree. Commit or stash your changes, then run it again."
  exit 1
fi

# --- 1b. cron guard (instant, runs before the expensive gate) ---
# A vercel.json cron that fires more than once a day makes Vercel Hobby refuse to CREATE the
# deployment (cron_jobs_limits_reached), so the push succeeds while prod silently stays on the
# previous build — no failed deploy, nothing in the dashboard. Blocks rather than warns: a
# push that cannot deploy is worse than a push that stops. No-op where the sibling script or
# vercel.json is absent, so an unsynced repo is unaffected.
gate_root="$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
if [ -f "$gate_root/scripts/check-crons.mjs" ]; then
  node "$gate_root/scripts/check-crons.mjs" "$gate_root/vercel.json" </dev/null || exit 1
fi

# --- 1b1. migration definer/PUBLIC window (all repos, instant) ---
# Postgres grants EXECUTE on a NEW function to PUBLIC, so a migration that creates a
# SECURITY DEFINER function and then revokes it from public/anon/authenticated leaves a window
# where anon can call it - applied with a bare `psql -f`, every statement autocommits. A definer
# function bypasses RLS, so for those milliseconds the lockdown the migration is about is off.
# status.peakstate.global's backup_registry() returns the whole fleet keyring and had this
# window until 2026-09-25; a code review found it, no test did. Blocks, like check-crons: the
# fix is two lines and the failure is silent.
#
# --changed does its OWN git diff and reads the pushed commit. The selection used to live here
# as a `git diff -z | xargs -0` pipeline and took three rounds of review defects, each one
# leaving the guard a silent no-op. One argument, no pipe, and it is covered by a test suite.
if [ -f "$gate_root/scripts/check-migration-definer-txn.mjs" ]; then
  ( cd "$gate_root" && node scripts/check-migration-definer-txn.mjs --changed \
      --rev "${sha:-HEAD}" ) </dev/null || exit 1
fi

# --- 1c. safe-ip fan-out guard (hub only, instant) ---
# The canonical private-IP classifier lives here and is vendored into four sibling repos.
# A fix landing here and NOT reaching them is the exact failure this file was created to end
# — it happened once already, on the day it shipped. WARNS rather than blocks: the siblings
# are separate checkouts on separate branches, so a legitimately-in-flight one would
# otherwise wedge this repo's push. Their own suites carry the vendored copy and fail if it
# has been edited, so a real regression is still caught somewhere that blocks.
if [ -f "$gate_root/scripts/sync-safe-ip.mjs" ]; then
  node "$gate_root/scripts/sync-safe-ip.mjs" --check </dev/null \
    || echo "  ^ safe-ip: siblings are behind the canonical copy — run: node scripts/sync-safe-ip.mjs"
fi

# --- 1c0. ci-gate fan-out guard (hub only, instant) ---
# This script reaches the other repos by hand-copy, and nothing used to check the copies kept
# up — a fix made here could sit unnoticed in 14 repos. WARNS rather than blocks: a sibling's
# stale copy is not a reason to refuse THIS push.
if [ -f "$gate_root/scripts/sync-ci-gate.mjs" ]; then
  node "$gate_root/scripts/sync-ci-gate.mjs" --check </dev/null \
    || echo "  ^ ci-gate: siblings are behind the canonical copy — see docs/ci-gate-rollout.md"
fi

# --- 1c1. eslint-rules fan-out guard (hub only, instant) ---
# Same arrangement as safe-ip above: the canonical custom ESLint rules live here and are
# vendored into the fleet repos that have switched them on. Copying the file does not enable
# the rule — each repo's eslint.config.mjs imports it explicitly — so this only guards the
# copies from drifting behind a fix made here. WARNS rather than blocks, for the same reason.
if [ -f "$gate_root/scripts/sync-eslint-rules.mjs" ]; then
  node "$gate_root/scripts/sync-eslint-rules.mjs" --check </dev/null \
    || echo "  ^ eslint-rules: siblings are behind the canonical copy — run: node scripts/sync-eslint-rules.mjs"
fi

# --- 1c2. this script's own ref-parsing tests (canonical checkout only, ~1s) ---
# The hook decides what to gate and what to attest before any of the expensive work runs, and
# a mistake there is invisible until a wrong attestation reaches the hub. The tests are
# hermetic (throwaway repos in a temp dir, no network, no gate), so the canonical copy pays a
# second to prove them. Absent in the app repos, which is why this is a file-existence check.
if [ -f "$gate_root/scripts/ci-gate.test.sh" ]; then
  bash "$gate_root/scripts/ci-gate.test.sh" </dev/null \
    || { echo "  ^ ci-gate: its own ref-parsing tests failed"; exit 1; }
fi

# --- 1d. agent-surface conformance (only where a surface exists) ---
# Self-activating: a repo with no `src/lib/agent-surface/vendor` skips this entirely, so the
# script stays identical fleet-wide. Two commands, and BOTH block:
#   * `--check` byte-compares the vendored suite against the canonical one. Without it the
#     gate happily runs a hand-edited copy and the report still reads in-window — the version
#     says nothing about the bytes.
#   * the conformance run ends in `report.mjs --strict`, which fails on a security-critical
#     regression, a fail, or an out-of-window suite.
# NOT path-filtered, deliberately (CONFORMANCE.md § CI triggers): auth behaviour changes
# through shared libraries, middleware, package upgrades and DB functions, none of which
# appear in any list of paths.
# Cost: this is a SECOND full vitest run, because the report needs vitest's JSON output and
# the triad above does not emit it. Worth fixing when it starts to hurt; the honest gate is
# worth more than the seconds today.
if [ -d "src/lib/agent-surface/vendor" ]; then
  # The sync script lives in the STANDARD's checkout, not in the app being gated — pointing
  # at "$gate_root" made the drift check silently skip in every repo except the hub.
  std_root="${FLEET_STANDARD_ROOT:-$HOME/LOCAL-DEV/status.peakstate.global}"
  if [ -f "$std_root/scripts/sync-agent-surface-tests.mjs" ]; then
    node "$std_root/scripts/sync-agent-surface-tests.mjs" --check --targets "$PWD" </dev/null \
      || { echo "  ^ agent-surface: vendored suite has drifted from the canonical copy"; exit 1; }
  else
    # Not fatal here: the report cannot read the canonical version either, so it reports the
    # window as `unverified` and --strict fails on that a few lines below.
    echo "  ^ agent-surface: canonical checkout not found at $std_root — drift unverified"
  fi
  # Prefer `conformance:gate` — it writes report.mjs's output to an ignored path. The plain
  # `conformance` script writes the TRACKED agent-surface-conformance.json, whose timestamps
  # change every run, so a clean checkout went dirty here BEFORE the tree_clean check below:
  # the attestation posted tree_clean=false for a checkout that was clean when the push
  # started, and every push left uncommitted changes behind (observed in nav, 2026-08-01).
  # Falls back to `conformance` so a repo that has not yet added the gate variant still runs
  # a real gate rather than erroring — it just keeps the dirty-tree behaviour until it does.
  # Deliberately NOT `--if-present`, which would silently skip the gate entirely.
  if node -e "process.exit(require('./package.json').scripts?.['conformance:gate']?0:1)" 2>/dev/null; then
    conformance_script="conformance:gate"
  else
    conformance_script="conformance"
  fi
  (pnpm run "$conformance_script") </dev/null || { echo "  ^ agent-surface: conformance gate failed"; exit 1; }
fi

# --- 2. gate (secret NOT in env) — stdin redirected so tools don't swallow the ref list ---
# The NON-MUTATING triad (eslint without --fix): a pre-push hook must never rewrite files
# mid-push. THIS repo is pnpm, so its copy uses pnpm — per docs/ci-gate-rollout.md step 3, the
# gate line is the one line each repo adjusts to its own package manager / script names, and the
# fleet's copies are deliberately not byte-identical. npm repos keep `npm run … && npx …`.
# GATE_VERSION 6: the command set gained the stale-deps check below.
# GATE_VERSION 7: the command set gained the migration definer/PUBLIC window check above,
# so a version-6 attestation cannot be read as having run it.
#
# Output is tee'd rather than captured so the pusher still watches the run live; `pipefail`
# (set at the top) makes the pipeline carry the subshell's exit status, not tee's. Promoted
# from hoomans-hackerman, which worked this out first and carried it alone.
gate_result="pass"
gate_log="$(mktemp)"
if ! { (pnpm run typecheck && pnpm exec eslint src && pnpm exec vitest run) </dev/null 2>&1 | tee "$gate_log"; }; then
  gate_result="fail"
fi
# `verifyDepsBeforeRun: error` makes `pnpm exec` refuse to run AT ALL when node_modules is out
# of sync with the lockfile — the routine case in a fresh worktree, or straight after a branch
# switch that moved pnpm-lock.yaml. Blocking the push there is correct, but reporting "fail" is
# a lie: no check ran, so nothing failed. The hub's contract is "the gate passed/failed for SHA
# x", and a stale-deps abort is neither. The hub's schema only accepts pass|fail, so this
# third state SKIPS the attestation entirely rather than inventing a value the API would 400 on.
if grep -q 'ERR_PNPM_VERIFY_DEPS_BEFORE_RUN' "$gate_log" 2>/dev/null; then
  gate_result="notrun"
  # Name the command the reader actually ran. "push again" is wrong advice under --attest,
  # where there is no push to repeat, and wrong advice is what sends someone looking for a
  # second problem that is not there.
  retry="push again"; [ "$attest_by_hand" = "1" ] && retry="run --attest again"
  echo "ci-gate: dependencies are out of sync with pnpm-lock.yaml — no check ran, so nothing was reported to the hub. Run \`pnpm install\` and $retry." >&2
fi
rm -f "$gate_log"
# tree_clean is measured in step 1, BEFORE the gate — a gate that dirties the tree must not
# be able to describe the tree it dirtied as the one it tested.

# --- 3a. local verdict record — ALWAYS, whenever the gate actually ran, whether or not
# this run may attest to the hub. This is the hand-run mode: `sha` already fell back to
# HEAD at step 1 even with no ref list on stdin, so a person running this script directly
# in a worktree gates that worktree's HEAD and gets a row here. Before this block moved
# above the hub early-return, `attest=0` (the hand-run case) skipped straight past it and
# nothing was ever written — the gate button in the dashboard depends on this row existing
# for the NEXT scan to read. `notrun` still skips it: no check ran, so there is no verdict
# to record. The hub knows the gate ran, but only for repos with a registry row and a
# secret on this device, and only over the network. The WIP dashboard runs offline against
# every repo on the laptop, so without this it cannot tell a gated tip from one the Stop
# hook committed with --no-verify. Append-only, fail-open, never blocks the push.
# The gate always runs commands against the WORKING TREE (i.e. `head_sha`), never against
# `$sha` — `$sha` is only what was NAMED on stdin as being pushed. When they differ (a
# `git push <sha>:main` from a detached/older HEAD), recording the verdict under `$sha`
# would claim a commit was gated when only `head_sha` ever ran through the checks. Record
# under `head_sha` always, so the row never outlives the commit it actually tested.
if [ "$gate_result" != "notrun" ] && [ -n "$head_sha" ] && [ -n "$REPO" ]; then
  gate_log="$HOME/.claude/cache/gate-results.jsonl"
  mkdir -p "$(dirname "$gate_log")" 2>/dev/null || true
  esc() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }
  printf '{"repo":"%s","sha":"%s","branch":"%s","result":"%s","tree_clean":%s,"gate_version":"%s","ran_at":"%s"}\n' \
    "$(esc "$REPO")" "$head_sha" "$(esc "$branch")" "$gate_result" "$tree_clean" "$GATE_VERSION" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$gate_log" 2>/dev/null || true
fi

# --- 3b. best-effort report to the hub (fail-open) — attestation only, never local record ---
if [ "$attest" = "0" ] || [ "$gate_result" = "notrun" ]; then
  # Deliberately silent about the secret: nothing was claimed, so there is nothing to send.
  # `notrun` lands here too — a stale-deps abort still blocks the push (the exit below is
  # non-zero) but must never reach the hub as a verdict about this commit.
  [ "$gate_result" = "pass" ]
  exit $?
fi
if [ -f "$SECRET_FILE" ]; then
  # `set -u` is on, and an unset expansion inside a sourced file kills the shell — which
  # would make the REPORT block the push. Fail-open means fail-open (Codex review).
  set +u
  # shellcheck disable=SC1090
  . "$SECRET_FILE"                                # defines GATE_REPORT_SECRET
  set -u
fi
if [ -n "${GATE_REPORT_SECRET:-}" ] && [ -n "$sha" ] && [ -n "$REPO" ]; then
  device="$(hostname -s 2>/dev/null || echo unknown)"
  ran_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # A double quote is a legal character in a git branch name, and interpolating one straight
  # into the payload produced invalid JSON — the hub 400'd and the attestation was silently
  # lost (Codex review). Backslash, the other JSON escape, is already forbidden in a ref name.
  json_escape() { local s=${1//\\/\\\\}; printf '%s' "${s//\"/\\\"}"; }
  payload="{\"repo\":\"$(json_escape "$REPO")\",\"sha\":\"$sha\",\"branch\":\"$(json_escape "$branch")\",\"result\":\"$gate_result\",\"tree_clean\":$tree_clean,\"gate_version\":\"$GATE_VERSION\",\"device\":\"$(json_escape "$device")\",\"ran_at\":\"$ran_at\"}"
  # Report WHY it failed. The bare `curl -f … >/dev/null 2>&1` swallowed the status, so a
  # 404 "unknown repo" (the repo has no row in the hub registry — the common case for a
  # newly-onboarded app) looked identical to the hub being down. Still fail-open.
  resp="$(mktemp)"
  # curl still writes %{http_code} (000) when it cannot connect, so do NOT `|| echo 000` —
  # that concatenates into "000000". Blank means curl produced nothing at all.
  code="$(curl -sS -m 3 -o "$resp" -w '%{http_code}' -X POST "$HUB_URL" \
    -H "authorization: Bearer $GATE_REPORT_SECRET" \
    -H "content-type: application/json" \
    -d "$payload" 2>/dev/null)" || true
  case "${code:-000}" in
    2??) ;;
    # 404 = this repo has no row in the hub registry, which is the CORRECT answer for a repo
    # the hub does not watch (templates, scratch repos, anything pre-onboarding). Calling that
    # "failed" trained everyone to ignore the line — and it is the exact message that got
    # recorded as a hub bug when it was working as designed. Say what it means instead.
    # …but ONLY the hub's own "unknown repo" body. A stale GATE_REPORT_URL or a missing route
    # also 404s, and calling that "expected" would hide a real telemetry outage behind advice to
    # run /ingest-manifest (Codex review 2026-07-28).
    404) if grep -q 'unknown repo' "$resp" 2>/dev/null; then
           echo "ci-gate: gate result not recorded — $REPO is not in the status-hub registry (expected for an unwatched repo; run /ingest-manifest there to add it)" >&2
         else
           echo "ci-gate: attestation POST failed (non-blocking) — HTTP 404 from $HUB_URL, which is not the hub's unknown-repo answer: $(tr -cd '[:print:]' <"$resp" | cut -c1-200)" >&2
         fi ;;
    # Printable characters only: the body is remote output landing on a terminal, so strip
    # control/escape sequences before echoing it.
    *) echo "ci-gate: attestation POST failed (non-blocking) — HTTP ${code:-000} $(tr -cd '[:print:]' <"$resp" | cut -c1-200)" >&2 ;;
  esac
  rm -f "$resp"
fi

# --- 4. decide ---
[ "$gate_result" = "pass" ]
