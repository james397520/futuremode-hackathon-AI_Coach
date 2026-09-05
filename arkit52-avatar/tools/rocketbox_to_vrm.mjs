// Rocketbox FBX → VRM 1.0
//
// 沒有 Blender,所以走 three.js:FBXLoader 讀進來 → GLTFExporter 匯出 GLB → 注入
// VRMC_vrm 擴充。GLTFExporter 在 Node 裡處理貼圖需要 canvas(document / OffscreenCanvas
// 都沒有),所以先把材質上的貼圖拿掉,匯出後再把檔案位元組直接塞進 GLB 當內嵌圖片。
//
//   node tools/rocketbox_to_vrm.mjs Business_Male_02 [ageTag]
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FBXLoader } from '../public/vendor/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from '../public/vendor/jsm/exporters/GLTFExporter.js';

globalThis.ProgressEvent ??= class { constructor(t, i = {}) { this.type = t; Object.assign(this, i); } };
// GLTFExporter 的 GLB 輸出用 FileReader 把 Blob 讀成 ArrayBuffer,Node 沒有這個 API。
// 只有 readAsArrayBuffer / result / onloadend 三個成員會被用到。
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(b => { this.result = b; this.onloadend && this.onloadend(); });
  }
};

// 專案路徑含中文,URL 會被百分比編碼,一定要用 fileURLToPath 還原
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const ageTag = process.argv[3] || null;
if (!name) { console.error('用法: node tools/rocketbox_to_vrm.mjs <avatar> [ageTag]'); process.exit(1); }
const DIR = path.join(ROOT, 'public/models/rocketbox', name);
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'textures.json'), 'utf8'));

// ---------- 1. 讀 FBX,記下每個材質原本用哪張貼圖 ----------
const fbxFile = fs.readdirSync(DIR).find(f => f.endsWith('.fbx'));
const buf = fs.readFileSync(path.join(DIR, fbxFile));
const wanted = new Map();          // 材質名 → { map, normalMap, ... } → 貼圖檔名
const manager = new THREE.LoadingManager();
let pending = null;
manager.addHandler(/\.tga$/i, {
  path: '', setPath() { return this; },
  load(url) {
    const base = url.split(/[\\/]/).pop().replace(/\.tga$/i, '');
    const t = new THREE.Texture();
    t.userData.file = base;        // 匯出後再依這個把檔案接回去
    return t;
  },
});
const scene = new FBXLoader(manager).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');

const SLOTS = ['map', 'normalMap', 'specularMap', 'alphaMap'];
scene.traverse(o => {
  const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
  for (const m of ms) {
    if (!m) continue;
    const rec = {};
    for (const s of SLOTS) if (m[s] && m[s].userData.file) { rec[s] = m[s].userData.file; m[s] = null; }
    if (Object.keys(rec).length) wanted.set(m.name, rec);
    m.needsUpdate = true;
  }
});
console.log(`${name}: 材質 ${wanted.size} 個,貼圖引用`,
  [...wanted.entries()].map(([k, v]) => `${k}(${Object.keys(v).length})`).join(' '));

// ---------- 2. 只留下真正會用到的 morph target ----------
// 175 個全帶會讓 GLB 爆到數十 MB(每個 target 都是整份頂點位移)。
// VRM 只需要 ARKit 52(表情/口型的來源)加上 15 個 viseme。
const KEEP = /(?:^|\.)(AK_\d+_|AA_VI_)/;
let morphInfo = null;
scene.traverse(o => {
  const dict = o.morphTargetDictionary;
  if (!dict || !o.geometry) return;
  const keys = Object.keys(dict);
  const keep = keys.filter(k => KEEP.test(k));
  const idx = keep.map(k => dict[k]);
  const attrs = o.geometry.morphAttributes;
  for (const kind of Object.keys(attrs)) attrs[kind] = idx.map(i => attrs[kind][i]);
  o.morphTargetInfluences = keep.map(() => 0);
  o.morphTargetDictionary = Object.fromEntries(keep.map((k, i) => [k, i]));
  o.geometry.userData.targetNames = keep;
  morphInfo = { mesh: o, names: keep };
  console.log(`  morph ${keys.length} → 保留 ${keep.length}`);
});

// ---------- 3. 單位與朝向 ----------
scene.scale.setScalar(0.01);                  // Rocketbox 是公分,VRM 用公尺
scene.updateMatrixWorld(true);
const find = k => { let r = null; scene.traverse(o => { if (!r && o.isBone && rigKeyOf(o.name) === k) r = o; }); return r; };
function rigKeyOf(n) {
  const m = /^Bip\d*_(?:([LR])_)?(.+)$/i.exec(n || '');
  if (!m) return n;
  const side = m[1] ? (m[1].toUpperCase() === 'L' ? 'Left' : 'Right') : '';
  const P = { Pelvis:'Hips', Spine:'Spine', Spine1:'Spine1', Spine2:'Spine2', Neck:'Neck', Head:'Head',
    Clavicle:'Shoulder', UpperArm:'Arm', Forearm:'ForeArm', Hand:'Hand',
    Thigh:'UpLeg', Calf:'Leg', Foot:'Foot', Toe0:'ToeBase' };
  const p = P[m[2]];
  if (!p) return n;
  return ['Hips','Spine','Spine1','Spine2','Neck','Head'].includes(p) ? p : side + p;
}
{ // VRM 1.0 規定角色面向 +Z。用腳踝→腳趾的方向判斷目前朝哪邊,不對就轉 180°
  const foot = find('LeftFoot'), toe = find('LeftToeBase');
  if (foot && toe) {
    const d = toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()));
    console.log(`  朝向偵測(腳踝→腳趾) z=${d.z.toFixed(3)}`);
    if (d.z < 0) { scene.rotation.y = Math.PI; scene.updateMatrixWorld(true); console.log('  轉 180° 讓角色面向 +Z'); }
  }
}

// ---------- 4. 匯出 GLB ----------
const glb = await new Promise((res, rej) =>
  new GLTFExporter().parse(scene, res, rej, { binary: true, onlyVisible: false }));
console.log(`GLTFExporter 輸出 ${(glb.byteLength / 1048576).toFixed(1)} MB`);

const stem = `${name}${ageTag ? '_' + ageTag : ''}`;
fs.writeFileSync(path.join(ROOT, 'public/models', `${stem}.raw.glb`), Buffer.from(glb));

// 貼圖是在匯出前拿掉的,把「哪個材質要接哪個檔」寫成 sidecar 交給下一步內嵌。
// ageTag 有值時臉與髮片換成該年齡的版本。
const sidecar = {};
for (const [mat, slots] of wanted) {
  sidecar[mat] = {};
  for (const [slot, base] of Object.entries(slots)) {
    let b = base;
    if (ageTag && manifest.textures[`${base}_${ageTag}`]) b = `${base}_${ageTag}`;
    sidecar[mat][slot] = `${b}.${manifest.textures[b] || 'jpg'}`;
  }
}
fs.writeFileSync(path.join(ROOT, 'public/models', `${stem}.textures.json`),
  JSON.stringify({ avatar: name, dir: `rocketbox/${name}`, materials: sidecar }, null, 2));
console.log('貼圖對應表:', JSON.stringify(sidecar));
