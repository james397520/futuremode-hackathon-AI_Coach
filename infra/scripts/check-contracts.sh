#!/usr/bin/env bash
# =============================================================================
# Cross-language contract drift guard.
#
# The realtime contract (spec §55 / §68) is declared twice, in two languages:
#
#   packages/shared-types/src/events.ts   TypeScript — the source of truth
#   apps/api/app/domain/events.py         Pydantic  — the mirror
#
# Nothing in either toolchain can catch a mismatch: `tsc` never sees the Python
# and `mypy` never sees the TypeScript. So the failure mode is a backend that
# emits `score.update` while the frontend reduces `score.updated`, and the bug
# surfaces as "the live score panel is just empty sometimes". This script is the
# only thing standing between us and that.
#
# It compares two SETS of string literals:
#   * from TS: every `type: '...'` discriminant inside the StreamingEvent union,
#     plus every `type: '...'` inside the ClientCommand union
#   * from PY: every event/command literal in the mirror module
# and fails if the sets differ in either direction.
#
# Usage:
#   infra/scripts/check-contracts.sh            # both directions, exit 1 on drift
#   infra/scripts/check-contracts.sh --list     # print what it found, exit 0
#
# See docs/adr/0002-typescript-as-contract-source-of-truth.md and the
# "Contract change protocol" section of CONTRIBUTING.md.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TS_EVENTS="${REPO_ROOT}/packages/shared-types/src/events.ts"
PY_EVENTS="${REPO_ROOT}/apps/api/app/domain/events.py"

LIST_ONLY=0
[ "${1:-}" = "--list" ] && LIST_ONLY=1

# --- colours (skipped when not a tty or when CI sets NO_COLOR) ----------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  RED=''; GRN=''; YEL=''; DIM=''; OFF=''
fi

fail()  { printf '%s✗%s %s\n' "$RED" "$OFF" "$*" >&2; }
ok()    { printf '%s✓%s %s\n' "$GRN" "$OFF" "$*"; }
warn()  { printf '%s!%s %s\n' "$YEL" "$OFF" "$*" >&2; }
note()  { printf '%s  %s%s\n' "$DIM" "$*" "$OFF"; }

# -----------------------------------------------------------------------------
# Extractors
#
# Both are intentionally grep/sed rather than a real parser. A parser would need
# the TS compiler and a Python import of a module whose dependencies may not be
# installed; this has to run in a bare CI job and in a pre-push hook. The cost
# is that the literals must be written as plain single- or double-quoted strings
# on the same line as the key — which is the house style in both files anyway.
# -----------------------------------------------------------------------------

# Both sides are anchored on the *discriminant key* `type:` rather than on
# "any string that looks like an event name". That is what lets the check see a
# dotless literal such as `ack` without also swallowing every lowercase string
# in a docstring or a log message.
#
# TS shapes handled:
#   type: 'session.started'
#   type: "session.started"
extract_ts() {
  local file="$1"
  grep -oE "\btype:[[:space:]]*['\"][a-z][a-z0-9_.]*['\"]" "$file" \
    | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/" \
    | sort -u
}

# PY shapes handled:
#   type: Literal["session.started"] = "session.started"    <- house style
#   type: Literal['session.started']
#   type: "session.started"                                 <- plain fallback
extract_py() {
  local file="$1"
  {
    grep -oE "\btype:[[:space:]]*Literal\[[[:space:]]*['\"][a-z][a-z0-9_.]*['\"]" "$file" || true
    grep -oE "\btype:[[:space:]]*['\"][a-z][a-z0-9_.]*['\"]" "$file" || true
  } \
    | sed -E "s/.*['\"]([^'\"]+)['\"].*/\1/" \
    | sort -u
}

# -----------------------------------------------------------------------------
# Preconditions
#
# A missing Python mirror is a *warning*, not a failure, only while the API tree
# is still being scaffolded: failing here would make the whole CI job red for
# every contributor before apps/api/app/domain exists. Once the file lands, the
# check is hard. Set CONTRACTS_STRICT=1 to make absence fatal immediately.
# -----------------------------------------------------------------------------
if [ ! -f "$TS_EVENTS" ]; then
  fail "missing ${TS_EVENTS#"$REPO_ROOT"/} — the contract source of truth must exist"
  exit 1
fi

if [ ! -f "$PY_EVENTS" ]; then
  if [ "${CONTRACTS_STRICT:-0}" = "1" ]; then
    fail "missing ${PY_EVENTS#"$REPO_ROOT"/} (CONTRACTS_STRICT=1)"
    exit 1
  fi
  warn "missing ${PY_EVENTS#"$REPO_ROOT"/} — Pydantic mirror not written yet."
  warn "Skipping the comparison. This becomes a hard failure once the file exists."
  note "TypeScript side currently declares:"
  extract_ts "$TS_EVENTS" | sed 's/^/    /'
  exit 0
fi

TS_SET="$(extract_ts "$TS_EVENTS")"
PY_SET="$(extract_py "$PY_EVENTS")"

if [ -z "$TS_SET" ]; then
  fail "extracted zero event literals from ${TS_EVENTS#"$REPO_ROOT"/}."
  fail "Either the file changed shape or the extractor regex needs updating."
  exit 1
fi

if [ "$LIST_ONLY" = "1" ]; then
  printf 'TypeScript (%s):\n' "${TS_EVENTS#"$REPO_ROOT"/}"
  printf '%s\n' "$TS_SET" | sed 's/^/  /'
  printf '\nPython (%s):\n' "${PY_EVENTS#"$REPO_ROOT"/}"
  printf '%s\n' "$PY_SET" | sed 's/^/  /'
  exit 0
fi

# -----------------------------------------------------------------------------
# Compare
# -----------------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
printf '%s\n' "$TS_SET" > "$TMP/ts"
printf '%s\n' "$PY_SET" > "$TMP/py"

MISSING_IN_PY="$(comm -23 "$TMP/ts" "$TMP/py")"
MISSING_IN_TS="$(comm -13 "$TMP/ts" "$TMP/py")"

STATUS=0

if [ -n "$MISSING_IN_PY" ]; then
  STATUS=1
  fail "declared in TypeScript but NOT mirrored in Python:"
  printf '%s\n' "$MISSING_IN_PY" | sed 's/^/      /' >&2
  printf '\n' >&2
  printf '  The backend cannot emit these, so the frontend reducer for them is\n' >&2
  printf '  dead code. Add them to %s.\n\n' "${PY_EVENTS#"$REPO_ROOT"/}" >&2
fi

if [ -n "$MISSING_IN_TS" ]; then
  STATUS=1
  fail "present in Python but NOT declared in TypeScript:"
  printf '%s\n' "$MISSING_IN_TS" | sed 's/^/      /' >&2
  printf '\n' >&2
  printf '  §55 says neither side may invent an undeclared event. If the backend\n' >&2
  printf '  emits one of these, the frontend will drop it silently. Declare it in\n' >&2
  printf '  %s FIRST (it is the source of\n' "${TS_EVENTS#"$REPO_ROOT"/}" >&2
  printf '  truth — see docs/adr/0002), then mirror it back.\n\n' >&2
fi

if [ "$STATUS" -eq 0 ]; then
  COUNT="$(printf '%s\n' "$TS_SET" | grep -c . || true)"
  ok "streaming-event contract in sync — ${COUNT} literals match across TS and Python"
else
  fail "contract drift detected. Protocol: change TypeScript first, mirror to"
  fail "Pydantic, re-run this script. See CONTRIBUTING.md."
fi

exit "$STATUS"
