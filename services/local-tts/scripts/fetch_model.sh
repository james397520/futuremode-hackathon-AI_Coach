#!/usr/bin/env bash
# Fetch both TTS models into services/local-tts/models.
#
#   models/breeze2-vits/     MediaTek-Research/Breeze2-VITS-onnx  ~124 MB (default engine)
#   models/                  hexgrad/Kokoro-82M-v1.1-zh (Apache-2.0)  ~380 MB (fallback)
#
# Kokoro's ONNX export is the one published by kokoro-onnx (thewh1teagle); the
# vocab comes from the original hexgrad repo so token ids match the export.
# Breeze comes straight from its Hugging Face repo — see docs/HANDOFF.md §16.16
# for what its licence does and does not say. sha256 is pinned throughout: a
# different file would produce plausible audio from the wrong weights.
#
#   scripts/fetch_model.sh            # both
#   scripts/fetch_model.sh breeze     # just the default engine
#   scripts/fetch_model.sh kokoro
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${LOCAL_TTS_MODEL_DIR:-$HERE/models}"
mkdir -p "$DEST"
REL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
HF="https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/resolve/main"
BREEZE_HF="https://huggingface.co/MediaTek-Research/Breeze2-VITS-onnx/resolve/main"
BREEZE_DEST="${LOCAL_TTS_BREEZE_DIR:-$DEST/breeze2-vits}"
WANT="${1:-all}"

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

if [ "$WANT" = all ] || [ "$WANT" = breeze ]; then
  echo "fetching Breeze2-VITS-onnx into $BREEZE_DEST"
  mkdir -p "$BREEZE_DEST"
  DEST="$BREEZE_DEST"
  fetch breeze2-vits.onnx "$BREEZE_HF/breeze2-vits.onnx" 13c5d190f911e8ab78db460749b5216663ea0b9497d4d4a2f35800b86fa4d6cf
  fetch lexicon.txt       "$BREEZE_HF/lexicon.txt"       fee63cb838fd0fb295292df8e42fcf5470204b4ced1f4fea8a9a01ef6cc1255e
  fetch tokens.txt        "$BREEZE_HF/tokens.txt"        34b035b9aeb070df6188b022f29c00e0e142c7ade9f25611ced65db5e9cc8402
  DEST="${LOCAL_TTS_MODEL_DIR:-$HERE/models}"
fi

if [ "$WANT" = all ] || [ "$WANT" = kokoro ]; then
  echo "fetching Kokoro-82M-v1.1-zh into $DEST"
  fetch kokoro-v1.1-zh.onnx "$REL/kokoro-v1.1-zh.onnx" 859f9ded9f53be16c24857cdab3254a45da53c3afd5ba6ef134c7de3f822e326
  fetch voices-v1.1-zh.bin  "$REL/voices-v1.1-zh.bin"  14cb6186c99e4f6016871405f62046c5df863ae27465cbdc4ee08be7dd703acd
  fetch config.json         "$HF/config.json"          bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890
fi
du -sh "${LOCAL_TTS_MODEL_DIR:-$HERE/models}"
