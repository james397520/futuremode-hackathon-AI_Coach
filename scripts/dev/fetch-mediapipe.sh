#!/usr/bin/env bash
# Vendor the MediaPipe vision assets into apps/web/public/mediapipe/.
#
# They are served same-origin on purpose: the CSP in apps/web/next.config.mjs
# lists only our own API/WS origins in `connect-src`, so pulling the WASM or the
# model from Google's CDN is blocked silently — no error, the camera just never
# classifies anything.
#
# The WASM comes from the pinned @mediapipe/tasks-vision package, so it is
# reproducible from pnpm-lock.yaml; the model is a stable Google URL.
# Run this after `pnpm install` if the assets are not committed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/apps/web/public/mediapipe"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

src="$(find "$ROOT/node_modules/.pnpm" -type d -path '*@mediapipe/tasks-vision/wasm' | head -1)"
if [ -z "$src" ]; then
  echo "fetch-mediapipe: @mediapipe/tasks-vision not installed — run pnpm install first" >&2
  exit 1
fi

mkdir -p "$DEST/wasm"
# Both the SIMD and the no-SIMD build: FilesetResolver picks at runtime, and a
# missing fallback is a 404 on exactly the older machines that need it.
cp "$src"/vision_wasm_internal.js "$src"/vision_wasm_internal.wasm \
   "$src"/vision_wasm_nosimd_internal.js "$src"/vision_wasm_nosimd_internal.wasm "$DEST/wasm/"

if [ ! -f "$DEST/face_landmarker.task" ]; then
  curl -sfL -o "$DEST/face_landmarker.task" "$MODEL_URL"
fi

echo "mediapipe assets in $DEST:"
du -sh "$DEST"/* | sed 's/^/  /'
