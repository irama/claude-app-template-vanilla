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

GATE_VERSION="5"
HUB_URL="${GATE_REPORT_URL:-https://status.peakstate.global/api/gate-report}"
SECRET_FILE="${GATE_REPORT_ENV:-$HOME/.config/peakstate/gate-report.env}"

# owner/name from the origin remote — keeps this script identical in every repo.
origin="$(git remote get-url origin 2>/dev/null || true)"
REPO="$(printf '%s' "$origin" | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##')"

# --- 1. pushed ref/SHA from stdin ---
# Three outcomes, and the difference between them is the whole point of this block:
#   * a real ref  → gate it, attest it;
#   * ONLY deletions → exit 0 now: nothing is being pushed, so there is nothing to gate;
#   * no ref list at all (a human running this by hand) → gate, but do NOT attest.
ZERO="0000000000000000000000000000000000000000"
sha=""; branch=""; saw_ref=0; saw_real_ref=0
while read -r _local_ref local_sha remote_ref _remote_sha; do
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
if [ -n "${CI_GATE_DRY_RUN:-}" ]; then
  echo "sha=$sha branch=$branch attest=$attest tree_clean=$tree_clean"
  exit 0
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
# GATE_VERSION is NOT bumped: the command SET (typecheck + lint + tests) is unchanged.
gate_result="pass"
if ! (pnpm run typecheck && pnpm exec eslint src && pnpm exec vitest run) </dev/null; then
  gate_result="fail"
fi
# tree_clean is measured in step 1, BEFORE the gate — a gate that dirties the tree must not
# be able to describe the tree it dirtied as the one it tested.

# --- 3. best-effort report (fail-open) ---
if [ "$attest" = "0" ]; then
  # Deliberately silent about the secret: nothing was claimed, so there is nothing to send.
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
