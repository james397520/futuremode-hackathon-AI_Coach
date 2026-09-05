#!/usr/bin/env bash
# Fetch the Kokoro-82M-v1.1-zh weights (Apache-2.0) into services/local-tts/models.
#
# The ONNX export is the one published by kokoro-onnx (thewh1teagle); the vocab
# comes from the original hexgrad repo so token ids match the export. sha256 is
# pinned: a different file would produce plausible audio from the wrong weights.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${LOCAL_TTS_MODEL_DIR:-$HERE/models}"
mkdir -p "$DEST"
REL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
HF="https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/main"

fetch() {  # name url sha256
  local out="$DEST/$1"
  if [ -f "$out" ] && [ "$(shasum -a 256 "$out" | cut -d' ' -f1)" = "$3" ]; then
    echo "  $1: present"; return
  fi
  echo "  $1: downloading"
  curl -fL --retry 3 -o "$out.part" "$2"
  local got; got="$(shasum -a 256 "$out.part" | cut -d' ' -f1)"
  [ "$got" = "$3" ] || { echo "sha256 mismatch for $1: $got" >&2; rm -f "$out.part"; exit 1; }
  mv "$out.part" "$out"
}

echo "fetching Kokoro-82M-v1.1-zh into $DEST"
fetch kokoro-v1.1-zh.onnx "$REL/kokoro-v1.1-zh.onnx" 859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326
fetch voices-v1.1-zh.bin  "$REL/voices-v1.1-zh.bin"  14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd
fetch config.json         "$HF/config.json"          bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890
du -sh "$DEST"
