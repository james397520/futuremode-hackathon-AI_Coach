#!/usr/bin/env bash
# Register (or remove) the macOS-native STT helper as a launchd user agent.
#
#   scripts/dev/install-mac-stt-service.sh              # build if needed, install, start
#   scripts/dev/install-mac-stt-service.sh --uninstall
#   scripts/dev/install-mac-stt-service.sh --status
#
# Why launchd, and why not a child of the API: TCC attributes a privacy request
# to the *responsible* process. A helper spawned by the API (or by a terminal)
# is judged by that parent's Info.plist, which has no speech-recognition usage
# description, so the helper is killed with SIGABRT before it can even ask. A
# launchd agent is responsible for itself, so the prompt appears once, is
# remembered against the bundle id, and every later utterance is silent.
#
# The daemon listens on 127.0.0.1:${MAC_STT_PORT:-8790}; the API connects there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.aicoach.mac-stt"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
APP="$ROOT/tools/mac-stt/bin/mac-stt.app"
BIN="$APP/Contents/MacOS/mac-stt"
PORT="${MAC_STT_PORT:-8790}"
LOG="${MAC_STT_LOG:-/tmp/ai-coach-mac-stt.log}"

status() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E "state|pid|last exit" | sed 's/^/  /'
  else
    echo "  $LABEL is not loaded"
  fi
}

case "${1:-install}" in
  --status|status) status; exit 0 ;;
  --uninstall|uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"; echo "removed $LABEL"; exit 0 ;;
  install) ;;
  *) echo "usage: $0 [--status|--uninstall]" >&2; exit 2 ;;
esac

[ "$(uname -s)" = "Darwin" ] || { echo "mac-stt is macOS only; nothing to install"; exit 0; }
[ -x "$BIN" ] || bash "$ROOT/tools/mac-stt/build.sh"

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
    <string>--serve</string>
    <string>--port</string><string>$PORT</string>
    <string>--locale</string><string>zh-TW</string>
    <string>--on-device</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
echo "installed $LABEL -> $PLIST (127.0.0.1:$PORT)"
echo "first start asks for Speech Recognition permission once — click Allow"
status
