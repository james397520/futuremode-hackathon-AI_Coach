import * as THREE from 'three';
import type { VRMHumanoid } from '@pixiv/three-vrm';

const ROCKETBOX_MATERIAL = /^(m008|f016)_(body|head|opacity)$/i;

/**
 * Compatibility for our FBX-derived Rocketbox VRMs, not arbitrary glTF.
 * The reference exporter removes textures before GLTFExporter runs, then
 * vrm_finalize.py embeds the original image bytes. This skips the exporter's
 * image flipY conversion. Flip V instead (also works with ImageBitmap, where
 * Texture.flipY is ignored), preserving the original files and alpha channel.
 */
export function repairRocketboxMaterials(root: THREE.Object3D): boolean {
  let matched = false;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((material) => ROCKETBOX_MATERIAL.test(material.name))) return;
    matched = true;
    const geometry = mesh.geometry;
    if (!geometry.userData.rocketboxUvRepaired) {
      const uv = geometry.getAttribute('uv');
      if (uv) {
        // Clone: GLTFLoader may share the accessor with other primitives.
        const corrected = uv.clone();
        for (let i = 0; i < corrected.count; i++) corrected.setY(i, 1 - uv.getY(i));
        geometry.setAttribute('uv', corrected);
        // Tangents depend on UV orientation. These exports normally have none;
        // if present, let Three derive the corrected basis instead.
        geometry.deleteAttribute('tangent');
        geometry.userData.rocketboxUvRepaired = true;
      }
    }
    for (const material of materials) {
      if (!/^(m008|f016)_opacity$/i.test(material.name)) continue;
      const hair = material as THREE.MeshStandardMaterial;
      // Reference viewer: alpha comes from map.a, not alphaMap's green channel.
      hair.alphaMap = null;
      hair.side = THREE.DoubleSide;
      hair.alphaTest = 0.35;
      hair.transparent = false;
      hair.depthWrite = true;
      hair.needsUpdate = true;
    }
  });
  return matched;
}

/**
 * Identity normalized rotations retain the loaded A-pose positions. Measure
 * shoulder→elbow / elbow→wrist once, instead of guessing a ±90° T-pose offset.
 * Store absolute local rotations: reapplying must not accumulate each frame.
 */
export function createRelaxedArmPose(humanoid: VRMHumanoid): () => void {
  const poses: { bone: THREE.Object3D; rotation: THREE.Quaternion }[] = [];
  for (const side of ['left', 'right'] as const) {
    const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm`);
    const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm`);
    const hand = humanoid.getNormalizedBoneNode(`${side}Hand`);
    const outward = side === 'left' ? 1 : -1;
    const aim = (bone: THREE.Object3D | null, child: THREE.Object3D | null, target: THREE.Vector3) => {
      if (!bone || !child || !bone.parent) return;
      const inverseParent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const direction = child.getWorldPosition(new THREE.Vector3())
        .sub(bone.getWorldPosition(new THREE.Vector3()))
        .applyQuaternion(inverseParent).normalize();
      if (direction.lengthSq() < 0.5) return;
      target.normalize().applyQuaternion(inverseParent);
      const rotation = new THREE.Quaternion().setFromUnitVectors(direction, target)
        .multiply(bone.quaternion);
      bone.quaternion.copy(rotation);
      bone.updateWorldMatrix(false, true);
      poses.push({ bone, rotation });
    };
    // Slight jacket clearance and a small forward bend at the elbow.
    aim(upper, lower, new THREE.Vector3(outward * 0.16, -1, 0));
    aim(lower, hand, new THREE.Vector3(outward * 0.10, -1, 0.12));
  }
  return () => {
    for (const { bone, rotation } of poses) bone.quaternion.copy(rotation);
  };
}

/**
 * The reference ageing script grays every dark pixel outside the face ellipse,
 * accidentally including the iris UV island at the bottom of the head atlas.
 * Sample only that island from the untouched reference atlas. No image pixels
 * are rewritten; wrinkles, scalp, hair cards and facial expressions stay intact.
 * The caller owns disposal of the additional texture.
 */
export async function restoreRocketboxIrises(root: THREE.Object3D): Promise<THREE.Texture[]> {
  const heads = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (/^(m008|f016)_head$/i.test(material.name)) heads.add(material as THREE.MeshStandardMaterial);
    }
  });
  const textures: THREE.Texture[] = [];
  try {
    for (const head of heads) {
      const gender = head.name.startsWith('m008') ? 'male' : 'female';
      const texture = await new THREE.TextureLoader().loadAsync(`/models/rocketbox_${gender}_head_original.jpg`);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false; // V has already been corrected to glTF convention.
      textures.push(texture);
      head.onBeforeCompile = (shader) => {
        shader.uniforms.rocketboxOriginalHead = { value: texture };
        shader.fragmentShader = 'uniform sampler2D rocketboxOriginalHead;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
          #include <map_fragment>
          #ifdef USE_MAP
            if (vMapUv.x > 0.19 && vMapUv.x < 0.36 && vMapUv.y > 0.84) {
              diffuseColor = vec4(diffuse, opacity) * texture2D(rocketboxOriginalHead, vMapUv);
            }
          #endif
        `);
      };
      head.customProgramCacheKey = () => 'rocketbox-original-iris-v1';
      head.needsUpdate = true;
    }
    return textures;
  } catch (error) {
    for (const texture of textures) texture.dispose();
    throw error;
  }
}
