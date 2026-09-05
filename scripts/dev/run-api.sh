#!/usr/bin/env bash
# Supervised API. This is the ONLY way the API should be started on this machine.
#
# uvicorn on Python 3.14 dies by itself every 8–50 minutes — the exit log has
# shown 139 (SIGSEGV) and 134 (SIGABRT) with no Python traceback, i.e. a native
# extension is crashing under us. Until that is fixed at the root (downgrade to
# 3.12 / rebuild the wheels) this loop keeps the product up:
#
#   * brings uvicorn back within 2s of any exit, whatever the code;
#   * backs off (10s, then 30s) only when it dies repeatedly within 10s of
#     starting, so a genuinely broken config does not spin the CPU;
#   * records every start and exit, with UTC time and code, in $API_EXIT_LOG —
#     that file is the evidence for the crash investigation;
#   * forwards SIGTERM/SIGINT to uvicorn and exits cleanly, so launchd (or ^C)
#     stops the *pair*, not just the wrapper — the old version left an orphaned
#     uvicorn holding port 8000 whenever the wrapper was killed.
#
# Outer layer: scripts/dev/install-api-service.sh registers this script as a
# launchd user agent with KeepAlive, which restarts the wrapper itself and
# starts it at login. Run it directly (foreground) for a one-off dev session.
#
# Config: API_HOST (0.0.0.0), API_PORT (8000), API_RELOAD=1 for uvicorn --reload,
# API_EXIT_LOG (/tmp/ai-coach-api-exits.log).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_HOST="${API_HOST:-0.0.0.0}"
API_PORT="${API_PORT:-8000}"
API_EXIT_LOG="${API_EXIT_LOG:-/tmp/ai-coach-api-exits.log}"
cd "$ROOT/apps/api"

log() { echo "$(date -u +%FT%TZ) $*" >> "$API_EXIT_LOG"; }

if [ ! -x ./.venv/bin/python ]; then
  echo "run-api: apps/api/.venv is missing — create it first (see apps/api/README.md)" >&2
  log "abort: no .venv"
  # EX_CONFIG. launchd will still retry after ThrottleInterval, which is fine.
  exit 78
fi

# Root .env is the single source of config (see next.config.mjs loadRootEnv);
# strip inline comments the way pydantic-settings would not. Real env wins.
if [ -f "$ROOT/.env" ]; then
  eval "$(python3 - "$ROOT/.env" <<'PY'
import os, re, shlex, sys
from pathlib import Path
for line in Path(sys.argv[1]).read_text().splitlines():
    t = line.strip()
    if not t or t.startswith("#") or "=" not in t: continue
    k, v = t.split("=", 1); k = k.strip(); v = v.strip()
    if v[:1] in "\"'": v = v[1:-1]
    else: v = re.split(r"\s+#", v)[0].strip()
    if k in os.environ: continue
    print(f"export {k}={shlex.quote(v)}")
PY
)"
fi

child=""
stop() {
  log "supervisor: signal received, stopping uvicorn"
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null
    # Give it a moment to close sockets, then insist.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$child" 2>/dev/null || break
      sleep 0.5
    done
    kill -KILL "$child" 2>/dev/null
    wait "$child" 2>/dev/null
  fi
  log "supervisor: stopped"
  exit 0
}
trap stop INT TERM HUP

# A string, not an array: on the stock macOS bash 3.2 an empty array is an
# "unbound variable" under set -u.
reload_flag=""
[ "${API_RELOAD:-0}" = "1" ] && reload_flag="--reload"

fast_fails=0
while :; do
  log "start host=$API_HOST port=$API_PORT"
  started=$(date +%s)
  ./.venv/bin/python -m uvicorn app.main:app --host "$API_HOST" --port "$API_PORT" $reload_flag &
  child=$!
  wait "$child"
  code=$?
  child=""
  log "exit code=$code"

  if [ $(( $(date +%s) - started )) -lt 10 ]; then
    fast_fails=$((fast_fails + 1))
  else
    fast_fails=0
  fi
  if   [ "$fast_fails" -ge 5 ]; then delay=30
  elif [ "$fast_fails" -ge 3 ]; then delay=10
  else delay=2
  fi
  sleep "$delay"
done
