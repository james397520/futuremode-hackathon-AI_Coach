#!/usr/bin/env python3
"""幫一個已備妥的 Rocketbox 角色產生不同年齡的臉部與頭髮貼圖。

Rocketbox 的頭部貼圖是正面臉的 UV 展開,而且頭髮直接烤在裡面,所以年齡差異可以整個
做進貼圖:皺紋交給老化 GAN(tools/age_texture.py),白髮用亮度遮罩把臉部橢圓之外的
深色像素往灰白推。髮片貼圖(*_opacity_color)另外處理,alpha 必須原封不動保留。

  python3 tools/rocketbox_age.py --dir public/models/rocketbox/Business_Female_03 \
      --ages 40:1.6:0.25 65:3.4:0.92

--ages 的格式是 標籤:皺紋強度:白髮程度,可以給多組。
"""
import argparse, json, os, subprocess, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
# Rocketbox 各角色共用同一套頭部 UV 佈局,所以這個裁切框可以固定
FACE_CROP = ('0.30', '0.089', '0.704', '0.492')


def gray_hair_cards(src_path, out_path, amount):
    """髮片貼圖整片往淺灰推。alpha 直接沿用 —— 動到它頭髮會變成一塊塊方形。"""
    im = Image.open(src_path).convert('RGBA')
    a = np.asarray(im, np.float32)
    rgb, alpha = a[..., :3], a[..., 3:]
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    target = (lum * 0.45 + 132)[..., None]
    out = rgb * (1 - amount) + target * amount
    Image.fromarray(np.concatenate([out, alpha], axis=2).clip(0, 255).astype(np.uint8), 'RGBA') \
         .save(out_path, optimize=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dir', required=True, help='rocketbox_prep.py 的輸出目錄')
    p.add_argument('--ages', nargs='+', required=True, metavar='標籤:皺紋:白髮')
    p.add_argument('--crop', nargs=4, default=FACE_CROP)
    a = p.parse_args()

    files = os.listdir(a.dir)
    head = next((f for f in files if f.endswith('_head_color.jpg')), None)
    hair = next((f for f in files if f.endswith('_opacity_color.png')), None)
    if not head:
        raise SystemExit(f'{a.dir} 裡找不到 *_head_color.jpg,先跑 rocketbox_prep.py')
    head_stem, hair_stem = head[:-4], hair[:-4] if hair else None
    print(f'臉: {head}   髮片: {hair or "(無)"}')

    overrides = {}
    for spec in a.ages:
        tag, strength, gray = spec.split(':')
        out_head = f'{head_stem}_{tag}.jpg'
        cmd = [sys.executable, os.path.join(HERE, 'age_texture.py'),
               '--image', os.path.join(a.dir, head), '--out', os.path.join(a.dir, out_head),
               '--crop', *a.crop, '--strength', strength, '--hair-gray', gray]
        print(f'\n[{tag}] 皺紋 {strength} / 白髮 {gray}')
        subprocess.run(cmd, check=True)
        ov = {head_stem: out_head}
        if hair and float(gray) > 0.01:
            out_hair = f'{hair_stem}_{tag}.png'
            gray_hair_cards(os.path.join(a.dir, hair), os.path.join(a.dir, out_hair), float(gray))
            print(f'  {out_hair}  {os.path.getsize(os.path.join(a.dir, out_hair))/1048576:.2f} MB (alpha 保留)')
            ov[hair_stem] = out_hair
        overrides[tag] = ov

    # 更新 textures.json:viewer 靠它判斷某個年齡的貼圖存不存在
    mpath = os.path.join(a.dir, 'textures.json')
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {'textures': {}}
    for f in sorted(os.listdir(a.dir)):
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.jpg', '.png'):
            manifest['textures'][stem] = ext.lower().lstrip('.')
    manifest.setdefault('fbx', next((f for f in os.listdir(a.dir) if f.lower().endswith('.fbx')), None))
    json.dump(manifest, open(mpath, 'w'), indent=2)

    print(f"\ntextures.json 已更新({len(manifest['textures'])} 張)")
    print('角色定義只要寫 ageTex,例如:', ', '.join(f"ageTex:'{t}'" for t in overrides))


if __name__ == '__main__':
    main()
