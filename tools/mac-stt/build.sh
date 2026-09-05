#!/usr/bin/env bash
# Build the macOS-native STT helper as a minimal .app bundle.
#
# Why a bundle and not a bare binary: TCC decides privacy prompts from the
# *bundle's* Info.plist. A bare CLI with the plist embedded as a __info_plist
# section is still killed with "attempted to access privacy-sensitive data
# without a usage description" — confirmed from the crash report. The bundle
# needs no Xcode; the Command Line Tools are enough, and an ad-hoc signature
# gives TCC a stable identity to remember the user's answer against.
set -euo pipefail
cd "$(dirname "$0")"
APP=bin/mac-stt.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
# Explicit deployment target. This machine's Command Line Tools default to a
# *future* macOS (28.0 on a 27.0 system); LaunchServices then refuses the bundle
# with -10825 "requires a newer macOS", TCC never sees the usage description,
# and the process is killed with a misleading "no usage description" message.
xcrun swiftc -O -target arm64-apple-macos13.0 Sources/main.swift -o "$APP/Contents/MacOS/mac-stt" \
  -framework Speech -framework AVFoundation -framework Foundation
cat > "$APP/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>mac-stt</string>
  <key>CFBundleIdentifier</key><string>com.aicoach.mac-stt</string>
  <key>CFBundleName</key><string>mac-stt</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSBackgroundOnly</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>AI Coach 在本機將學員的語音轉為文字，音訊不會離開這台電腦。</string>
</dict></plist>
PL
codesign --force --sign - "$APP" >/dev/null
# Register with LaunchServices so TCC / tccutil can resolve the bundle id.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
# Convenience symlink so callers can keep a flat path.
ln -sf "mac-stt.app/Contents/MacOS/mac-stt" bin/mac-stt
echo "built $(pwd)/$APP"
