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
import { cn } from '../lib/tone';
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

/**
 * Black → purple ground (see the JSX note). Built from the theme's violet /
 * indigo accents and the theme-invariant ink so it does not flip in light
 * mode; `black` is the one literal, because the ink is a charcoal and the
 * bottom-left corner has to be actually black under the glass cards.
 */
const STAGE_GROUND = [
  'linear-gradient(205deg,',
  '  color-mix(in srgb, var(--accent-violet) 58%, var(--sim-ink, #303035)) 0%,',
  '  color-mix(in srgb, var(--accent-indigo) 34%, var(--sim-ink, #303035)) 42%,',
  '  color-mix(in srgb, var(--sim-ink, #303035) 45%, black) 78%,',
  '  black 100%)',
].join('\n');

const IDLE_FPS = 30;
/** Viewer's emotion smoothing constant (`k1 = 1 - exp(-dt*6)`). */
const EMOTION_SMOOTHING = 6;
/** Camera: a narrow lens flattens the face the way a portrait lens does. */
const CAMERA_FOV = 22;
/**
 * Height of the window we frame, in metres. Tuned for the stage-fill layout,
 * where the character owns the whole left panel and the context cards float
 * over the lower 40% of it: at the old 0.52 (a tight head-and-shoulders crop
 * for the small 4/3 card) the cards landed on the chin, because there was no
 * torso below it to land on. 0.86 puts head, shoulders and chest in frame, so
 * the cards sit on the chest as intended.
 */
const FRAME_HEIGHT_M = 0.86;
const FRAME_WIDTH_M = 0.52;
/**
 * The tight head-and-shoulders crop the small 4/3 card was tuned for. Which of
 * the two is used is decided by the host's aspect, not by a prop: a portrait
 * host is the full-height stage and wants the torso, a landscape one is the
 * little card and would render a distant figure at 0.86.
 */
const CLOSE_FRAME_HEIGHT_M = 0.52;
const CLOSE_FRAME_WIDTH_M = 0.46;
const CLOSE_TARGET_DROP_M = 0.09;
/** Below this width/height ratio the host counts as the full-height stage. */
const PORTRAIT_ASPECT = 0.9;
/**
 * ...and so does any host at least this tall, whatever its aspect: with the
 * persona column at ~two thirds of the screen the stage is close to square, and
 * by aspect alone it fell back to the head-shot crop.
 */
const TALL_HOST_PX = 480;
/**
 * How far below the head bone the frame is centred. Keeps the head at roughly
 * the upper fifth: head centre sits ~0.08 above headBase, and 0.18 below that
 * centre is 0.30 of the frame height, i.e. 20% down from the top edge.
 */
const FRAME_TARGET_DROP_M = 0.18;

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

let webglProbe: boolean | null = null;

/** three r163+ is WebGL2-only, so that is what we probe. Cached: one stray context, ever. */
function hasWebGL(): boolean {
  if (webglProbe !== null) return webglProbe;
  if (typeof document === 'undefined') return false;
  try {
    webglProbe = Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

/**
 * Dev-only inspection handle (`window.__aiCoachVrm`): lets a reviewer or a
 * browser-automation check read the live expression weights and tick the loop
 * by hand in a hidden tab, where rAF never fires. Stripped in production.
 */
interface VrmDebugHandle {
  status: VrmStageStatus;
  gender: AvatarBodyGender;
  step: (dt: number) => void;
  weights: () => Readonly<Record<VrmExpressionName, number>> | null;
  head: () => { yaw: number; pitch: number; roll: number } | null;
  /** Dial the arms in live, in degrees; see `ARM_POSE`. */
  setArms: (degrees: Partial<typeof ARM_POSE>) => void;
}
declare global {
  interface Window {
    __aiCoachVrm?: VrmDebugHandle;
  }
}
const DEBUG_HANDLE = process.env.NODE_ENV !== 'production';

const DEG = Math.PI / 180;

/**
 * Arms-down pose for the VRoid rest T-pose, in degrees on the *normalized*
 * humanoid bones (which rest at identity, so these are absolute rotations).
 *
 * **Measured, not derived.** The reference viewer's author recorded that they
 * guessed these twice and were wrong both times ("一次太高,一次縮進身體裡") and
 * replaced the guess with sliders; our own first guess was wrong too — it had
 * the upper-arm sign inverted (arms went up into a V) and rotated the forearm
 * about Y instead of X. These numbers came off the slider panel at a standing
 * rest pose. The slight left/right asymmetry is deliberate: it is what was
 * measured, and it reads as a person rather than a mannequin.
 *
 * `dev` builds expose `window.__aiCoachVrm.setArms({...degrees})` so this can be
 * re-measured the same way instead of re-guessed.
 */
const ARM_POSE = {
  leftUpperArmZ: 62,
  leftLowerArmX: -24,
  rightUpperArmZ: -63,
  rightLowerArmX: -30,
};

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

    // Re-applied by the dev-only `setArms`, so the pose can be dialled in live.
    let applyArmPose: (() => void) | null = null;

    const report = (status: VrmStageStatus, reason?: string): void => {
      if (DEBUG_HANDLE && window.__aiCoachVrm) window.__aiCoachVrm.status = status;
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
      const portrait = aspect < PORTRAIT_ASPECT || host.clientHeight >= TALL_HOST_PX;
      const frameH = portrait ? FRAME_HEIGHT_M : CLOSE_FRAME_HEIGHT_M;
      const frameW = portrait ? FRAME_WIDTH_M : CLOSE_FRAME_WIDTH_M;
      const drop = portrait ? FRAME_TARGET_DROP_M : CLOSE_TARGET_DROP_M;
      const halfTan = Math.tan((CAMERA_FOV * Math.PI) / 360);
      // Fit the taller of the two constraints so a narrow card still shows
      // both shoulders and a wide one does not crop the top of the head.
      const distV = frameH / 2 / halfTan;
      const distH = frameW / 2 / (halfTan * aspect);
      const dist = Math.max(distV, distH);
      // Look below the eyes so the head sits in the upper fifth and the chest
      // fills the band the floating cards occupy.
      const target = new THREE.Vector3(headBase.x, headBase.y - drop, headBase.z);
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
    let lastWeights: Record<VrmExpressionName, number> | null = null;
    let lastHead: { yaw: number; pitch: number; roll: number } | null = null;

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
      lastWeights = weights;

      if (head) {
        // Normalized bones rest at identity, so the pose is absolute.
        headEuler.set(pose.headPitch, pose.headYaw, pose.headRoll, 'YXZ');
        head.quaternion.setFromEuler(headEuler);
        lastHead = { yaw: pose.headYaw, pitch: pose.headPitch, roll: pose.headRoll };
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

    if (DEBUG_HANDLE) {
      window.__aiCoachVrm = {
        status: 'loading',
        gender,
        step,
        weights: () => lastWeights,
        head: () => lastHead,
        setArms: (degrees) => {
          Object.assign(ARM_POSE, degrees);
          applyArmPose?.();
        },
      };
    }

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
        applyArmPose = () => {
          if (leftArm) leftArm.rotation.set(0, 0, ARM_POSE.leftUpperArmZ * DEG);
          if (rightArm) rightArm.rotation.set(0, 0, ARM_POSE.rightUpperArmZ * DEG);
          if (leftFore) leftFore.rotation.set(ARM_POSE.leftLowerArmX * DEG, 0, 0);
          if (rightFore) rightFore.rotation.set(ARM_POSE.rightLowerArmX * DEG, 0, 0);
        };
        applyArmPose();

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
      // No `forceContextLoss()`: React StrictMode re-runs this effect on the
      // same canvas in dev, and a deliberately lost context cannot be reused.
      // `dispose()` frees the GPU resources; the context goes with the canvas.
      rig.renderer.dispose();
      if (DEBUG_HANDLE && window.__aiCoachVrm?.step === step) delete window.__aiCoachVrm;
    };
    // `gender` swaps the model, which means a new rig; everything else is a ref.
  }, [gender]);

  return (
    <div ref={hostRef} className={cn('relative h-full w-full overflow-hidden', className)}>
      {/* Ground behind the character: violet at the top-right falling to black
          at the bottom-left. The glass cards float over that corner, and glass
          only reads as glass on a ground that is dark and *even* — over the
          old pale aurora the same card was half white and half black depending
          on whether the suit or the wall was behind it. */}
      <div aria-hidden="true" className="absolute inset-0" style={{ background: STAGE_GROUND }} />
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
