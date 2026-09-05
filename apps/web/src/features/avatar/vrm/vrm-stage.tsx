'use client';

/**
 * The 3D virtual human — a VRM character rendered locally in WebGL.
 *
 * This is an *alternative rendering of the same store state* the CSS portrait
 * uses: `expression` (mood + head pose, driven by the mock driver or runtime
 * events) and `speaking`. It never touches the runtime status ladder or
 * `avatar-client.ts`; the parent decides when it is on screen (whenever the
 * runtime is not streaming frames) and swaps in `<AvatarFallback>` if WebGL or
 * the model load fails.
 *
 * Frame discipline, matching `use-avatar-frames.ts`: one rAF loop, everything
 * per-frame lives in refs / plain objects, no `setState` on the hot path. The
 * loop throttles to ~30fps while the character is silent and lets the browser
 * run at native rate while it speaks (mouth motion at 30fps looks stepped).
 * `document.hidden` suspends rAF on its own; we only reset the clock so the
 * first frame back does not integrate a minute of physics.
 *
 * Loaded via `next/dynamic({ ssr: false })` from the stage, so `three` and
 * `@pixiv/three-vrm` stay out of the initial chunk and never run on the server.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';

import { useAvatarStore } from '../avatar-store';
import type { AvatarBodyGender } from '../lib/persona-gender';
import { auroraGlow, cn } from '../lib/tone';
import {
  ARKIT_NAMES,
  VRM_EXPRESSION_NAMES,
  arkitToVrm,
  composeArkit,
  expressionToArkit,
  type ArkitName,
  type ArkitWeights,
  type VrmExpressionName,
} from './expression-to-vrm';
import { IdleAnimator, prefersReducedMotion } from './idle';
import { A2EPlayer, ProceduralLipsync } from './lipsync';

export type VrmStageStatus = 'loading' | 'ready' | 'failed';

export interface VrmStageProps {
  gender: AvatarBodyGender;
  /** For the canvas `aria-label`; pixels are invisible to assistive tech. */
  ariaLabel: string;
  speaking: boolean;
  /** Reported once per transition; `failed` carries a reason for telemetry. */
  onStatus?: (status: VrmStageStatus, reason?: string) => void;
  className?: string;
}

/** Same-origin model files (`apps/web/public/models`). */
export function modelUrlFor(gender: AvatarBodyGender): string {
  return `/models/avatar_${gender}_suit.vrm`;
}

const IDLE_FPS = 30;
/** Viewer's emotion smoothing constant (`k1 = 1 - exp(-dt*6)`). */
const EMOTION_SMOOTHING = 6;
/** Camera: a narrow lens flattens the face the way a portrait lens does. */
const CAMERA_FOV = 22;
/** Height of the head-and-shoulders window we frame, in metres. */
const FRAME_HEIGHT_M = 0.52;
const FRAME_WIDTH_M = 0.46;

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gazeTarget: THREE.Object3D;
  vrm: VRM | null;
  head: THREE.Object3D | null;
  /** Expression names this particular model actually has. */
  available: VrmExpressionName[];
  /** Body idle from the file, if it ships one (Avaturn-style pose fix). */
  mixer: THREE.AnimationMixer | null;
  headBase: THREE.Vector3;
}

function hasWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Viewer's `BODY_POSE_BONE` — trunk/limbs only, never head or eyes. */
const BODY_POSE_BONE =
  /^(Hips|Spine\d*|(Left|Right)(Shoulder|Arm|ForeArm|Hand(Index|Middle|Pinky|Ring|Thumb)?\d*|UpLeg|Leg|Foot|ToeBase))$/i;

export function VrmStage({ gender, ariaLabel, speaking, onStatus, className }: VrmStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(speaking);
  const onStatusRef = useRef(onStatus);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    const report = (status: VrmStageStatus, reason?: string): void => {
      onStatusRef.current?.(status, reason);
    };

    if (!hasWebGL()) {
      report('failed', 'WebGL unavailable');
      return undefined;
    }

    let rig: Rig;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      // The viewer's look was tuned under ACES; MToon reads flat without it.
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 20);
      // Viewer lighting: soft sky/ground, a warm key, a cool fill, a warm rim.
      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(1.5, 1.8, 2.5);
      const fill = new THREE.DirectionalLight(0x88aaff, 0.7);
      fill.position.set(-2, 0.5, 1);
      const rim = new THREE.DirectionalLight(0xffe0c0, 1.0);
      rim.position.set(0, 1.5, -2.5);
      scene.add(key, fill, rim);

      const gazeTarget = new THREE.Object3D();
      scene.add(gazeTarget);

      rig = {
        renderer,
        scene,
        camera,
        gazeTarget,
        vrm: null,
        head: null,
        available: [],
        mixer: null,
        headBase: new THREE.Vector3(0, 1.4, 0),
      };
    } catch (err) {
      report('failed', err instanceof Error ? err.message : 'WebGL context failed');
      return undefined;
    }

    let disposed = false;
    let rafId: number | null = null;

    // --- sizing ------------------------------------------------------------
    const frameCamera = (): void => {
      const { camera, headBase } = rig;
      const aspect = camera.aspect || 1;
      const halfTan = Math.tan((CAMERA_FOV * Math.PI) / 360);
      // Fit the taller of the two constraints so a narrow card still shows
      // both shoulders and a wide one does not crop the top of the head.
      const distV = FRAME_HEIGHT_M / 2 / halfTan;
      const distH = FRAME_WIDTH_M / 2 / (halfTan * aspect);
      const dist = Math.max(distV, distH);
      // Look a little below the eyes so the head sits in the upper third.
      const target = new THREE.Vector3(headBase.x, headBase.y - 0.09, headBase.z);
      camera.position.set(target.x, target.y + 0.03, target.z + dist);
      camera.lookAt(target);
      camera.near = Math.max(0.02, dist / 50);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
    };

    const resize = (): void => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      rig.renderer.setSize(w, h, false);
      rig.camera.aspect = w / h;
      frameCamera();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    // --- reduced motion ----------------------------------------------------
    reducedMotionRef.current = prefersReducedMotion();
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const onMotionChange = (event: MediaQueryListEvent): void => {
      reducedMotionRef.current = event.matches;
    };
    motionQuery?.addEventListener?.('change', onMotionChange);

    // --- per-frame state (never React state) --------------------------------
    const idle = new IdleAnimator();
    const lipsync = new ProceduralLipsync();
    // The seam for LAM-A2E: when a clip is set it wins over the procedural mouth.
    const a2e = new A2EPlayer();
    const emotionCur: ArkitWeights = {};
    const clock = { last: performance.now(), accum: 0 };
    const headEuler = new THREE.Euler();

    const step = (dt: number): void => {
      const { vrm, head, camera, gazeTarget, available, mixer } = rig;
      if (!vrm) return;
      const state = useAvatarStore.getState();
      const expression = state.expression;
      const isSpeaking = speakingRef.current;

      // Emotion layer, eased in ARKit space so a state change never snaps.
      const target = expressionToArkit(expression);
      const k = 1 - Math.exp(-dt * EMOTION_SMOOTHING);
      for (const name of ARKIT_NAMES) {
        const cur = emotionCur[name] ?? 0;
        const tgt = target[name] ?? 0;
        if (cur === 0 && tgt === 0) continue;
        const v = cur + (tgt - cur) * k;
        if (v < 0.001 && tgt === 0) delete emotionCur[name];
        else emotionCur[name] = v;
      }

      const pose = idle.update(dt, {
        reducedMotion: reducedMotionRef.current,
        expression,
        speaking: isSpeaking,
      });
      const speech = a2e.sample(dt, isSpeaking) ?? lipsync.sample(dt, isSpeaking);
      const weights = arkitToVrm(composeArkit(emotionCur, speech, isSpeaking), pose.blink);

      const em = vrm.expressionManager;
      if (em) {
        for (const name of available) em.setValue(name, weights[name]);
      }

      if (head) {
        // Normalized bones rest at identity, so the pose is absolute.
        headEuler.set(pose.headPitch, pose.headYaw, pose.headRoll, 'YXZ');
        head.quaternion.setFromEuler(headEuler);
      }

      // Eye contact with a drift: the lookAt target hovers around the lens.
      gazeTarget.position.copy(camera.position);
      gazeTarget.position.x += pose.gazeX * 3;
      gazeTarget.position.y += pose.gazeY * 3;

      mixer?.update(dt);
      vrm.update(dt);
      rig.renderer.render(rig.scene, camera);
    };

    const frame = (now: number): void => {
      rafId = requestAnimationFrame(frame);
      const dt = Math.min((now - clock.last) / 1000, 0.1);
      clock.last = now;
      clock.accum += dt;
      // Silent → 30fps is plenty and halves GPU time on a laptop. Speaking (or a
      // mouth still closing) → native rate.
      const budget = speakingRef.current || lipsync.active() || a2e.active() ? 0 : 1 / IDLE_FPS;
      if (clock.accum < budget) return;
      const stepDt = clock.accum;
      clock.accum = 0;
      step(stepDt);
    };

    const onVisibility = (): void => {
      // rAF stops on its own while hidden; just do not integrate the gap.
      clock.last = performance.now();
      clock.accum = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);

    // --- model -------------------------------------------------------------
    report('loading');
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader
      .loadAsync(modelUrlFor(gender))
      .then((gltf) => {
        const vrm = (gltf.userData as { vrm?: VRM }).vrm;
        if (!vrm) throw new Error('file is not a VRM');
        if (disposed) {
          VRMUtils.deepDispose(vrm.scene);
          return;
        }

        // Standard three-vrm hygiene: fewer draw calls, one skeleton, no
        // backface culling on skinned meshes that flicker at the edge.
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.rotateVRM0(vrm); // VRM 0.x faces −Z; turn it to the camera.
        vrm.scene.traverse((o) => {
          // Skinned bounds lag the pose; culling a shoulder mid-turn is worse
          // than drawing it.
          if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
        });

        // VRoid exports rest in T-pose. Drop the arms so the shoulders read as
        // a seated customer rather than a scarecrow — normalized bones rest at
        // identity, so this is an absolute rotation.
        const humanoid = vrm.humanoid;
        const leftArm = humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftFore = humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightFore = humanoid.getNormalizedBoneNode('rightLowerArm');
        if (leftArm) leftArm.rotation.z = -1.2;
        if (rightArm) rightArm.rotation.z = 1.2;
        if (leftFore) leftFore.rotation.y = -0.35;
        if (rightFore) rightFore.rotation.y = 0.35;

        // Body idle from the file, if any (the viewer's Avaturn A/T-pose fix).
        let mixer: THREE.AnimationMixer | null = null;
        const bodyTracks: THREE.KeyframeTrack[] = [];
        for (const clip of gltf.animations ?? []) {
          for (const track of clip.tracks) {
            const bone = track.name.split('.')[0] ?? '';
            if (BODY_POSE_BONE.test(bone)) bodyTracks.push(track);
          }
        }
        if (bodyTracks.length > 0) {
          mixer = new THREE.AnimationMixer(vrm.scene);
          mixer.clipAction(new THREE.AnimationClip('idle-body-pose', -1, bodyTracks)).play();
        }

        rig.scene.add(vrm.scene);
        rig.vrm = vrm;
        rig.mixer = mixer;
        rig.head = humanoid.getNormalizedBoneNode('head');
        if (vrm.lookAt) {
          vrm.lookAt.target = rig.gazeTarget;
          vrm.lookAt.autoUpdate = true;
        }

        const em = vrm.expressionManager;
        const map = em ? em.expressionMap : {};
        rig.available = VRM_EXPRESSION_NAMES.filter((name) => name in map);

        // Frame on the head: propagate the pose once, then read the bone.
        vrm.update(0);
        vrm.scene.updateMatrixWorld(true);
        const headRaw = humanoid.getRawBoneNode('head');
        if (headRaw) headRaw.getWorldPosition(rig.headBase);
        // Eyes sit ~9cm above the head joint on these models.
        rig.headBase.y += 0.09;
        frameCamera();

        // Paint one frame before reporting, so the swap from the portrait
        // never shows an empty canvas.
        step(0.016);
        report('ready');
        clock.last = performance.now();
        rafId = requestAnimationFrame(frame);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        report('failed', err instanceof Error ? err.message : 'model load failed');
      });

    return () => {
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      observer.disconnect();
      motionQuery?.removeEventListener?.('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
      rig.mixer?.stopAllAction();
      if (rig.vrm) {
        rig.scene.remove(rig.vrm.scene);
        VRMUtils.deepDispose(rig.vrm.scene);
        rig.vrm = null;
      }
      rig.renderer.dispose();
      rig.renderer.forceContextLoss();
    };
    // `gender` swaps the model, which means a new rig; everything else is a ref.
  }, [gender]);

  return (
    <div ref={hostRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      {/* Same ground as the portrait, so the swap between them is invisible. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: auroraGlow(1) }} />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={ariaLabel}
        className="absolute inset-0 block h-full w-full"
      />
    </div>
  );
}

export default VrmStage;

// Exported for the barrel; keeps the ARKit name type reachable without a deep import.
export type { ArkitName };
