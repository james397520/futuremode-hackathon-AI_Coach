/**
 * Lipsync — a procedural mouth envelope driven by `speaking`, and the hook
 * where real audio-to-expression frames will plug in.
 *
 * The persona's TTS is played by the simulation, not here, and Phase 1 gives us
 * no phoneme timing — only `speaking: true/false`. So the mouth is a *plausible*
 * envelope rather than a transcript: viseme targets change every 80–160ms with
 * a smoothed follower, and while speaking the jaw never fully closes (the
 * archive's finding: a mouth that snaps shut between syllables reads as
 * stuttering video, a mouth that keeps a small opening reads as talking).
 *
 * When `speaking` flips false the envelope decays to zero within ~150ms.
 *
 * Output is an ARKit dict, not VRM weights, so the same `arkitToVrm()` handles
 * this and the future A2E frames identically.
 */
import type { ArkitWeights } from './expression-to-vrm';

/**
 * LAM-A2E interface (archive `sample_a2e.json`): `fps` × `names[52]` ×
 * `frames[N][52]`. Produced later by onnxruntime-web from 16 kHz PCM; consumed
 * by `A2EPlayer` below. Inference itself is deliberately not implemented here.
 */
export interface A2EClip {
  fps: number;
  names: string[];
  frames: number[][];
}

/** Anything that yields a speech layer per frame. */
export interface SpeechSource {
  /** Advance by `dt` seconds; `null` means "no speech layer this frame". */
  sample(dt: number, speaking: boolean): ArkitWeights | null;
  /** True while a mouth is meaningfully open — used by the stage to keep 60fps. */
  active(): boolean;
}

/** Viseme targets in ARKit space. Weighted so Mandarin's open vowels dominate. */
const VISEMES: ReadonlyArray<{ w: number; shape: ArkitWeights }> = [
  { w: 3, shape: { jawOpen: 0.55, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 } }, // a
  { w: 2, shape: { jawOpen: 0.3, mouthStretchLeft: 0.45, mouthStretchRight: 0.45 } }, // i
  { w: 2, shape: { jawOpen: 0.28, mouthFunnel: 0.5, mouthPucker: 0.35 } }, // u / o
  { w: 2, shape: { jawOpen: 0.32, mouthUpperUpLeft: 0.4, mouthUpperUpRight: 0.4 } }, // e
  { w: 1, shape: { jawOpen: 0.18, mouthPressLeft: 0.2, mouthPressRight: 0.2 } }, // m / b (near close)
];
const VISEME_TOTAL = VISEMES.reduce((s, v) => s + v.w, 0);

/** Floor on jawOpen while speaking — the "never fully closed" rule. */
const MIN_OPEN_WHILE_SPEAKING = 0.12;

/**
 * How far of each viseme actually gets used.
 *
 * The table above is written as "what this vowel looks like at full effort",
 * which is right for a shouted 「啊」 and much too much for someone talking
 * across a desk. On the Rocketbox heads `aa` at 0.75 is a yawn — the jaw drops
 * to its mechanical limit and the face reads as a puppet. Conversational
 * speech lives in the bottom half of the range, so the shapes are scaled here,
 * once, instead of every number in the table being re-tuned by hand.
 */
const VISEME_SCALE = 0.58;

const CHANNELS = [
  'jawOpen', 'mouthStretchLeft', 'mouthStretchRight', 'mouthFunnel', 'mouthPucker',
  'mouthUpperUpLeft', 'mouthUpperUpRight', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthPressLeft', 'mouthPressRight',
] as const;
type Channel = (typeof CHANNELS)[number];

export class ProceduralLipsync implements SpeechSource {
  private timer = 0;
  private readonly target: Record<Channel, number> = blank();
  private readonly current: Record<Channel, number> = blank();
  private readonly out: ArkitWeights = {};
  private energy = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  sample(dt: number, speaking: boolean): ArkitWeights | null {
    if (speaking) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.pickViseme();
        this.timer = 0.08 + this.rng() * 0.08;
      }
    } else {
      for (const c of CHANNELS) this.target[c] = 0;
    }

    // Fast attack, slightly slower release — speech onsets are crisp.
    const k = 1 - Math.exp(-dt * (speaking ? 22 : 14));
    let sum = 0;
    for (const c of CHANNELS) {
      this.current[c] += (this.target[c] - this.current[c]) * k;
      sum += this.current[c];
    }
    if (speaking) {
      this.current.jawOpen = Math.max(this.current.jawOpen, MIN_OPEN_WHILE_SPEAKING);
    }
    this.energy = sum;

    if (!speaking && sum < 0.004) {
      for (const c of CHANNELS) this.current[c] = 0;
      this.energy = 0;
      return null;
    }
    for (const c of CHANNELS) {
      const v = this.current[c];
      if (v > 0.002) this.out[c] = v;
      else delete this.out[c];
    }
    return this.out;
  }

  active(): boolean {
    return this.energy > 0.004;
  }

  private pickViseme(): void {
    let r = this.rng() * VISEME_TOTAL;
    let chosen = VISEMES[0]!;
    for (const v of VISEMES) {
      r -= v.w;
      if (r <= 0) {
        chosen = v;
        break;
      }
    }
    // Amplitude jitter per syllable so no two "a"s are identical.
    const gain = (0.75 + this.rng() * 0.45) * VISEME_SCALE;
    for (const c of CHANNELS) this.target[c] = 0;
    for (const key of Object.keys(chosen.shape) as Channel[]) {
      this.target[key] = Math.min(1, (chosen.shape[key] ?? 0) * gain);
    }
  }
}

/**
 * Plays an `A2EClip` with inter-frame linear interpolation — the archive's
 * `sampleA2E()`. It exists so the audio-to-expression path has a concrete seam:
 * `setClip()` with real inference output and the stage needs no other change.
 * Not wired to any audio yet.
 */
export class A2EPlayer implements SpeechSource {
  private clip: A2EClip | null = null;
  private time = 0;
  private readonly out: ArkitWeights = {};

  setClip(clip: A2EClip | null): void {
    this.clip = clip;
    this.time = 0;
  }

  sample(dt: number, speaking: boolean): ArkitWeights | null {
    const clip = this.clip;
    if (!clip || !speaking || clip.frames.length === 0) return null;
    this.time += dt;
    const duration = clip.frames.length / clip.fps;
    if (this.time >= duration) {
      // A clip is one utterance; do not loop it — hand back to the caller.
      this.clip = null;
      return null;
    }
    const x = this.time * clip.fps;
    const i0 = Math.floor(x) % clip.frames.length;
    const i1 = (i0 + 1) % clip.frames.length;
    const t = x - Math.floor(x);
    const f0 = clip.frames[i0]!;
    const f1 = clip.frames[i1]!;
    for (const k of Object.keys(this.out)) delete this.out[k as keyof ArkitWeights];
    for (let j = 0; j < clip.names.length; j++) {
      const v = (f0[j] ?? 0) + ((f1[j] ?? 0) - (f0[j] ?? 0)) * t;
      if (v > 0.001) this.out[clip.names[j] as keyof ArkitWeights] = v;
    }
    return this.out;
  }

  active(): boolean {
    return this.clip !== null;
  }
}

function blank(): Record<Channel, number> {
  const o = {} as Record<Channel, number>;
  for (const c of CHANNELS) o[c] = 0;
  return o;
}
