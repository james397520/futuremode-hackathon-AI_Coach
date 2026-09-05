#!/usr/bin/env python3
"""把一張 FFHQ 對齊的人臉照片換到 GLB 角色的臉部貼圖上。

實測 Avaturn / MetaPerson 的 Head UV 跟 FFHQ 對齊是幾何相似的:
    雙眼間距   FFHQ 255px : UV 126px = 0.494
    眼→嘴距離  FFHQ 300px : UV 152px = 0.507
兩個比例一致,所以只要縮放 + 平移就能對上,不需要做網格變形。

眼睛和嘴巴內部**保留原貼圖**:模型的眼球和牙齒是獨立的網格,貼一張畫著眼白虹膜的
照片上去會變成雙重眼睛。

  python3 tools/swap_face.py --glb <某個_avaturn_或_metaperson_匯出>.glb \
      --face faces/f7.jpg --out public/models/avatar_new.glb --preview /tmp/cmp.png
"""
import argparse, io, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from age_texture import (read_glb, write_glb, find_base_color_image, replace_image,
                         load_generator, age_face)

# 1024x1024 下量測到的五官位置
FFHQ_EYE_MID, FFHQ_EYE_DIST, FFHQ_MOUTH_Y = (517.0, 480.0), 255.0, 780.0
UV_EYE_MID,   UV_EYE_DIST,   UV_MOUTH_Y   = (515.0, 368.0), 126.0, 520.0


def ellipse(h, w, cx, cy, rx, ry, feather):
    yy, xx = np.mgrid[0:h, 0:w]
    m = np.clip(1.6 - (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 0.9, 0, 1)
    return gaussian_filter(m, feather)


def build_mask(h, w, s, keep_eyes, keep_mouth):
    """臉部橢圓,再把眼睛(和選擇性的嘴巴)挖掉 —— 那些地方由獨立網格負責。
    橢圓要夠窄:來源照片的頭髮、耳環就在臉的兩側,寬一點就會被一起貼進來。"""
    cx, cy = UV_EYE_MID[0] * s, (UV_EYE_MID[1] + 70) * s          # 橢圓中心比眼睛略低
    m = ellipse(h, w, cx, cy, 104 * s, 158 * s, 18 * s)
    if keep_eyes:
        for sign in (-1, 1):
            ex = (UV_EYE_MID[0] + sign * UV_EYE_DIST / 2) * s
            m *= 1 - ellipse(h, w, ex, UV_EYE_MID[1] * s, 46 * s, 26 * s, 7 * s)
    if keep_mouth:
        m *= 1 - ellipse(h, w, UV_EYE_MID[0] * s, UV_MOUTH_Y * s, 52 * s, 24 * s, 7 * s)
    return np.clip(m, 0, 1)


def harmonize(src, dst, sigma, valid):
    """頻率分離:取來源臉的中高頻(五官細節=身分),低頻(膚色、光影)用原貼圖的。

    直接貼會留下一圈色差明顯的橢圓,因為頭皮、耳朵、脖子、身體都還是原本那個人的膚色。
    用全域 mean/std 對齊會讓整張臉泛白;只換細節則接縫完全消失,而且臉還是換掉的那個人
    ——五官辨識度落在中高頻,低頻其實只是膚色跟打光。

    valid 是「貼上去那塊照片」的範圍。低通一定要用**正規化卷積**只吃 valid 內的像素:
    sigma 60 的核半徑約 180px,直接對整張畫布做的話會跨過照片方框的邊界、把外面的原貼圖
    混進來,產生不連續,減掉之後就在臉上露出一條方框邊(3D 裡看得非常清楚)。"""
    w = valid[..., None] if valid.ndim == 2 else valid
    num = gaussian_filter(src * w, (sigma, sigma, 0))
    den = gaussian_filter(w.repeat(3, axis=2) if w.shape[2] == 1 else w, (sigma, sigma, 0))
    lo_src = num / np.maximum(den, 1e-6)
    lo_dst = gaussian_filter(dst, (sigma, sigma, 0))
    return (src - lo_src + lo_dst).clip(0, 255)


def age_photo(pil, strength):
    """在 FFHQ 對齊的照片上做老化 —— GAN 就是在這種圖上訓練的,比在 UV 貼圖上做乾淨。
    一樣只取 delta,並用橢圓遮罩擋住背景與頭髮。"""
    import torch
    dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
    a = np.asarray(pil, np.float32)
    aged = age_face(load_generator(dev), dev, a, 1)
    delta = gaussian_filter(aged - a, (1.5, 1.5, 0))
    lum = delta.mean(axis=2, keepdims=True)
    delta = lum * strength + (delta - lum) * min(strength, 1.5)
    h, w = a.shape[:2]
    m = ellipse(h, w, w * 0.5, h * 0.55, w * 0.30, h * 0.38, w * 0.03)[..., None]
    return Image.fromarray((a + delta * m).clip(0, 255).astype(np.uint8))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--glb', required=True)
    p.add_argument('--face', required=True, help='FFHQ 對齊的人臉照片(1024x1024)')
    p.add_argument('--out', required=True)
    p.add_argument('--material', default='Head')
    p.add_argument('--blend', type=float, default=1.0, help='換臉強度 0..1')
    p.add_argument('--age', type=float, default=0,
                   help='換臉前先把來源照片老化。1.5≈+15歲 2.8≈+30歲。'
                        '在照片上做比在 UV 貼圖上做好,因為那才是 GAN 的訓練域')
    p.add_argument('--match', type=float, default=1.0, help='膚色接合強度 0..1')
    p.add_argument('--sigma', type=float, default=60.0,
                   help='頻率分離的低頻半徑(1024 貼圖的 px)。調小=更像原本的人,調大=更像來源臉')
    p.add_argument('--open-eyes', action='store_true', help='連眼睛一起換(通常會變成雙重眼睛)')
    p.add_argument('--keep-mouth', action='store_true',
                   help='嘴巴保留原貼圖。預設是換的 —— 嘴唇屬於身分特徵,牙齒舌頭是獨立網格不會衝突')
    p.add_argument('--preview')
    a = p.parse_args()

    js, bin_ = read_glb(a.glb)
    idx = find_base_color_image(js, a.material)
    bv = js['bufferViews'][js['images'][idx]['bufferView']]
    raw = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
    tex = Image.open(io.BytesIO(raw)).convert('RGB')
    W, H = tex.size
    s = W / 1024.0
    print(f'{a.material} baseColor: {W}x{H}')

    # 縮放來源臉,讓它的雙眼中心落在貼圖的雙眼中心上
    face = Image.open(a.face).convert('RGB')
    if face.size != (1024, 1024):
        face = face.resize((1024, 1024), Image.LANCZOS)
    if a.age > 0:
        face = age_photo(face, a.age)
        print(f'來源照片先老化 strength {a.age}')
    k = (UV_EYE_DIST / FFHQ_EYE_DIST) * s
    fw = int(round(1024 * k))
    face = face.resize((fw, fw), Image.LANCZOS)
    ox = int(round(UV_EYE_MID[0] * s - FFHQ_EYE_MID[0] * k))
    oy = int(round(UV_EYE_MID[1] * s - FFHQ_EYE_MID[1] * k))
    print(f'縮放 {k:.3f} → {fw}px,貼在 ({ox}, {oy})')

    canvas = Image.new('RGB', (W, H))
    canvas.paste(tex, (0, 0))            # 沒被遮罩覆蓋的地方保持原貼圖
    canvas.paste(face, (ox, oy))
    src = np.asarray(canvas, np.float32)
    dst = np.asarray(tex, np.float32)
    valid = np.zeros((H, W), np.float32)                     # 照片實際覆蓋的方框
    valid[max(oy,0):min(oy+fw,H), max(ox,0):min(ox+fw,W)] = 1

    mask = build_mask(H, W, s, not a.open_eyes, a.keep_mouth)[..., None]
    if a.match > 0:
        src = src * (1 - a.match) + harmonize(src, dst, a.sigma * s, valid) * a.match
    out = (dst * (1 - mask * a.blend) + src * (mask * a.blend)).clip(0, 255).astype(np.uint8)
    new_tex = Image.fromarray(out)

    if a.preview:
        vis = Image.new('RGB', (W * 3, H))
        vis.paste(tex, (0, 0))
        vis.paste(Image.fromarray((np.asarray(canvas, np.float32) * mask).astype(np.uint8)), (W, 0))
        vis.paste(new_tex, (W * 2, 0))
        vis.save(a.preview); print('比較圖(原貼圖 | 遮罩後的新臉 | 合成)→', a.preview)

    buf = io.BytesIO(); new_tex.save(buf, format='JPEG', quality=92, subsampling=0)
    write_glb(a.out, js, replace_image(js, bin_, idx, buf.getvalue(), 'image/jpeg'))
    print(f'{a.out}  {os.path.getsize(a.out)/1048576:.1f} MB')


if __name__ == '__main__':
    main()
