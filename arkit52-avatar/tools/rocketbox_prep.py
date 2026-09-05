#!/usr/bin/env python3
"""下載 Microsoft Rocketbox 的 avatar 並轉成 web 可用的形式。

Rocketbox(MIT 授權,115 個綁定好的角色)的資產有兩個問題不能直接餵給瀏覽器:
  1. 貼圖是未壓縮 TGA,每張 12MB —— 瀏覽器不支援,而且太大
  2. FBX 裡寫的是作者當年的 Windows 絕對路徑(D:\\temp\\Humans\\...)
第 1 點在這裡解決(轉 JPEG/PNG),第 2 點由 viewer 端的 URL 改寫處理。

  python3 tools/rocketbox_prep.py --avatar Business_Male_02
  python3 tools/rocketbox_prep.py --avatar Male_Adult_09 --category Adults
"""
import argparse, io, json, os, sys, urllib.request
from PIL import Image

RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars'
API = 'https://api.github.com/repos/microsoft/Microsoft-Rocketbox/contents/Assets/Avatars'


def fetch(url, timeout=900):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--avatar', required=True, help='例如 Business_Male_02')
    p.add_argument('--category', default='Professions', choices=['Professions', 'Adults', 'Children'])
    p.add_argument('--out', default='public/models/rocketbox')
    p.add_argument('--quality', type=int, default=92)
    p.add_argument('--max-size', type=int, default=2048, help='貼圖邊長上限')
    p.add_argument('--skip-normal', action='store_true', help='不要法線貼圖(省一半流量)')
    a = p.parse_args()

    base = f'{RAW}/{a.category}/{a.avatar}'
    dst = os.path.join(a.out, a.avatar)
    os.makedirs(dst, exist_ok=True)

    fbx_name = f'{a.avatar}_facial.fbx'          # facial 版才有 175 個 blendshapes
    fbx_path = os.path.join(dst, fbx_name)
    if not os.path.exists(fbx_path):
        print(f'下載 {fbx_name} …', flush=True)
        open(fbx_path, 'wb').write(fetch(f'{base}/Export/{fbx_name}'))
    print(f'  {fbx_name}  {os.path.getsize(fbx_path)/1048576:.1f} MB')

    listing = json.loads(fetch(f'{API}/{a.category}/{a.avatar}/Textures', timeout=120))
    texes = [x['name'] for x in listing if x['name'].lower().endswith('.tga')]
    if a.skip_normal:
        texes = [t for t in texes if '_normal' not in t.lower()]

    total_in = total_out = 0
    for t in texes:
        stem = t[:-4]
        # 先看目的檔在不在,避免重跑時重抓 12MB
        done = [e for e in ('.jpg', '.png') if os.path.exists(os.path.join(dst, stem + e))]
        if done:
            print(f'  {stem+done[0]:<28} 已存在,略過')
            continue
        print(f'下載 {t} …', flush=True)
        raw = fetch(f'{base}/Textures/{t}')
        im = Image.open(io.BytesIO(raw)); im.load()
        if max(im.size) > a.max_size:
            im = im.resize((min(im.width, a.max_size), min(im.height, a.max_size)), Image.LANCZOS)
        # 有真的透明度才留 PNG(髮絲、睫毛的 alpha 一定要保),其餘一律 JPEG
        alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 250
        if alpha:
            out = os.path.join(dst, stem + '.png'); im.save(out, optimize=True)
        else:
            out = os.path.join(dst, stem + '.jpg')
            im.convert('RGB').save(out, quality=a.quality, subsampling=0)
        total_in += len(raw); total_out += os.path.getsize(out)
        print(f'  {os.path.basename(out):<28} {im.width}x{im.height} '
              f'{len(raw)/1048576:5.1f} MB → {os.path.getsize(out)/1048576:5.2f} MB'
              f'{"  (含 alpha)" if alpha else ""}')

    # viewer 端要靠這份清單才知道某張貼圖被轉成 jpg 還是 png(有 alpha 的才留 png)
    manifest = {}
    for f in sorted(os.listdir(dst)):
        stem, ext = os.path.splitext(f)
        if ext.lower() in ('.jpg', '.png'):
            manifest[stem] = ext.lower().lstrip('.')
    fbx = next((f for f in os.listdir(dst) if f.lower().endswith('.fbx')), None)
    json.dump({'fbx': fbx, 'textures': manifest},
              open(os.path.join(dst, 'textures.json'), 'w'), indent=2)
    print(f'  textures.json  {len(manifest)} 張')

    if total_in:
        print(f'\n貼圖總計 {total_in/1048576:.0f} MB → {total_out/1048576:.1f} MB')
    print(f'輸出目錄 {dst}')


if __name__ == '__main__':
    main()
