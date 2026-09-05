// Mixamo 骨架的動作檔 → VRM humanoid 骨架的 retarget。
//
// Mixamo 的骨架命名和 rest pose 都跟 VRM 不同,FBX/GLB 裡的旋轉值是相對 Mixamo 自己的
// bind pose,直接餵給 VRM 骨骼會扭曲。這裡的換算採 pixiv/three-vrm 官方範例
// loadMixamoAnimation.js 的作法:把每根骨頭的旋轉從 Mixamo 的 rest space 換算到
// VRM normalized rest space,再依 VRM 版本處理軸向。
//
// 產生的 clip 綁在 vrm.humanoid 的 normalized bone node 上,所以呼叫端用
// new THREE.AnimationMixer(vrm.scene) 就能直接播。
//
// 支援 .fbx(Mixamo 直接下載的格式)與 .glb(例如 three.js examples 的 Xbot,
// 一個檔內含多個 clip),一律回傳 [{ name, clip }] 陣列。
//
// 目標模型有兩種:
//   VRM        → 走 normalized humanoid 骨架(retargetVRM)
//   一般 GLB   → 若本身就是 Mixamo 骨架(例如 Avaturn 匯出的 Hips/Spine1/LeftArm…),
//                走 retargetDirect,用兩邊實際的 rest 世界旋轉做一般化換算

import * as THREE from 'three';
import { FBXLoader } from './vendor/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';

// key 是去掉前綴後的 Mixamo 骨骼名。Mixamo 官方匯出叫 "mixamorig:Hips"(FBXLoader 與
// GLTFLoader 都會把冒號去掉變成 mixamorigHips),有些重新匯出的版本是 "mixamorig5Hips"
// 或直接就叫 "Hips",所以查表前先用 rigKey() 去前綴。
// 值是 VRM 1.0 的 humanoid bone 名稱;three-vrm 內部會把 VRM 0.x 的舊名對應過來,
// 所以同一份表對兩種版本的模型都適用。
const MIXAMO_TO_VRM = {
  Hips: 'hips',
  Spine: 'spine',
  Spine1: 'chest',
  Spine2: 'upperChest',
  Neck: 'neck',
  Head: 'head',

  LeftShoulder: 'leftShoulder',
  LeftArm: 'leftUpperArm',
  LeftForeArm: 'leftLowerArm',
  LeftHand: 'leftHand',
  LeftHandThumb1: 'leftThumbMetacarpal',
  LeftHandThumb2: 'leftThumbProximal',
  LeftHandThumb3: 'leftThumbDistal',
  LeftHandIndex1: 'leftIndexProximal',
  LeftHandIndex2: 'leftIndexIntermediate',
  LeftHandIndex3: 'leftIndexDistal',
  LeftHandMiddle1: 'leftMiddleProximal',
  LeftHandMiddle2: 'leftMiddleIntermediate',
  LeftHandMiddle3: 'leftMiddleDistal',
  LeftHandRing1: 'leftRingProximal',
  LeftHandRing2: 'leftRingIntermediate',
  LeftHandRing3: 'leftRingDistal',
  LeftHandPinky1: 'leftLittleProximal',
  LeftHandPinky2: 'leftLittleIntermediate',
  LeftHandPinky3: 'leftLittleDistal',
  LeftUpLeg: 'leftUpperLeg',
  LeftLeg: 'leftLowerLeg',
  LeftFoot: 'leftFoot',
  LeftToeBase: 'leftToes',

  RightShoulder: 'rightShoulder',
  RightArm: 'rightUpperArm',
  RightForeArm: 'rightLowerArm',
  RightHand: 'rightHand',
  RightHandThumb1: 'rightThumbMetacarpal',
  RightHandThumb2: 'rightThumbProximal',
  RightHandThumb3: 'rightThumbDistal',
  RightHandIndex1: 'rightIndexProximal',
  RightHandIndex2: 'rightIndexIntermediate',
  RightHandIndex3: 'rightIndexDistal',
  RightHandMiddle1: 'rightMiddleProximal',
  RightHandMiddle2: 'rightMiddleIntermediate',
  RightHandMiddle3: 'rightMiddleDistal',
  RightHandRing1: 'rightRingProximal',
  RightHandRing2: 'rightRingIntermediate',
  RightHandRing3: 'rightRingDistal',
  RightHandPinky1: 'rightLittleProximal',
  RightHandPinky2: 'rightLittleIntermediate',
  RightHandPinky3: 'rightLittleDistal',
  RightUpLeg: 'rightUpperLeg',
  RightLeg: 'rightLowerLeg',
  RightFoot: 'rightFoot',
  RightToeBase: 'rightToes',
};

// 把各家骨骼命名收斂成同一個 key。目前要處理三種:
//   mixamorigHips / mixamorig5Hips / Hips   Mixamo 自己與其匯出變體
//   Bip01_Pelvis / Bip01_L_UpperArm         3ds Max Biped(Microsoft Rocketbox 用這套)
const BIPED_PART = {
  Pelvis: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2',
  Neck: 'Neck', Head: 'Head',
  Clavicle: 'Shoulder', UpperArm: 'Arm', Forearm: 'ForeArm', Hand: 'Hand',
  Thigh: 'UpLeg', Calf: 'Leg', Foot: 'Foot', Toe0: 'ToeBase',
};
const BIPED_CENTER = new Set(['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);
const BIPED_FINGER = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

// 每根骨頭「指向誰」——用來量測 rest 姿勢的骨骼朝向,做 T-pose/A-pose 校正
const CHILD_OF = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head',
  LeftShoulder: 'LeftArm', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand',
  RightShoulder: 'RightArm', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', LeftFoot: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightFoot', RightFoot: 'RightToeBase',
};
// 手指也要列進來。少了它們手指拿不到 T-pose 校正,會直接吃到兩套骨架手部 rest 姿勢的
// 差異 —— 實測偏差 50-79°,手會蜷成爪狀。掌骨的代表方向用中指。
for (const side of ['Left', 'Right']) {
  CHILD_OF[`${side}Hand`] = `${side}HandMiddle1`;
  for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    CHILD_OF[`${side}Hand${f}1`] = `${side}Hand${f}2`;
    CHILD_OF[`${side}Hand${f}2`] = `${side}Hand${f}3`;
  }
}

export function rigKey(name) {
  const n = String(name || '').replace(/^mixamorig\d*/i, '');
  const m = /^Bip\d*_(?:([LR])_)?(.+)$/i.exec(n);
  if (!m) return n;
  const side = m[1] ? (m[1].toUpperCase() === 'L' ? 'Left' : 'Right') : '';
  // Biped 手指:Finger0 是拇指根、Finger01 第二節、Finger02 指尖
  const f = /^Finger(\d)(\d)?$/i.exec(m[2]);
  if (f) {
    const digit = BIPED_FINGER[+f[1]];
    return digit ? `${side}Hand${digit}${f[2] ? +f[2] + 1 : 1}` : n;
  }
  const part = BIPED_PART[m[2]];
  if (!part) return n;                       // 臉部骨骼(Bip01_MJaw…)不參與身體動作
  return BIPED_CENTER.has(part) ? part : side + part;
}

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

// target 是 VRM 實例,或一般 GLB 模型的根 Object3D。
// filename 只用來判斷格式:拖放進來的檔案 url 是 blob:,副檔名要另外給
export async function loadMixamoClips(url, target, filename = url) {
  if (/\.gl(b|tf)(\?|#|$)/i.test(filename)) {
    const gltf = await gltfLoader.loadAsync(url);
    return buildClips(gltf.scene, gltf.animations, target);
  }
  const asset = await fbxLoader.loadAsync(url);
  return buildClips(asset, asset.animations, target);
}

// 從 ArrayBuffer 直接解 FBX(FBXLoader.parse 是同步的),給沒有 URL 的場合與離線測試用
export function parseMixamoClips(buffer, target) {
  const asset = fbxLoader.parse(buffer, '');
  return buildClips(asset, asset.animations, target);
}

function buildClips(root, clips, target) {
  if (!target) throw new Error('沒有可以套用動作的模型');
  if (!clips || !clips.length) throw new Error('這個檔案裡沒有動畫軌道(FBX 下載時 Format 要選 FBX Binary)');
  const isVrm = !!target.humanoid;
  const out = [];
  for (const clip of clips) {
    if (/^t[-_ ]?pose$/i.test(clip.name)) continue;      // T-pose 是綁定姿勢,不是動作
    const retargeted = isVrm ? retargetVRM(root, clip, target)
                             : retargetDirect(root, clip, target);
    if (retargeted) out.push({ name: clip.name, clip: retargeted });
  }
  if (!out.length) throw new Error('retarget 後沒有任何軌道,來源或目標可能不是 Mixamo 骨架');
  return out;
}

// 目標是一般 GLB(骨骼名本身就是 Mixamo 慣例,例如 Avaturn 匯出)。
// 不能直接套來源的 local 旋轉——兩邊的 bind pose 不保證一致——所以先把旋轉換到世界空間
// 的「相對 rest 的變化量」,再換進目標自己的 rest 空間。全部從實際幾何算,不寫死任何軸向。
// retarget 的所有 rest 量測都假設骨架處於綁定姿勢。但 viewer 會自動播待機動作,
// 使用者點第二個動作時骨架正在半姿勢 —— rest 量到半姿勢,整個 retarget 就毀了
// (實測:凍結在講電話中間再 retarget 揮手,頭的世界旋轉差 64°,頭會埋進胸口)。
// 第一次呼叫時骨架必定是綁定姿勢(模型剛載入),把它快照;之後每次先還原再量。
export function ensureBindPose(root) {
  let snap = root.userData.__bindSnapshot;
  if (!snap) {
    snap = [];
    root.traverse(o => snap.push([o, o.quaternion.clone(), o.position.clone()]));
    root.userData.__bindSnapshot = snap;
  } else {
    for (const [o, q, p] of snap) { o.quaternion.copy(q); o.position.copy(p); }
  }
  root.updateMatrixWorld(true);
}

function retargetDirect(srcRoot, srcClip, tgtRoot) {
  ensureBindPose(tgtRoot);
  const byKey = {};
  tgtRoot.traverse(o => {
    const k = rigKey(o.name || '');
    if (MIXAMO_TO_VRM[k] && !byKey[k]) byKey[k] = o;
  });
  if (!Object.keys(byKey).length) return null;

  const tracks = [];
  const _v = new THREE.Vector3();

  // hips 位移的單位可能差很多(Mixamo FBX 是公分,glTF 通常是公尺)
  let srcHips = null;
  srcRoot.traverse(o => { if (!srcHips && rigKey(o.name || '') === 'Hips') srcHips = o; });
  const tgtHips = byKey.Hips;
  let hipsScale = 1;
  if (srcHips && tgtHips) {
    // 位移軌道是骨骼的 **local** 值,單位是該骨架自己的單位。用世界座標直接比會把
    // 根節點的縮放算進去 —— Rocketbox 載入時根節點縮了 0.01(公分→公尺),但骨骼
    // local 仍是公分,不除掉的話 hips 會被放到 0.9 公分高,整個人癱在地上。
    const srcS = srcRoot.getWorldScale(new THREE.Vector3()).y || 1;
    const tgtS = tgtRoot.getWorldScale(new THREE.Vector3()).y || 1;
    const srcY = Math.abs(srcHips.getWorldPosition(_v).y) / srcS;
    const tgtY = Math.abs(tgtHips.getWorldPosition(_v).y) / tgtS;
    if (srcY > 1e-6) hipsScale = tgtY / srcY;
  }

  // 這裡曾經有一個用兩邊 hips rest 朝向算出來的 align,想拿來補「骨架世界朝向不同」。
  // 那是錯的:hips 的 rest 旋轉描述的是**骨骼軸向慣例**(Biped 的骨盆 rest 是 90°/90°),
  // 不是角色朝哪邊。兩套骨架其實都是 Y-up、面向 +Z,世界座標一致,旋轉差量可以直接搬。
  // 硬套 align 會把身體的「上」轉到 +Z —— 整個人躺平。軸向慣例的差異由下面的虛擬
  // T-pose rest 處理才是對的。

  // T-pose / A-pose 校正。Mixamo 的動作是相對 T-pose 記錄的,直接套到 rest 是 A-pose 的
  // 骨架上,「手臂從 rest 往下轉 45°」會變成「已經垂 45° 再往下 45°」,角度加倍。
  //
  // 做法:**真的把目標骨架擺成來源的 T-pose**,把擺完的世界旋轉記下來當基準,再還原。
  // 關鍵是要依階層順序邊擺邊更新世界矩陣 —— 父骨骼轉了之後子骨骼的世界方向就變了,
  // 各自獨立從原始幾何算校正量會留下約 10° 的殘差(手臂整條被扭轉)。
  const srcByKey = {};
  srcRoot.traverse(o => { const k = rigKey(o.name || ''); if (MIXAMO_TO_VRM[k] && !srcByKey[k]) srcByKey[k] = o; });

  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const _mS = new THREE.Matrix4(), _mT = new THREE.Matrix4(), _mQ = new THREE.Matrix4();
  // 骨骼方向 + 一個全域參考軸 → 完整的正交座標系。只對方向(setFromUnitVectors)是
  // 無扭轉的最小旋轉,骨骼沿自身軸的 roll 不會被對齊。
  function frameOf(dir, axis, out) {
    _x.copy(dir).normalize();
    _y.copy(axis).addScaledVector(_x, -axis.dot(_x));
    if (_y.lengthSq() < 1e-8) return false;
    _y.normalize(); _z.crossVectors(_x, _y);
    out.makeBasis(_x, _y, _z);
    return true;
  }

  const saved = new Map();                       // 原本的 local 旋轉,擺完要還原
  const origWorld = new Map();                   // 原本的世界旋轉(末端骨骼要用它復原)
  const ordered = [];                            // traverse 是父先於子,正好是階層順序
  tgtRoot.traverse(o => { if (byKey[rigKey(o.name || '')] === o) ordered.push(o); });
  tgtRoot.updateMatrixWorld(true);
  for (const node of ordered) {
    saved.set(node, node.quaternion.clone());
    origWorld.set(node, node.getWorldQuaternion(new THREE.Quaternion()));
  }

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  // 寫進 out,不要回傳新向量 —— 之前寫成回傳值再忽略,結果 _a/_b 從頭到尾都沒被賦值
  const dirOf = (n, c, out) => out.copy(c.getWorldPosition(new THREE.Vector3()))
                                  .sub(n.getWorldPosition(new THREE.Vector3()));
  for (const node of ordered) {
    const key = rigKey(node.name), childKey = CHILD_OF[key];
    const tc = childKey && byKey[childKey];
    const sn = srcByKey[key], sc = childKey && srcByKey[childKey];
    if (!tc || !sn || !sc || !node.parent) continue;
    tgtRoot.updateMatrixWorld(true);             // 父骨骼已經擺好了,要重算才拿得到正確方向
    dirOf(node, tc, _a); dirOf(sn, sc, _b);
    if (_a.lengthSq() < 1e-10 || _b.lengthSq() < 1e-10) continue;
    _a.normalize(); _b.normalize();
    let axis = AXES[0], best = 2;
    for (const ax of AXES) { const d = Math.abs(_b.dot(ax)); if (d < best) { best = d; axis = ax; } }
    const Q = (frameOf(_b, axis, _mS) && frameOf(_a, axis, _mT))
      ? new THREE.Quaternion().setFromRotationMatrix(_mQ.copy(_mS).multiply(_mT.transpose()))
      : new THREE.Quaternion().setFromUnitVectors(_a, _b);
    const world = Q.multiply(node.getWorldQuaternion(new THREE.Quaternion()));
    node.quaternion.copy(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  }
  tgtRoot.updateMatrixWorld(true);

  // 沒有子骨骼可當方向參考的骨骼(Head、腳趾、指尖)不該被父骨骼的校正拖走,
  // 把世界朝向轉回原樣。但頭另有一個坑:**Mixamo 的 bind pose 頭本身就前傾 18.8°**
  // (手臂是完美 T-pose,頭不是直的)。動作 delta 是相對那個前傾的頭記錄的,套到頭部
  // 端正的模型上會永遠多 19° 後仰 —— 每個動作、每一格固定偏 19,實測抓到的就是這個。
  // 所以頭的虛擬 rest 要先按來源的 Head→HeadTop_End 方向把「上」對過去。
  const headAlign = new THREE.Quaternion();
  {
    let srcTop = null;
    srcRoot.traverse(o => { if (!srcTop && /HeadTop/i.test(o.name || '')) srcTop = o; });
    const srcHead = srcByKey.Head;
    if (srcTop && srcHead) {
      const u = srcTop.getWorldPosition(new THREE.Vector3())
        .sub(srcHead.getWorldPosition(new THREE.Vector3())).normalize();
      headAlign.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    }
  }
  for (const node of ordered) {
    if (CHILD_OF[rigKey(node.name)] && byKey[CHILD_OF[rigKey(node.name)]]) continue;
    const orig = origWorld.get(node);
    if (!orig || !node.parent) continue;
    const want = rigKey(node.name) === 'Head'
      ? headAlign.clone().multiply(orig)      // 先傾成來源 bind 的頭部角度,delta 才會對齊
      : orig;
    node.quaternion.copy(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(want));
  }
  tgtRoot.updateMatrixWorld(true);

  const virtualRest = new Map();                 // node → T-pose 狀態下的世界旋轉
  tgtRoot.traverse(o => virtualRest.set(o, o.getWorldQuaternion(new THREE.Quaternion())));

  for (const [node, q] of saved) node.quaternion.copy(q);   // 還原,不要留下副作用
  tgtRoot.updateMatrixWorld(true);

  const restOf = node => virtualRest.get(node) || node.getWorldQuaternion(new THREE.Quaternion());

  // ---- 取樣式 retarget ----
  // 原本是逐軌道做四元數代數,那假設「父骨骼在兩邊是同一根」。實測兩套骨架的階層不同:
  //   Rocketbox  LeftShoulder→Neck   LeftUpLeg→Spine
  //   Mixamo     LeftShoulder→Spine2 LeftUpLeg→Hips
  // 手臂於是繼承到脖子的旋轉、腿繼承到脊椎的旋轉,誤差跟這些差異成正比,代數上無解。
  // 改成:播放來源動畫、逐格讀每根骨骼的**世界**姿勢,再換算成目標骨骼的 local 旋轉。
  // 世界空間不管階層長什麼樣,所以階層差異自動被吸收。
  const srcRestInvOf = new Map();                  // 來源骨骼 → rest 世界旋轉的反
  for (const key in srcByKey)
    srcRestInvOf.set(key, srcByKey[key].getWorldQuaternion(new THREE.Quaternion()).invert());
  const srcHipsRest = srcHips ? srcHips.position.clone() : new THREE.Vector3();
  const tgtHipsRest = tgtHips ? tgtHips.position.clone() : new THREE.Vector3();

  const fps = 30;
  const nSamples = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times = new Float32Array(nSamples);
  const values = {};                               // 骨骼 key → Float32Array(4n)
  for (const key in byKey) values[key] = new Float32Array(nSamples * 4);
  const hipsPos = new Float32Array(nSamples * 3);

  // 純旋轉搬移不保證末端位置:Rocketbox 的肩寬 42cm、Mixamo 只有 30cm(臂長幾乎相同),
  // 旋轉全對的情況下拍手兩掌仍會差 12cm 合不起來。所以逐格把目標真的擺出姿勢,
  // 在「來源兩手靠近」時用兩骨 IK 把手拉到相對胸口的同一位置(按臂長換算比例),
  // 兩手分開時維持純旋轉結果 —— 垂手、擺臂這些不該被拉往比較窄的來源肩寬。
  const armLenOf = (r, S, E, H) => {
    const bones = { S, E, H };
    const pos = {};
    for (const k in bones) {
      let n = null;
      if (r === srcRoot) n = srcByKey[bones[k]];
      else n = byKey[bones[k]];
      if (!n) return 0;
      pos[k] = n.getWorldPosition(new THREE.Vector3());
    }
    return pos.S.distanceTo(pos.E) + pos.E.distanceTo(pos.H);
  };
  const srcArmLen = armLenOf(srcRoot, 'LeftArm', 'LeftForeArm', 'LeftHand');
  const tgtArmLen = armLenOf(tgtRoot, 'LeftArm', 'LeftForeArm', 'LeftHand');
  const armScale = srcArmLen > 1e-6 ? tgtArmLen / srcArmLen : 1;
  const canIK = !!(srcArmLen && tgtArmLen &&
    byKey.LeftArm && byKey.LeftForeArm && byKey.LeftHand &&
    byKey.RightArm && byKey.RightForeArm && byKey.RightHand &&
    srcByKey.LeftArm && srcByKey.RightArm && srcByKey.LeftHand && srcByKey.RightHand);

  const wp = o => o.getWorldPosition(new THREE.Vector3());
  const setWorldQuat = (node, q) => {
    node.quaternion.copy(
      node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
  };
  // 兩骨 IK:先把整條手臂轉向目標點,再調手肘彎曲角,最後補一次轉向
  function ikArm(shoulder, elbow, hand, target) {
    for (let pass = 0; pass < 2; pass++) {
      shoulder.updateWorldMatrix(true, true);
      const pS = wp(shoulder), pE = wp(elbow), pH = wp(hand);
      const cur = pH.clone().sub(pS), want = target.clone().sub(pS);
      if (cur.lengthSq() < 1e-10 || want.lengthSq() < 1e-10) return;
      const q = new THREE.Quaternion().setFromUnitVectors(cur.clone().normalize(), want.clone().normalize());
      setWorldQuat(shoulder, q.multiply(shoulder.getWorldQuaternion(new THREE.Quaternion())));
      shoulder.updateWorldMatrix(true, true);
      if (pass === 1) break;
      const pS2 = wp(shoulder), pE2 = wp(elbow), pH2 = wp(hand);
      const L1 = pS2.distanceTo(pE2), L2 = pE2.distanceTo(pH2);
      const d = Math.min(Math.max(target.distanceTo(pS2), Math.abs(L1 - L2) * 1.001), (L1 + L2) * 0.9995);
      const needCos = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
      const need = Math.acos(Math.min(1, Math.max(-1, needCos)));
      const u = pS2.clone().sub(pE2).normalize(), v = pH2.clone().sub(pE2).normalize();
      const curAng = Math.acos(Math.min(1, Math.max(-1, u.dot(v))));
      const axis = new THREE.Vector3().crossVectors(u, v);
      if (axis.lengthSq() < 1e-8) continue;        // 手臂打直,沒有明確的彎曲平面就不硬凹
      axis.normalize();
      // 繞 u×v 轉 φ 後,夾角變成 cur+φ,所以要轉 (need−cur) —— 反過來寫會往錯的方向凹
      const qe = new THREE.Quaternion().setFromAxisAngle(axis, need - curAng);
      setWorldQuat(elbow, qe.multiply(elbow.getWorldQuaternion(new THREE.Quaternion())));
    }
  }

  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(srcClip).play();
  const worldOf = new Map();                       // 這一格算好的目標世界旋轉
  const _w = new THREE.Quaternion(), _f = new THREE.Quaternion(), _pw = new THREE.Quaternion();
  const savedHipsPos = tgtHips ? tgtHips.position.clone() : null;

  for (let i = 0; i < nSamples; i++) {
    const t = srcClip.duration * (i / (nSamples - 1));
    times[i] = t;
    mixer.setTime(t);
    srcRoot.updateMatrixWorld(true);
    worldOf.clear();
    for (const node of ordered) {                  // ordered 是目標的階層順序,父先於子
      const key = rigKey(node.name);
      const sn = srcByKey[key];
      if (!sn) continue;
      // F = 來源這一格的世界旋轉 × 來源 rest 的反 → 「相對 rest 的世界變化量」
      _f.copy(sn.getWorldQuaternion(_w)).multiply(srcRestInvOf.get(key));
      _w.copy(_f).multiply(restOf(node));          // 目標該有的世界旋轉
      worldOf.set(node, _w.clone());
      // 換成 local:除掉目標**實際**父節點這一格的世界旋轉
      const p = node.parent;
      _pw.copy(worldOf.get(p) || restOf(p)).invert();
      const lq = _pw.multiply(_w);
      node.quaternion.copy(lq);                    // 真的擺上去,IK 才有姿勢可讀
      lq.toArray(values[key], i * 4);
    }
    if (srcHips && tgtHips) {                      // hips 位移同樣走世界空間
      const d = srcHips.position.clone().sub(srcHipsRest)
        .applyQuaternion(srcHips.parent.getWorldQuaternion(_w))
        .multiplyScalar(hipsScale)
        .applyQuaternion((worldOf.get(tgtHips.parent) || restOf(tgtHips.parent)).clone().invert())
        .add(tgtHipsRest);
      tgtHips.position.copy(d);
      d.toArray(hipsPos, i * 3);
    }

    if (canIK) {
      tgtRoot.updateMatrixWorld(true);
      // 來源兩手的間距(以臂長為單位)決定 IK 權重:0.30 以下全開、0.55 以上關閉
      const sL = wp(srcByKey.LeftHand), sR = wp(srcByKey.RightHand);
      const sep = sL.distanceTo(sR) / srcArmLen;
      const w = Math.min(1, Math.max(0, (0.55 - sep) / 0.25));
      if (w > 0.01) {
        const sMid = wp(srcByKey.LeftArm).add(wp(srcByKey.RightArm)).multiplyScalar(0.5);
        const tMid = wp(byKey.LeftArm).add(wp(byKey.RightArm)).multiplyScalar(0.5);
        for (const side of ['Left', 'Right']) {
          const hand = byKey[side + 'Hand'];
          // 目標點:來源手相對「兩肩中點」的偏移,按臂長比例縮放,套到目標的兩肩中點
          const desired = wp(srcByKey[side + 'Hand']).sub(sMid).multiplyScalar(armScale).add(tMid);
          const goal = wp(hand).lerp(desired, w);
          const handWorldQ = hand.getWorldQuaternion(new THREE.Quaternion());
          ikArm(byKey[side + 'Arm'], byKey[side + 'ForeArm'], hand, goal);
          setWorldQuat(hand, handWorldQ);          // 手掌朝向維持 retarget 的結果
          // IK 動過的三根骨骼,把最終 local 寫回軌道
          for (const part of ['Arm', 'ForeArm', 'Hand'])
            byKey[side + part].quaternion.toArray(values[side + part], i * 4);
        }
      }
    }
  }
  if (savedHipsPos) tgtHips.position.copy(savedHipsPos);
  for (const [node, q] of saved) node.quaternion.copy(q);   // 取樣時把姿勢真的擺上去了,要還原
  tgtRoot.updateMatrixWorld(true);
  mixer.stopAllAction(); mixer.uncacheClip(srcClip);
  srcRoot.updateMatrixWorld(true);

  const timeArr = Array.from(times);
  for (const key in byKey)
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${byKey[key].name}.quaternion`, timeArr, Array.from(values[key])));
  if (srcHips && tgtHips)
    tracks.push(new THREE.VectorKeyframeTrack(
      `${tgtHips.name}.position`, timeArr, Array.from(hipsPos)));

  if (!tracks.length) return null;
  return new THREE.AnimationClip(srcClip.name || 'mixamo', srcClip.duration, tracks);
}

// 目標是 VRM:走 three-vrm 的 normalized humanoid 骨架(rest 就是 T-pose,rotation=0)
function retargetVRM(root, srcClip, vrm) {
  ensureBindPose(vrm.scene);                     // VRM 的 normalized 骨架同樣會被播放中的動作污染
  const tracks = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _quat = new THREE.Quaternion();
  const _vec = new THREE.Vector3();
  const isVrm0 = vrm.meta && vrm.meta.metaVersion === '0';

  // Mixamo 的 bind pose 頭本身就前傾 18.8°(手臂是正 T-pose,頭不是),而 VRM normalized
  // rest 的頭是端正的。不補這個差,每個動作的頭都會固定多 19° 後仰。
  const headAlign = new THREE.Quaternion();
  {
    let srcTop = null, srcHead = null;
    root.traverse(o => {
      if (!srcTop && /HeadTop/i.test(o.name || '')) srcTop = o;
      if (!srcHead && rigKey(o.name || '') === 'Head') srcHead = o;
    });
    if (srcTop && srcHead) {
      const u = srcTop.getWorldPosition(new THREE.Vector3())
        .sub(srcHead.getWorldPosition(new THREE.Vector3())).normalize();
      headAlign.setFromUnitVectors(new THREE.Vector3(0, 1, 0), u);
    }
  }

  // hips 位移要按身高比例縮放,否則矮的模型會浮空、高的會陷進地板
  let motionHips = null;
  root.traverse(o => { if (!motionHips && rigKey(o.name || '') === 'Hips') motionHips = o; });
  const vrmHips = vrm.humanoid.getNormalizedBoneNode('hips');
  let hipsPositionScale = 1;
  if (motionHips && vrmHips && Math.abs(motionHips.position.y) > 1e-6) {
    const vrmHipsY = vrmHips.getWorldPosition(_vec).y;
    const vrmRootY = vrm.scene.getWorldPosition(_vec).y;
    hipsPositionScale = Math.abs(vrmHipsY - vrmRootY) / Math.abs(motionHips.position.y);
  }

  for (const track of srcClip.tracks) {
    const [rigName, propertyName] = track.name.split('.');
    const vrmBoneName = MIXAMO_TO_VRM[rigKey(rigName)];
    if (!vrmBoneName) continue;
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName);
    const rigNode = root.getObjectByName(rigName);
    if (!vrmNode || !rigNode || !rigNode.parent) continue;   // 模型缺這根骨頭(如 upperChest/toes)

    // 這兩個四元數描述來源骨架的 rest pose,用來把「相對來源 bind pose 的旋轉」
    // 改寫成「相對 VRM normalized rest pose 的旋轉」
    rigNode.getWorldQuaternion(restRotationInverse).invert();
    rigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _quat.fromArray(values, i);
        _quat.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        if (vrmBoneName === 'head') _quat.multiply(headAlign);
        _quat.toArray(values, i);
      }
      // VRM 0.x 面向 -Z(程式裡有做 rotateVRM0),動作資料要對應翻 x/z 兩軸
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${vrmNode.name}.${propertyName}`,
        Array.from(track.times),
        Array.from(values, (v, i) => (isVrm0 && i % 2 === 0) ? -v : v)));
    } else if (track instanceof THREE.VectorKeyframeTrack && propertyName === 'position') {
      // scale 軌道一律丟掉:來源常帶固定 scale=1,套到 VRM 只會干擾
      tracks.push(new THREE.VectorKeyframeTrack(
        `${vrmNode.name}.${propertyName}`,
        Array.from(track.times),
        Array.from(track.values, (v, i) => ((isVrm0 && i % 3 !== 1) ? -v : v) * hipsPositionScale)));
    }
  }

  if (!tracks.length) return null;
  return new THREE.AnimationClip(srcClip.name || 'mixamo', srcClip.duration, tracks);
}
