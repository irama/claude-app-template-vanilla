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

GATE_VERSION="1"
HUB_URL="${GATE_REPORT_URL:-https://status.peakstate.global/api/gate-report}"
SECRET_FILE="${GATE_REPORT_ENV:-$HOME/.config/peakstate/gate-report.env}"

# owner/name from the origin remote — keeps this script identical in every repo.
origin="$(git remote get-url origin 2>/dev/null || true)"
REPO="$(printf '%s' "$origin" | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##')"

# --- 1. pushed ref/SHA from stdin ---
ZERO="0000000000000000000000000000000000000000"
sha=""; branch=""
while read -r _local_ref local_sha remote_ref _remote_sha; do
  [ "$local_sha" = "$ZERO" ] && continue          # branch deletion — nothing to attest
  sha="$local_sha"; branch="${remote_ref#refs/heads/}"
  break                                           # foreground the first real ref
done
[ -z "$sha" ] && sha="$(git rev-parse HEAD 2>/dev/null || true)"

# --- 2. gate (secret NOT in env) — stdin redirected so tools don't swallow the ref list ---
# The NON-MUTATING triad (eslint without --fix): a pre-push hook must never rewrite files
# mid-push. `npm run <script>` + npx resolve from node_modules regardless of the package
# manager, so this line is portable as-is. A repo whose scripts/lint-paths differ is caught
# at rollout (Phase 3b), not papered over by auto-detecting a `check` script that may --fix.
gate_result="pass"
if ! (npm run typecheck && npx eslint src && npx vitest run) </dev/null; then
  gate_result="fail"
fi
if [ -z "$(git status --porcelain)" ]; then tree_clean="true"; else tree_clean="false"; fi

# --- 3. best-effort report (fail-open) ---
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
    # Printable characters only: the body is remote output landing on a terminal, so strip
    # control/escape sequences before echoing it.
    # 404 = this repo has no row in the hub registry, which is the CORRECT answer for a repo
    # the hub does not watch (templates, scratch repos, anything pre-onboarding). Calling that
    # "failed" trained everyone to ignore the line — and it is the exact message that got
    # recorded as a hub bug when it was working as designed. Say what it means instead.
    404) echo "ci-gate: gate result not recorded — $REPO is not in the status-hub registry (expected for an unwatched repo; run /ingest-manifest there to add it)" >&2 ;;
    *) echo "ci-gate: attestation POST failed (non-blocking) — HTTP ${code:-000} $(tr -cd '[:print:]' <"$resp" | cut -c1-200)" >&2 ;;
  esac
  rm -f "$resp"
fi

# --- 4. decide ---
[ "$gate_result" = "pass" ]
