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
  # shellcheck disable=SC1090
  . "$SECRET_FILE"                                # defines GATE_REPORT_SECRET
fi
if [ -n "${GATE_REPORT_SECRET:-}" ] && [ -n "$sha" ] && [ -n "$REPO" ]; then
  device="$(hostname -s 2>/dev/null || echo unknown)"
  ran_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  payload="{\"repo\":\"$REPO\",\"sha\":\"$sha\",\"branch\":\"$branch\",\"result\":\"$gate_result\",\"tree_clean\":$tree_clean,\"gate_version\":\"$GATE_VERSION\",\"device\":\"$device\",\"ran_at\":\"$ran_at\"}"
  curl -fsS -m 3 -X POST "$HUB_URL" \
    -H "authorization: Bearer $GATE_REPORT_SECRET" \
    -H "content-type: application/json" \
    -d "$payload" >/dev/null 2>&1 \
    || echo "ci-gate: attestation POST failed (non-blocking)" >&2
fi

# --- 4. decide ---
[ "$gate_result" = "pass" ]
