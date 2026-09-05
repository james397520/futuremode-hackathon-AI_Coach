#!/bin/bash
# Rocketbox 角色 → .vrm(VRM 1.0)。兩步驟:Node 匯出 GLB(貼圖先拿掉,因為 Node 沒有
# canvas)→ Python 內嵌貼圖並注入 VRMC_vrm。
#   ./tools/make_vrm.sh Business_Male_02 "王先生・30代" [ageTag]
set -e
cd "$(dirname "$0")/.."
AVATAR="$1"; NAME="$2"; AGE="$3"
STEM="$AVATAR${AGE:+_$AGE}"
node tools/rocketbox_to_vrm.mjs "$AVATAR" $AGE 2>&1 | grep -v "^FBXLoader:\|GLTFExporter: Use Mesh"
python3 tools/vrm_finalize.py --raw "public/models/$STEM.raw.glb" \
    --out "public/models/$STEM.vrm" --name "$NAME"
rm -f "public/models/$STEM.raw.glb" "public/models/$STEM.textures.json"
