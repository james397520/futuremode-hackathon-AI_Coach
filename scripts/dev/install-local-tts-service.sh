#!/usr/bin/env bash
# Register (or remove) the local TTS model server as a launchd user agent.
#
#   scripts/dev/install-local-tts-service.sh              # install, start
#   scripts/dev/install-local-tts-service.sh --uninstall
#   scripts/dev/install-local-tts-service.sh --status
#
# What it runs: services/local-tts (FastAPI + onnxruntime) on
# 127.0.0.1:${LOCAL_TTS_PORT:-8795}, speaking Breeze2-VITS by default with
# Kokoro-82M-v1.1-zh as the second engine. The API's `LocalHttpTts` adapter posts
# persona lines there and falls back to ElevenLabs when the port is closed.
#
# Why launchd and not a child of the API: the model takes ~2 s to load and
# ~600 MB of RAM; it should survive API restarts (`launchctl kickstart -k
# com.aicoach.api` happens on every config change) and start at login without
# anyone remembering to. KeepAlive restarts it if onnxruntime ever crashes.
#
# Weights live in services/local-tts/models (gitignored). They are fetched on
# first install by services/local-tts/scripts/fetch_model.sh (~505 MB: 124 MB of
# Breeze under models/breeze2-vits, 380 MB of Kokoro beside it).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.aicoach.local-tts"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"
SVC="$ROOT/services/local-tts"
PY="$SVC/.venv/bin/python"
PORT="${LOCAL_TTS_PORT:-8795}"
LOG="${LOCAL_TTS_LOG:-/tmp/ai-coach-local-tts.log}"

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

[ "$(uname -s)" = "Darwin" ] || { echo "local-tts launchd agent is macOS only; run uvicorn directly elsewhere"; exit 0; }

# venv + weights, only when missing. `uv` is the project's Python manager.
if [ ! -x "$PY" ]; then
  command -v uv >/dev/null || { echo "uv not found; install it first (https://docs.astral.sh/uv/)" >&2; exit 1; }
  (cd "$SVC" && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -e .)
fi
# Each engine is fetched independently: an install that predates Breeze only
# needs the 124 MB, and a missing Breeze must not re-download 380 MB of Kokoro.
[ -f "$SVC/models/breeze2-vits/breeze2-vits.onnx" ] || bash "$SVC/scripts/fetch_model.sh" breeze
[ -f "$SVC/models/kokoro-v1.1-zh.onnx" ] || bash "$SVC/scripts/fetch_model.sh" kokoro

mkdir -p "$(dirname "$PLIST")"
# PATH is explicit: launchd does not read the shell profile, and /speak?format=mp3
# shells out to Homebrew's ffmpeg.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>-m</string><string>uvicorn</string>
    <string>app.main:app</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>$PORT</string>
    <string>--log-level</string><string>warning</string>
  </array>
  <key>WorkingDirectory</key><string>$SVC</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>LOCAL_TTS_PORT</key><string>$PORT</string>
    <key>OMP_NUM_THREADS</key><string>4</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"
echo "installed $LABEL -> $PLIST (127.0.0.1:$PORT, log $LOG)"
status
