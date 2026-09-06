/**
 * `AvatarExpressionState` → VRM expression weights.
 *
 * Two hops, on purpose:
 *
 *   ExpressionState ──▶ ARKit-52 dict ──▶ VRM preset weights
 *
 * The middle hop is the interface contract the archive's proof of concept
 * settled on: every upstream source (these presets today, LAM-A2E audio-to-
 * expression frames tomorrow, a face-capture take) speaks ARKit-52, and *one*
 * `arkitToVrm()` turns that into the VRM 0.x/1.0 preset set (aa/ih/ou/ee/oh +
 * happy/angry/sad/surprised/relaxed + blink). Mapping each expression name
 * straight to VRM weights would be shorter and would have to be redone the day
 * the A2E model lands.
 *
 * Pure module — no three.js import — so it can be unit-tested in node.
 */
import type { AvatarExpressionName, AvatarExpressionState } from '../types';

/** The 52 ARKit blendshape names (the archive's `sample_a2e.json` order). */
export const ARKIT_NAMES = [
  'eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft',
  'eyeSquintLeft', 'eyeWideLeft', 'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight',
  'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight', 'jawForward',
  'jawLeft', 'jawRight', 'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft',
  'mouthRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft',
  'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft',
  'mouthUpperUpRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft',
  'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft',
  'noseSneerRight', 'tongueOut',
] as const;

export type ArkitName = (typeof ARKIT_NAMES)[number];
/** Sparse ARKit dict — absent keys are 0. */
export type ArkitWeights = Partial<Record<ArkitName, number>>;

/** The VRM preset expressions this stage drives. */
export const VRM_EXPRESSION_NAMES = [
  'aa', 'ih', 'ou', 'ee', 'oh',
  'happy', 'angry', 'sad', 'surprised', 'relaxed',
  'blinkLeft', 'blinkRight',
] as const;

export type VrmExpressionName = (typeof VRM_EXPRESSION_NAMES)[number];
export type VrmWeights = Record<VrmExpressionName, number>;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The archive viewer's `EMOTIONS` presets, re-keyed to the §69 expression bank.
 *
 *   neutral    → {}
 *   skeptical  → viewer '懷疑'
 *   frustrated → viewer '生氣' scaled down (a customer, not a villain)
 *   concerned  → viewer '難過' lite
 *   interested → '微笑' + a touch of '驚訝'
 *   thinking   → brow + eyes up
 *   ready      → '微笑'
 *   listening  → slight browInnerUp
 *
 * Values are the *full-intensity* pose; `expressionToArkit` scales them.
 */
export const ARKIT_EXPRESSION_PRESETS: Record<AvatarExpressionName, ArkitWeights> = {
  neutral: {},
  listening: { browInnerUp: 0.18, eyeWideLeft: 0.08, eyeWideRight: 0.08 },
  // Authored for the Rocketbox heads, which render smaller and flatter than the
  // stylised bodies these numbers came from: at the old values the VRM's `angry`
  // channel — the brow — topped out at 0.41 and a sceptical customer was a face
  // you had to be *told* was sceptical. The asymmetry is kept on purpose; it is
  // what stops the pose reading as a mask.
  skeptical: {
    browDownLeft: 0.72, browDownRight: 0.45, browInnerUp: 0.2,
    eyeSquintLeft: 0.5, eyeSquintRight: 0.3,
    mouthPressLeft: 0.5, mouthPressRight: 0.5, mouthLeft: 0.2, noseSneerLeft: 0.2,
  },
  concerned: {
    browInnerUp: 0.75, mouthFrownLeft: 0.45, mouthFrownRight: 0.42, mouthShrugLower: 0.25,
    eyeLookDownLeft: 0.12, eyeLookDownRight: 0.12,
  },
  frustrated: {
    browDownLeft: 0.85, browDownRight: 0.8, eyeSquintLeft: 0.4, eyeSquintRight: 0.4,
    noseSneerLeft: 0.35, noseSneerRight: 0.32, mouthFrownLeft: 0.45, mouthFrownRight: 0.42,
    mouthPressLeft: 0.35, mouthPressRight: 0.35, jawForward: 0.12,
  },
  interested: {
    mouthSmileLeft: 0.45, mouthSmileRight: 0.4, cheekSquintLeft: 0.2, cheekSquintRight: 0.2,
    eyeSquintLeft: 0.08, eyeSquintRight: 0.08,
    browInnerUp: 0.3, browOuterUpLeft: 0.2, browOuterUpRight: 0.2, eyeWideLeft: 0.2, eyeWideRight: 0.2,
  },
  thinking: {
    browInnerUp: 0.3, browDownLeft: 0.15, browOuterUpRight: 0.25,
    eyeLookUpLeft: 0.35, eyeLookUpRight: 0.35, mouthPressLeft: 0.25, mouthPressRight: 0.25,
  },
  ready: {
    mouthSmileLeft: 0.55, mouthSmileRight: 0.5, cheekSquintLeft: 0.3, cheekSquintRight: 0.3,
    eyeSquintLeft: 0.15, eyeSquintRight: 0.15, browInnerUp: 0.1,
  },
};

/**
 * Presets are authored at full strength; `intensity` in the §9 state is a
 * 0–1 *product* number that sits around 0.3–0.7 in practice. Scaling linearly
 * would leave every face at half strength, so the gain lifts the working range
 * while still letting intensity 0 mean "nothing".
 *
 * Raising this does *not* make faces stronger at the intensities the director
 * actually produces: measured on 張若瑄 at 懷疑, `scale` was already clamped to
 * 1, so 1.4 and 1.9 gave an identical brow. What limits the face is the pose,
 * not the gain — see the presets above.
 */
const INTENSITY_GAIN = 1.4;

export function expressionToArkit(state: AvatarExpressionState): ArkitWeights {
  const preset = ARKIT_EXPRESSION_PRESETS[state.name] ?? {};
  const scale = clamp01(state.intensity * INTENSITY_GAIN);
  const out: ArkitWeights = {};
  for (const key of Object.keys(preset) as ArkitName[]) {
    const v = (preset[key] ?? 0) * scale;
    if (v > 0.001) out[key] = v;
  }
  // `eye_open` < 1 (skeptical, frustrated) narrows the lids on top of the preset.
  const lid = clamp01(1 - state.eye_open);
  if (lid > 0.01) {
    out.eyeSquintLeft = Math.max(out.eyeSquintLeft ?? 0, lid * 0.8);
    out.eyeSquintRight = Math.max(out.eyeSquintRight ?? 0, lid * 0.8);
  }
  return out;
}

/**
 * Ported verbatim from the archive viewer's `arkitToVrm()`. `blink` is a
 * separate channel (procedural, 0–1) merged with `max` so a blink never has to
 * fight the emotion layer.
 */
export function arkitToVrm(m: ArkitWeights, blink = 0): VrmWeights {
  const g = (n: ArkitName): number => m[n] ?? 0;
  const c = clamp01;
  return {
    aa: c(g('jawOpen') * 1.15),
    ou: c(Math.max(g('mouthPucker'), g('mouthFunnel')) * 1.1),
    ih: c((g('mouthStretchLeft') + g('mouthStretchRight')) * 0.5),
    ee: c((g('mouthUpperUpLeft') + g('mouthUpperUpRight')) * 0.5),
    // Not in the viewer: `oh` is a rounder, more open `ou`, useful for lipsync.
    oh: c(g('mouthFunnel') * 0.6 * g('jawOpen')),
    happy: c(
      (g('mouthSmileLeft') + g('mouthSmileRight')) * 0.6 +
        (g('cheekSquintLeft') + g('cheekSquintRight')) * 0.15,
    ),
    angry: c(
      (g('browDownLeft') + g('browDownRight')) * 0.5 +
        (g('noseSneerLeft') + g('noseSneerRight')) * 0.25,
    ),
    sad: c(g('browInnerUp') * 0.5 + (g('mouthFrownLeft') + g('mouthFrownRight')) * 0.45),
    surprised: c((g('eyeWideLeft') + g('eyeWideRight')) * 0.5 + g('browOuterUpLeft') * 0.3),
    relaxed: c((g('eyeSquintLeft') + g('eyeSquintRight')) * 0.35),
    blinkLeft: c(Math.max(g('eyeBlinkLeft'), blink)),
    blinkRight: c(Math.max(g('eyeBlinkRight'), blink)),
  };
}

/** Viewer's `SPEECH_REGION` / `SPEECH_MASK_WEIGHT`. */
const SPEECH_REGION = /^(jaw|mouth|tongue)/;
export const SPEECH_MASK_WEIGHT = 0.35;

/**
 * Compose the emotion layer with a speech layer (procedural lipsync or A2E).
 * While speaking, the mouth/jaw/tongue channels of the *emotion* keep 35% of
 * their weight rather than dropping to zero, so a smile is still a smile
 * mid-sentence — the viewer's `B = M_speech⊙B_speech + M_emotion⊙B_emotion`.
 */
export function composeArkit(
  emotion: ArkitWeights,
  speech: ArkitWeights | null,
  speaking: boolean,
): ArkitWeights {
  const out: ArkitWeights = {};
  if (speech) {
    for (const key of Object.keys(speech) as ArkitName[]) {
      const v = speech[key] ?? 0;
      if (v > 0.001) out[key] = v;
    }
  }
  for (const key of Object.keys(emotion) as ArkitName[]) {
    const w = speaking && SPEECH_REGION.test(key) ? SPEECH_MASK_WEIGHT : 1;
    out[key] = (out[key] ?? 0) + (emotion[key] ?? 0) * w;
  }
  return out;
}

/** One-shot convenience: state → VRM weights, no speech layer. */
export function expressionToVrm(state: AvatarExpressionState, blink = 0): VrmWeights {
  return arkitToVrm(expressionToArkit(state), blink);
}
