/**
 * Blendshape → emotion rules, ported from the team's `emotion_webcam/expressions.py`
 * (`hackathon/main`). The weights, the feature definitions and the thresholds are
 * copied verbatim — this is a translation, not a reinterpretation, so their
 * `selftest.py` remains the specification for what these numbers should do.
 *
 * Only the first of their three layers (the 8 general emotions) is ported. Their
 * other two layers are a 12-way persona-expression map for driving the avatar and
 * a 32-way single-action debug list; neither is what this channel sends.
 *
 * Why this runs here rather than calling their Python: MediaPipe Tasks ships a
 * WASM build, so the 52 blendshapes can be produced in the browser and the
 * camera frames never leave the machine. Their module is pure arithmetic over
 * those 52 numbers, so it ports directly.
 *
 * Their own caveat, worth keeping in mind: the weights are hand-tuned from FACS
 * common sense and have **not been calibrated against labelled data**, and the
 * webcam path had never been run against a real camera. Expect to adjust
 * thresholds per face.
 */

export type BlendshapeScores = Readonly<Record<string, number>>;

const clamp = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const pair = (bs: BlendshapeScores, left: string, right: string): number =>
  ((bs[left] ?? 0) + (bs[right] ?? 0)) / 2;

/**
 * The 52 raw scores folded into left/right-symmetric, semantically named
 * features. Rules read far better on top of these than on raw names.
 */
export interface Features {
  browDown: number;
  browInnerUp: number;
  browOuterUp: number;
  blink: number;
  squint: number;
  wide: number;
  lookDown: number;
  smile: number;
  smileLeft: number;
  smileRight: number;
  dimple: number;
  cheekSquint: number;
  frown: number;
  mouthPress: number;
  mouthStretch: number;
  upperUp: number;
  jawOpen: number;
  noseSneer: number;
  cheekPuff: number;
  mouthPucker: number;
  mouthFunnel: number;
  mouthShrugLower: number;
  lowerDown: number;
  mouthSideways: number;
}

export function extractFeatures(bs: BlendshapeScores): Features {
  return {
    browDown: pair(bs, 'browDownLeft', 'browDownRight'),
    browInnerUp: bs.browInnerUp ?? 0,
    browOuterUp: pair(bs, 'browOuterUpLeft', 'browOuterUpRight'),
    blink: pair(bs, 'eyeBlinkLeft', 'eyeBlinkRight'),
    squint: pair(bs, 'eyeSquintLeft', 'eyeSquintRight'),
    wide: pair(bs, 'eyeWideLeft', 'eyeWideRight'),
    lookDown: pair(bs, 'eyeLookDownLeft', 'eyeLookDownRight'),
    smile: pair(bs, 'mouthSmileLeft', 'mouthSmileRight'),
    smileLeft: bs.mouthSmileLeft ?? 0,
    smileRight: bs.mouthSmileRight ?? 0,
    dimple: pair(bs, 'mouthDimpleLeft', 'mouthDimpleRight'),
    cheekSquint: pair(bs, 'cheekSquintLeft', 'cheekSquintRight'),
    frown: pair(bs, 'mouthFrownLeft', 'mouthFrownRight'),
    mouthPress: pair(bs, 'mouthPressLeft', 'mouthPressRight'),
    mouthStretch: pair(bs, 'mouthStretchLeft', 'mouthStretchRight'),
    upperUp: pair(bs, 'mouthUpperUpLeft', 'mouthUpperUpRight'),
    jawOpen: bs.jawOpen ?? 0,
    noseSneer: pair(bs, 'noseSneerLeft', 'noseSneerRight'),
    cheekPuff: bs.cheekPuff ?? 0,
    mouthPucker: bs.mouthPucker ?? 0,
    mouthFunnel: bs.mouthFunnel ?? 0,
    mouthShrugLower: bs.mouthShrugLower ?? 0,
    lowerDown: pair(bs, 'mouthLowerDownLeft', 'mouthLowerDownRight'),
    mouthSideways: Math.max(bs.mouthLeft ?? 0, bs.mouthRight ?? 0),
  };
}

/** One raised corner. Two raised corners is a smile; one is contempt. */
export const smileAsymmetry = (f: Features): number => Math.abs(f.smileLeft - f.smileRight);

/**
 * How much the face is *doing* anything. Blink and gaze are excluded on purpose:
 * closing your eyes or looking away is not an expression. `neutral` scores on the
 * inverse of this, otherwise any unchecked muscle twitch would still leave
 * neutral at full marks and drown out the real expression.
 */
export function activation(f: Features): number {
  return Math.max(
    f.smile,
    smileAsymmetry(f),
    f.frown,
    f.browDown,
    f.browInnerUp,
    f.browOuterUp,
    f.jawOpen,
    f.wide,
    f.squint,
    f.noseSneer,
    f.mouthPucker,
    f.mouthFunnel,
    f.mouthPress,
    f.mouthStretch,
    f.mouthShrugLower,
    f.mouthSideways,
    f.upperUp,
    f.lowerDown,
    f.cheekPuff,
    f.cheekSquint,
    f.dimple,
  );
}

export interface EmotionRule {
  key: string;
  score: (f: Features) => number;
  /** Below this the rule is not reported, so a row of rules cannot all glow faintly. */
  threshold: number;
}

/** Layer 1 of their engine: 8 general emotions. Weights copied verbatim. */
export const EMOTION_RULES: readonly EmotionRule[] = [
  {
    key: 'happy',
    // A real smile also drives cheekSquint (the Duchenne marker); a mouth-only
    // fake smile therefore scores lower.
    score: (f) => 0.75 * f.smile + 0.35 * f.cheekSquint + 0.15 * f.dimple - 0.5 * f.frown,
    threshold: 0.25,
  },
  {
    key: 'sad',
    score: (f) => 0.6 * f.frown + 0.5 * f.browInnerUp + 0.2 * f.lookDown - 0.8 * f.smile,
    threshold: 0.25,
  },
  {
    key: 'angry',
    score: (f) =>
      0.65 * f.browDown +
      0.35 * f.squint +
      0.25 * f.mouthPress +
      0.2 * f.noseSneer -
      0.7 * f.smile -
      0.4 * f.browInnerUp,
    threshold: 0.25,
  },
  {
    key: 'surprised',
    score: (f) =>
      0.45 * f.browInnerUp + 0.35 * f.browOuterUp + 0.4 * f.wide + 0.35 * f.jawOpen - 0.6 * f.browDown,
    threshold: 0.25,
  },
  {
    key: 'fearful',
    // Differs from surprise in the mouth: stretched sideways rather than just open.
    score: (f) =>
      0.4 * f.browInnerUp + 0.35 * f.wide + 0.45 * f.mouthStretch + 0.2 * f.jawOpen - 0.6 * f.smile,
    threshold: 0.25,
  },
  {
    key: 'disgusted',
    score: (f) => 0.7 * f.noseSneer + 0.4 * f.upperUp + 0.25 * f.browDown - 0.5 * f.smile,
    threshold: 0.25,
  },
  {
    key: 'contempt',
    score: (f) =>
      1.2 * smileAsymmetry(f) + 0.25 * f.dimple - 0.4 * Math.min(f.smileLeft, f.smileRight),
    threshold: 0.25,
  },
  {
    key: 'neutral',
    score: (f) => 1 - clamp(1.6 * activation(f)),
    threshold: 0.45,
  },
];

export interface RuleScore {
  key: string;
  score: number;
  /** Cleared its own threshold. Presentation only — see the note below. */
  active: boolean;
}

/**
 * Every rule scored and sorted, best first — matching their `_score_all`, which
 * does **not** filter by threshold. `top_emotion` in their code is simply
 * `emotions[0]`, whatever it scored.
 *
 * Filtering here was a mistranslation and a bad one: a face that is mildly
 * expressive but not clearly any single emotion scores under 0.25 on all seven
 * emotions *and* under neutral's 0.45, so every rule was dropped and the
 * classifier returned nothing at all, permanently. `threshold` belongs to
 * `active`, which their UI uses to decide what to *display*.
 */
export function scoreEmotions(bs: BlendshapeScores): RuleScore[] {
  const f = extractFeatures(bs);
  return EMOTION_RULES.map((rule) => {
    const score = clamp(rule.score(f));
    return { key: rule.key, score, active: score >= rule.threshold };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Exponential smoothing over the raw per-frame scores, matching their
 * `Smoother` (default alpha 0.35). Without it the label flickers every frame.
 */
export class BlendshapeSmoother {
  private previous: Record<string, number> | null = null;

  constructor(private readonly alpha: number = 0.35) {}

  push(bs: BlendshapeScores): BlendshapeScores {
    if (this.previous === null) {
      this.previous = { ...bs };
      return this.previous;
    }
    const next: Record<string, number> = {};
    for (const key of Object.keys(bs)) {
      const prior = this.previous[key] ?? 0;
      next[key] = prior + this.alpha * ((bs[key] ?? 0) - prior);
    }
    this.previous = next;
    return next;
  }

  reset(): void {
    this.previous = null;
  }
}
