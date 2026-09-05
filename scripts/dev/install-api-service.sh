#!/usr/bin/env bash
# Register (or remove) the API supervisor as a macOS launchd user agent.
#
#   scripts/dev/install-api-service.sh              # install + start now
#   scripts/dev/install-api-service.sh --uninstall  # stop + remove
#   scripts/dev/install-api-service.sh --status
#
# Why launchd and not a shell loop in a terminal: the loop dies with the
# terminal (or the agent session) that started it, and then nothing restarts
# the API. launchd with KeepAlive restarts the wrapper if *it* ever exits, starts
# it at login, and is independent of any shell. The wrapper (run-api.sh) in turn
# restarts uvicorn when the Python process crashes. Two layers, both dumb.
#
# Logs: /tmp/ai-coach-api.log (uvicorn stdout+stderr), /tmp/ai-coach-api-exits.log
# (one line per start/exit with the exit code).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.aicoach.api"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
API_LOG="${API_LOG:-/tmp/ai-coach-api.log}"

status() {
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchctl print "$DOMAIN/$LABEL" | grep -E "state|pid|last exit" | sed 's/^/  /'
  else
    echo "  $LABEL is not loaded"
  fi
}

case "${1:-install}" in
  --status|status)
    status; exit 0 ;;
  --uninstall|uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $LABEL"; exit 0 ;;
  install) ;;
  *) echo "usage: $0 [--status|--uninstall]" >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$PLIST")"
# PATH is explicit: launchd does not read the shell profile, and run-api.sh
# needs the Homebrew python3 for its .env parser.
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/dev/run-api.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>API_HOST</key><string>${API_HOST:-0.0.0.0}</string>
    <key>API_PORT</key><string>${API_PORT:-8000}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$API_LOG</string>
  <key>StandardErrorPath</key><string>$API_LOG</string>
</dict>
</plist>
EOF

# Reload if already present, otherwise a fresh bootstrap.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
echo "installed $LABEL -> $PLIST"
status
