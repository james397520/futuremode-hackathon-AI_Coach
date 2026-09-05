#!/usr/bin/env bash
# Supervised dev API. The uvicorn process has died several times with exit 1
# and *no* traceback — the log simply stops mid-request — so this loop (a) brings
# it back within 2s and (b) records every exit with a timestamp and code in
# $API_EXIT_LOG, which is the evidence we were missing each time it happened.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_EXIT_LOG="${API_EXIT_LOG:-/tmp/ai-coach-api-exits.log}"
cd "$ROOT/apps/api"

# Root .env is the single source of config (see next.config.mjs loadRootEnv);
# strip inline comments the way pydantic-settings would not.
eval "$(python3 - "$ROOT/.env" <<'PY'
import re, shlex, sys
from pathlib import Path
for line in Path(sys.argv[1]).read_text().splitlines():
    t = line.strip()
    if not t or t.startswith("#") or "=" not in t: continue
    k, v = t.split("=", 1); v = v.strip()
    if v[:1] in "\"'": v = v[1:-1]
    else: v = re.split(r"\s+#", v)[0].strip()
    print(f"export {k}={shlex.quote(v)}")
PY
)"

while :; do
  echo "$(date -u +%FT%TZ) start" >> "$API_EXIT_LOG"
  ./.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
  code=$?
  echo "$(date -u +%FT%TZ) exit code=$code" >> "$API_EXIT_LOG"
  sleep 2
done
