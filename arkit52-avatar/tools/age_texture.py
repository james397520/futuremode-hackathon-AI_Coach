#!/usr/bin/env python3
"""把 GLB 角色的臉部貼圖老化,輸出成新的 GLB。

寫實角色(Avaturn / MetaPerson)的 Head baseColor 貼圖是接近正臉的 UV 展開,
所以可以直接裁臉部區域餵給老化 GAN,不需要渲染 + 反投影那一整套。

做法是「只取 delta」:aged - original 才是老化特徵(皺紋、斑點、膚色變化),
把它經過羽化遮罩疊回原貼圖,原本的膚色、五官、光影全部保留。整張換掉會變成
貼了另一個人的臉。

  python3 tools/age_texture.py --image public/models/rocketbox/<角色>/<前綴>_head_color.jpg \
      --crop 0.30 0.089 0.704 0.492 --strength 2.5 --hair-gray 0.5 --out <前綴>_head_color_50.jpg
  (整套年齡貼圖建議直接用 tools/rocketbox_age.py)

強度大致對應:1.5 ≈ 40 代、2.5 ≈ 55-60、4.0 ≈ 70+(再高會出現色塊)。
"""
import argparse, io, json, os, struct, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'vendor', 'fast_aging_gan'))

# Avaturn / MetaPerson 頭部 UV 的臉部位置(1024x1024 貼圖的比例座標)。
# 這批模型共用同一套 UV,所以可以寫死;換其他來源的模型用 --crop 覆蓋。
DEFAULT_CROP = (0.246, 0.166, 0.754, 0.674)


def read_glb(path):
    d = open(path, 'rb').read()
    if d[:4] != b'glTF':
        raise SystemExit(f'{path} 不是 GLB')
    off, js, bin_ = 12, None, b''
    while off < len(d):
        ln, ty = struct.unpack('<II', d[off:off + 8]); off += 8
        chunk = d[off:off + ln]; off += ln
        if ty == 0x4E4F534A: js = json.loads(chunk.decode('utf-8'))
        elif ty == 0x004E4942: bin_ = chunk
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bin_ + b'\x00' * ((4 - len(bin_) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bb) if bb else 0)
    out = struct.pack('<III', 0x46546C67, 2, total)
    out += struct.pack('<II', len(jb), 0x4E4F534A) + jb
    if bb: out += struct.pack('<II', len(bb), 0x004E4942) + bb
    open(path, 'wb').write(out)


def find_base_color_image(js, material_name):
    for m in js.get('materials', []):
        if m.get('name') == material_name:
            bc = m.get('pbrMetallicRoughness', {}).get('baseColorTexture')
            if not bc: raise SystemExit(f'材質「{material_name}」沒有 baseColorTexture')
            return js['textures'][bc['index']]['source']
    raise SystemExit(f'找不到材質「{material_name}」。有的是:' +
                     ', '.join(m.get('name', '?') for m in js.get('materials', [])))


def replace_image(js, bin_, image_index, new_bytes, mime):
    """換掉一張貼圖後重排整個 BIN chunk —— 新舊長度不同,後面所有 bufferView 的
    byteOffset 都會位移,所以整批重新打包而不是就地改。"""
    new_bin = bytearray()
    target_bv = js['images'][image_index]['bufferView']
    for i, bv in enumerate(js['bufferViews']):
        data = new_bytes if i == target_bv else \
            bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        while len(new_bin) % 4: new_bin.append(0)
        bv['byteOffset'] = len(new_bin)
        bv['byteLength'] = len(data)
        new_bin += data
    js['images'][image_index]['mimeType'] = mime
    js['buffers'] = [{'byteLength': len(new_bin)}]
    return bytes(new_bin)


def load_generator(device):
    import torch
    from models import Generator
    g = Generator(ngf=32, n_residual_blocks=9)
    g.load_state_dict(torch.load(os.path.join(HERE, 'vendor', 'fast_aging_gan', 'state_dict.pth'),
                                 map_location='cpu'))
    return g.eval().to(device)


def age_face(gen, device, rgb, passes):
    """產生器有兩層 stride-2 下採樣,輸入邊長不是 4 的倍數時轉置卷積會吐回不同尺寸,
    所以先反射補邊到 4 的倍數,算完再切回原尺寸。"""
    import torch
    h, w = rgb.shape[:2]
    ph, pw = (-h) % 4, (-w) % 4
    if ph or pw:
        rgb = np.pad(rgb, ((0, ph), (0, pw), (0, 0)), mode='reflect')
    x = torch.from_numpy(rgb / 127.5 - 1.0).permute(2, 0, 1)[None].to(device)
    with torch.no_grad():
        for _ in range(passes): x = gen(x)
    out = ((x[0].permute(1, 2, 0).cpu().numpy() + 1.0) * 127.5).clip(0, 255)
    return out[:h, :w]


def feathered_face_mask(h, w):
    """羽化橢圓:只在真正的臉上套老化。GAN 會把高頻紋理灑滿整張裁切區,
    沒有遮罩的話額頭上方的頭皮會佈滿雜訊。"""
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy, rx, ry = w * 0.504, h * 0.531, w * 0.254, h * 0.336
    m = np.clip(1.6 - (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 0.9, 0, 1)
    return gaussian_filter(m, min(h, w) * 0.035)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--glb', help='要處理的 GLB(與 --image 二選一)')
    p.add_argument('--image', help='直接處理單張貼圖(Rocketbox 是 FBX + 外部貼圖走這條)')
    p.add_argument('--out', required=True)
    p.add_argument('--hair-gray', type=float, default=0,
                   help='0..1,把臉部遮罩以外的深色像素(烤進貼圖的頭髮)推向灰白')
    p.add_argument('--material', default='Head')
    p.add_argument('--strength', type=float, default=2.5,
                   help='老化強度:1.5≈40代 2.5≈55-60 4.0≈70+')
    p.add_argument('--passes', type=int, default=1, help='GAN 疊代次數,通常 1 就夠')
    p.add_argument('--crop', type=float, nargs=4, metavar=('L', 'T', 'R', 'B'),
                   default=DEFAULT_CROP, help='臉部區域(貼圖比例座標)')
    p.add_argument('--preview', help='另存一張 原圖|老化 的並排比較圖')
    a = p.parse_args()

    import torch
    device = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')

    if not a.glb and not a.image:
        raise SystemExit('要給 --glb 或 --image 其中一個')
    if a.image:
        js = bin_ = None; img_idx = None
        tex = Image.open(a.image).convert('RGB')
        W, H = tex.size
        print(f'{a.image}: {W}x{H}')
    else:
        js, bin_ = read_glb(a.glb)
        img_idx = find_base_color_image(js, a.material)
        bv = js['bufferViews'][js['images'][img_idx]['bufferView']]
        raw = bin_[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        tex = Image.open(io.BytesIO(raw)).convert('RGB')
        W, H = tex.size
        print(f'{a.material} baseColor: {W}x{H}  {len(raw)/1024:.0f} KB')

    box = (int(a.crop[0] * W), int(a.crop[1] * H), int(a.crop[2] * W), int(a.crop[3] * H))
    crop = np.asarray(tex.crop(box), np.float32)
    ch, cw = crop.shape[:2]
    print(f'臉部裁切: {box}  ({cw}x{ch})')

    gen = load_generator(device)
    aged = age_face(gen, device, crop, a.passes)

    # 皺紋是數個 pixel 寬的線條,單點雜訊才是 GAN 的副產物,輕微模糊留前者殺後者
    delta = gaussian_filter(aged - crop, (1.0, 1.0, 0))

    # 亮度(皺紋)和色度(膚色)分開放大:高強度時色度跟著放大會讓臉整片偏橘
    lum = delta.mean(axis=2, keepdims=True)
    chroma = delta - lum
    delta = lum * a.strength + chroma * min(a.strength, 1.5)

    mask = feathered_face_mask(ch, cw)[..., None]
    out_crop = (crop + delta * mask).clip(0, 255).astype(np.uint8)
    inside = (np.abs(out_crop.astype(np.float32) - crop).mean(2) * mask[..., 0]).sum() / mask.sum()
    print(f'臉內平均像素變化: {inside:.1f} / 255')

    new_tex = tex.copy()
    new_tex.paste(Image.fromarray(out_crop), box[:2])

    # 烤進貼圖的頭髮:臉部遮罩之外、亮度低的像素就是頭髮,往灰白推
    if a.hair_gray > 0:
        full = np.asarray(new_tex, np.float32)
        face = np.zeros((H, W), np.float32)
        face[box[1]:box[3], box[0]:box[2]] = mask[..., 0]
        lum = full @ np.array([0.299, 0.587, 0.114], np.float32)
        dark = np.clip((110 - lum) / 70, 0, 1)              # 越暗越算頭髮
        w = (dark * (1 - face) * a.hair_gray)[..., None]
        target = (lum * 0.45 + 132)[..., None]              # 推向淺灰但保留髮絲亮部層次
        full = full * (1 - w) + target * w
        new_tex = Image.fromarray(full.clip(0, 255).astype(np.uint8))
        print(f'頭髮灰白化 {a.hair_gray}')

    if a.preview:
        vis = Image.new('RGB', (W * 2, H))
        vis.paste(tex, (0, 0)); vis.paste(new_tex, (W, 0))
        vis.save(a.preview); print('比較圖 →', a.preview)

    if a.image:
        new_tex.save(a.out, quality=92, subsampling=0)
        print(f'{a.out}  {os.path.getsize(a.out)/1024:.0f} KB')
        return
    buf = io.BytesIO()
    new_tex.save(buf, format='JPEG', quality=92, subsampling=0)
    new_bin = replace_image(js, bin_, img_idx, buf.getvalue(), 'image/jpeg')
    write_glb(a.out, js, new_bin)
    print(f'{a.out}  {os.path.getsize(a.out)/1048576:.1f} MB  (貼圖 {len(raw)/1024:.0f} → {len(buf.getvalue())/1024:.0f} KB)')


if __name__ == '__main__':
    main()
