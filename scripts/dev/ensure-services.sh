#!/usr/bin/env bash
# Bring up everything the web dev server assumes is running: the API agent and,
# on macOS, the native STT daemon and the local TTS model server. Idempotent; a
# no-op on other platforms.
# Wired as `predev` so `pnpm dev` alone gives a working stack.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ "$(uname -s)" = "Darwin" ] || exit 0
DOMAIN="gui/$(id -u)"
up() {  # label install-script
  if launchctl print "$DOMAIN/$1" >/dev/null 2>&1; then
    launchctl kickstart "$DOMAIN/$1" 2>/dev/null || true
    echo "  $1: running"
  else
    bash "$ROOT/scripts/dev/$2" >/dev/null 2>&1 && echo "  $1: installed + started" || echo "  $1: install failed (see $2)"
  fi
}
echo "ensuring background services:"
up com.aicoach.api install-api-service.sh
up com.aicoach.mac-stt install-mac-stt-service.sh
up com.aicoach.local-tts install-local-tts-service.sh
