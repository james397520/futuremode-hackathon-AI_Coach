import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { VRMHumanoid, type VRMHumanBones } from '@pixiv/three-vrm';
import { createRelaxedArmPose, repairRocketboxMaterials, restoreRocketboxIrises } from './model-repairs';

function mesh(name: string, geometry = new THREE.BufferGeometry()) {
  if (!geometry.hasAttribute('uv')) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0.2, 0.15, 0.8, 0.9], 2));
  }
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name }));
}

describe('bundled Rocketbox export compatibility', () => {
  it.each(['m008_body', 'm008_head', 'm008_opacity', 'f016_body', 'f016_head', 'f016_opacity'])(
    'corrects V without moving vertices or modifying source pixels: %s', (name) => {
      const object = mesh(name);
      const original = object.geometry.getAttribute('uv');
      const map = new THREE.Texture();
      object.material.map = map;
      repairRocketboxMaterials(object);
      const uv = object.geometry.getAttribute('uv');
      expect(uv.getX(0)).toBeCloseTo(0.2);
      expect(uv.getY(0)).toBeCloseTo(0.85);
      expect(uv.getY(1)).toBeCloseTo(0.1);
      expect(original.getY(0)).toBeCloseTo(0.15);
      expect(object.material.map).toBe(map);
    },
  );

  it('is idempotent, including meshes sharing a geometry', () => {
    const root = new THREE.Group();
    const first = mesh('m008_head');
    root.add(first, mesh('m008_body', first.geometry));
    repairRocketboxMaterials(root);
    repairRocketboxMaterials(root);
    expect(first.geometry.getAttribute('uv').getY(0)).toBeCloseTo(0.85);
  });

  it('does not double-flip shared GLTF accessors', () => {
    const a = mesh('m008_head');
    const b = mesh('m008_opacity');
    b.geometry.setAttribute('uv', a.geometry.getAttribute('uv'));
    const root = new THREE.Group().add(a, b);
    repairRocketboxMaterials(root);
    expect(a.geometry.getAttribute('uv').getY(0)).toBeCloseTo(0.85);
    expect(b.geometry.getAttribute('uv').getY(0)).toBeCloseTo(0.85);
  });

  it('uses the hair image alpha and double-sided cutouts, not green-channel opacity', () => {
    const hair = mesh('m008_opacity');
    hair.material.alphaMap = new THREE.Texture();
    hair.material.transparent = true;
    hair.material.depthWrite = false;
    repairRocketboxMaterials(hair);
    expect(hair.material.alphaMap).toBeNull();
    expect(hair.material.alphaTest).toBe(0.35);
    expect(hair.material.side).toBe(THREE.DoubleSide);
    expect(hair.material.transparent).toBe(false);
    expect(hair.material.depthWrite).toBe(true);
  });

  it('leaves VRoid and generic glTF materials and UVs unchanged', () => {
    const other = mesh('Head');
    const original = other.geometry.getAttribute('uv');
    repairRocketboxMaterials(other);
    expect(other.geometry.getAttribute('uv')).toBe(original);
    expect(original.getY(0)).toBeCloseTo(0.15);
    expect(other.material.alphaTest).toBe(0);
  });
});

describe('real bundled Rocketbox skeletons', () => {
  it.each(['male_young', 'male_middle', 'male_senior', 'female_young', 'female_middle', 'female_senior'])(
    '%s has relaxed arms without moving the head or accumulating rotation', (variant) => {
      const bytes = readFileSync(new URL(`../../../../public/models/avatar_${variant}.vrm`, import.meta.url));
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      const nodes = json.nodes.map((node: { name?: string; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }) => {
        const object = new THREE.Object3D();
        object.name = node.name ?? '';
        if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
        else {
          if (node.translation) object.position.fromArray(node.translation);
          if (node.rotation) object.quaternion.fromArray(node.rotation);
          if (node.scale) object.scale.fromArray(node.scale);
        }
        return object;
      });
      json.nodes.forEach((node: { children?: number[] }, i: number) => {
        for (const child of node.children ?? []) nodes[i].add(nodes[child]);
      });
      const scene = new THREE.Group();
      for (const i of json.scenes[json.scene ?? 0].nodes) scene.add(nodes[i]);
      scene.updateMatrixWorld(true);
      const humanBones = Object.fromEntries(Object.entries(json.extensions.VRMC_vrm.humanoid.humanBones)
        .map(([name, value]) => [name, { node: nodes[(value as { node: number }).node] }])) as VRMHumanBones;
      const humanoid = new VRMHumanoid(humanBones);
      const position = (bone: keyof VRMHumanBones) => humanoid.getRawBoneNode(bone)!.getWorldPosition(new THREE.Vector3());
      const originalHead = position('head');
      const apply = createRelaxedArmPose(humanoid);
      apply();
      humanoid.update();
      scene.updateMatrixWorld(true);
      expect(position('head').distanceTo(originalHead)).toBeLessThan(0.0001);
      for (const side of ['left', 'right'] as const) {
        const shoulder = position(`${side}UpperArm`);
        const elbow = position(`${side}LowerArm`);
        const wrist = position(`${side}Hand`);
        expect(elbow.y).toBeLessThan(shoulder.y - 0.15);
        expect(wrist.y).toBeLessThan(elbow.y - 0.15);
        expect(Math.abs(elbow.x - shoulder.x)).toBeLessThan(0.09);
        expect(Math.abs(wrist.x)).toBeGreaterThan(Math.abs(shoulder.x));
        for (let frame = 0; frame < 300; frame++) { apply(); humanoid.update(); }
        scene.updateMatrixWorld(true);
        expect(position(`${side}Hand`).distanceTo(wrist)).toBeLessThan(0.0001);
      }
    },
  );
});

describe('original iris atlas', () => {
  it.each([['m008_head', 'male'], ['f016_head', 'female']])('restores only the iris island for %s', async (name, gender) => {
    const head = mesh(name!);
    const aged = new THREE.Texture();
    head.material.map = aged;
    const original = new THREE.Texture<HTMLImageElement>();
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockResolvedValue(original);
    try {
      const owned = await restoreRocketboxIrises(head);
      expect(load).toHaveBeenCalledWith(`/models/rocketbox_${gender}_head_original.jpg`);
      expect(owned).toEqual([original]);
      expect(original.flipY).toBe(false);
      expect(original.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(head.material.map).toBe(aged);
      const shader = { uniforms: {}, fragmentShader: '#include <map_fragment>' } as Parameters<typeof head.material.onBeforeCompile>[0];
      head.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.uniforms.rocketboxOriginalHead?.value).toBe(original);
      expect(shader.fragmentShader).toContain('vMapUv.y > 0.84');
      expect(shader.fragmentShader).toContain('#include <map_fragment>');
    } finally { load.mockRestore(); }
  });

  it('does not load an atlas for other models', async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync');
    try {
      expect(await restoreRocketboxIrises(mesh('Head'))).toEqual([]);
      expect(load).not.toHaveBeenCalled();
    } finally { load.mockRestore(); }
  });
});
