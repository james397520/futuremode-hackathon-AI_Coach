#!/usr/bin/env python3
"""把 rocketbox_to_vrm.mjs 匯出的 raw GLB 補成完整的 .vrm(VRM 1.0)。

分兩步是因為 GLTFExporter 在 Node 裡處理貼圖需要 canvas(沒有 DOM 就會炸),所以
匯出時先把貼圖拿掉,在這裡把檔案位元組直接塞進 GLB 當內嵌圖片,再補上 VRMC_vrm。

  python3 tools/vrm_finalize.py --raw public/models/Business_Male_02.raw.glb \
      --out public/models/Business_Male_02.vrm --name "王先生・30"
"""
import argparse, json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from age_texture import read_glb, write_glb

# Biped → Mixamo 慣例 → VRM humanoid(與 loadMixamoAnimation.js 的 rigKey 同一套規則)
BIPED_PART = {'Pelvis':'Hips','Spine':'Spine','Spine1':'Spine1','Spine2':'Spine2','Neck':'Neck',
              'Head':'Head','Clavicle':'Shoulder','UpperArm':'Arm','Forearm':'ForeArm','Hand':'Hand',
              'Thigh':'UpLeg','Calf':'Leg','Foot':'Foot','Toe0':'ToeBase'}
CENTER = {'Hips','Spine','Spine1','Spine2','Neck','Head'}
FINGERS = ['Thumb','Index','Middle','Ring','Pinky']
MIXAMO_TO_VRM = {
    'Hips':'hips','Spine':'spine','Spine1':'chest','Spine2':'upperChest','Neck':'neck','Head':'head',
}
for side in ('Left','Right'):
    lo = side.lower()
    MIXAMO_TO_VRM.update({
        f'{side}Shoulder': f'{lo}Shoulder', f'{side}Arm': f'{lo}UpperArm',
        f'{side}ForeArm': f'{lo}LowerArm', f'{side}Hand': f'{lo}Hand',
        f'{side}UpLeg': f'{lo}UpperLeg', f'{side}Leg': f'{lo}LowerLeg',
        f'{side}Foot': f'{lo}Foot', f'{side}ToeBase': f'{lo}Toes',
    })
    for fin, vname in zip(FINGERS, ['Thumb','Index','Middle','Ring','Little']):
        joints = ['Metacarpal','Proximal','Distal'] if fin == 'Thumb' else ['Proximal','Intermediate','Distal']
        for i, j in enumerate(joints, 1):
            MIXAMO_TO_VRM[f'{side}Hand{fin}{i}'] = f'{lo}{vname}{j}'

REQUIRED = ['hips','spine','head','leftUpperArm','leftLowerArm','leftHand','rightUpperArm',
            'rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot',
            'rightUpperLeg','rightLowerLeg','rightFoot']


def rig_key(name):
    m = re.match(r'^Bip\d*_(?:([LR])_)?(.+)$', name or '', re.I)
    if not m: return name
    side = '' if not m.group(1) else ('Left' if m.group(1).upper() == 'L' else 'Right')
    f = re.match(r'^Finger(\d)(\d)?$', m.group(2), re.I)
    if f:
        idx = int(f.group(1))
        if idx >= len(FINGERS): return name
        return f'{side}Hand{FINGERS[idx]}{int(f.group(2)) + 1 if f.group(2) else 1}'
    part = BIPED_PART.get(m.group(2))
    if not part: return name
    return part if part in CENTER else side + part


# VRM 表情 → 要疊加哪些 morph。Rocketbox 的 AA_VI_* 是現成的 viseme,口型直接用它們比
# 從 ARKit 湊準確;情緒則由 ARKit 的 AK_* 組出來。
EXPRESSIONS = {
    'aa': [('AA_VI_10_aa', 1.0)], 'ih': [('AA_VI_12_I', 1.0)], 'ou': [('AA_VI_14_U', 1.0)],
    'ee': [('AA_VI_11_E', 1.0)],  'oh': [('AA_VI_13_O', 1.0)],
    'blink':      [('EyeBlinkLeft', 1.0), ('EyeBlinkRight', 1.0)],
    'blinkLeft':  [('EyeBlinkLeft', 1.0)], 'blinkRight': [('EyeBlinkRight', 1.0)],
    'happy':     [('MouthSmileLeft', 1.0), ('MouthSmileRight', 1.0), ('CheekSquintLeft', .4), ('CheekSquintRight', .4)],
    'angry':     [('BrowDownLeft', 1.0), ('BrowDownRight', 1.0), ('NoseSneerLeft', .5), ('NoseSneerRight', .5)],
    'sad':       [('BrowInnerUp', 1.0), ('MouthFrownLeft', .8), ('MouthFrownRight', .8)],
    'surprised': [('EyeWideLeft', 1.0), ('EyeWideRight', 1.0), ('BrowOuterUpLeft', .7), ('BrowOuterUpRight', .7), ('JawOpen', .4)],
    'relaxed':   [('EyeSquintLeft', .5), ('EyeSquintRight', .5), ('MouthSmileLeft', .3), ('MouthSmileRight', .3)],
    'lookUp':    [('EyeLookUpLeft', 1.0), ('EyeLookUpRight', 1.0)],
    'lookDown':  [('EyeLookDownLeft', 1.0), ('EyeLookDownRight', 1.0)],
    'lookLeft':  [('EyeLookOutLeft', 1.0), ('EyeLookInRight', 1.0)],
    'lookRight': [('EyeLookInLeft', 1.0), ('EyeLookOutRight', 1.0)],
}
MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png'}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--raw', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--name', required=True)
    a = p.parse_args()

    js, bin_ = read_glb(a.raw)
    side = json.load(open(a.raw.replace('.raw.glb', '.textures.json')))
    tex_dir = os.path.join(os.path.dirname(a.raw), side['dir'])

    # ---------- 內嵌貼圖 ----------
    new_bin = bytearray(bin_)
    def add_view(data):
        while len(new_bin) % 4: new_bin.append(0)
        js['bufferViews'].append({'buffer': 0, 'byteOffset': len(new_bin), 'byteLength': len(data)})
        new_bin.extend(data)
        return len(js['bufferViews']) - 1

    js.setdefault('images', []); js.setdefault('textures', []); js.setdefault('samplers', [])
    if not js['samplers']:
        js['samplers'].append({'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497})
    cache = {}
    def tex_index(fname):
        if fname in cache: return cache[fname]
        raw = open(os.path.join(tex_dir, fname), 'rb').read()
        js['images'].append({'name': fname, 'mimeType': MIME[os.path.splitext(fname)[1].lower()],
                             'bufferView': add_view(raw)})
        js['textures'].append({'sampler': 0, 'source': len(js['images']) - 1})
        cache[fname] = len(js['textures']) - 1
        return cache[fname]

    for mat in js.get('materials', []):
        rec = side['materials'].get(mat.get('name'))
        if not rec: continue
        pbr = mat.setdefault('pbrMetallicRoughness', {})
        if 'map' in rec:
            pbr['baseColorTexture'] = {'index': tex_index(rec['map'])}
            pbr.setdefault('baseColorFactor', [1, 1, 1, 1])
        if 'normalMap' in rec:
            mat['normalTexture'] = {'index': tex_index(rec['normalMap'])}
        if 'alphaMap' in rec:               # 髮絲/睫毛:鏤空而不是半透明,排序才不會亂
            mat['alphaMode'] = 'MASK'; mat['alphaCutoff'] = 0.4; mat['doubleSided'] = True
        pbr.setdefault('metallicFactor', 0.0)
        pbr.setdefault('roughnessFactor', 0.85)
    print(f'內嵌貼圖 {len(cache)} 張 ({sum(len(open(os.path.join(tex_dir,f),"rb").read()) for f in cache)/1048576:.1f} MB)')

    # ---------- humanoid ----------
    nodes = js['nodes']
    by_name = {n.get('name'): i for i, n in enumerate(nodes)}
    human = {}
    for nm, i in by_name.items():
        vrm_bone = MIXAMO_TO_VRM.get(rig_key(nm or ''))
        if vrm_bone and vrm_bone not in human:
            human[vrm_bone] = {'node': i}
    missing = [b for b in REQUIRED if b not in human]
    if missing: raise SystemExit(f'缺少 VRM 必要骨骼: {missing}')
    print(f'humanoid 對應 {len(human)} 根(必要的 {len(REQUIRED)} 根全部到齊)')

    # ---------- 表情 ----------
    mesh_node = next((i for i, n in enumerate(nodes) if 'mesh' in n), None)
    target_names = js['meshes'][nodes[mesh_node]['mesh']].get('extras', {}).get('targetNames', [])
    short = {re.sub(r'^blendShape1\.', '', t): i for i, t in enumerate(target_names)}
    def find_target(key):
        if key in short: return short[key]
        for s, i in short.items():                      # AK_45_MouthSmileLeft 用尾綴比對
            if re.search(r'(?:^|_)' + re.escape(key) + r'$', s, re.I): return i
        return None
    presets, skipped = {}, []
    for name, binds in EXPRESSIONS.items():
        got = [{'node': mesh_node, 'index': i, 'weight': w}
               for key, w in binds if (i := find_target(key)) is not None]
        if got: presets[name] = {'morphTargetBinds': got, 'isBinary': False}
        else: skipped.append(name)
    print(f'表情 {len(presets)} 個' + (f',湊不出來的: {skipped}' if skipped else ''))

    js.setdefault('extensionsUsed', [])
    if 'VRMC_vrm' not in js['extensionsUsed']: js['extensionsUsed'].append('VRMC_vrm')
    js.setdefault('extensions', {})['VRMC_vrm'] = {
        'specVersion': '1.0',
        'meta': {
            'name': a.name, 'version': '1', 'authors': ['Microsoft Rocketbox'],
            # three-vrm 的 VRMMetaLoaderPlugin 預設只接受這個網址,填別的會直接 throw
            # 讓整個模型載不進去。素材本身的 MIT 出處放 thirdPartyLicenses。
            'licenseUrl': 'https://vrm.dev/licenses/1.0/',
            'otherLicenseUrl': 'https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md',
            'copyrightInformation': 'Microsoft Rocketbox, MIT License',
            'thirdPartyLicenses': 'Microsoft Rocketbox (MIT) — '
                                  'https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md',
            'avatarPermission': 'everyone', 'commercialUsage': 'corporation',
            'creditNotation': 'unnecessary', 'allowRedistribution': True, 'modification': 'allowModification',
            'allowExcessivelyViolentUsage': False, 'allowExcessivelySexualUsage': False,
            'allowPoliticalOrReligiousUsage': False, 'allowAntisocialOrHateUsage': False,
        },
        'humanoid': {'humanBones': human},
        'firstPerson': {'meshAnnotations': [{'node': mesh_node, 'type': 'auto'}]},
        'lookAt': {'type': 'bone', 'offsetFromHeadBone': [0, 0.06, 0]},
        'expressions': {'preset': presets},
    }
    js['buffers'] = [{'byteLength': len(new_bin)}]
    write_glb(a.out, js, bytes(new_bin))
    print(f'{a.out}  {os.path.getsize(a.out)/1048576:.1f} MB')


if __name__ == '__main__':
    main()
