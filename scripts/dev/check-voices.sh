#!/usr/bin/env bash
# Which system voices are installed, and at what quality. Run after downloading
# a voice in System Settings to confirm it actually landed:
#   scripts/dev/check-voices.sh        # Chinese voices
#   scripts/dev/check-voices.sh all    # everything
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/tools/mac-stt/bin/mac-voices"
[ -x "$BIN" ] || bash "$ROOT/tools/mac-stt/build.sh" >/dev/null
"$BIN" "${1:-zh}"
