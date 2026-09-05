/**
 * Trainee affect (facial emotion) — the seam the recogniser plugs into.
 *
 * The camera pipeline is built as a *channel*, not as a model: `use-camera-session`
 * opens the webcam, samples frames at a low rate and hands each one to whatever
 * `AffectAnalyzer` is registered. Nothing in this repo classifies a face today —
 * `nullAnalyzer` is installed by default and returns nothing, so the camera
 * button works, frames flow, and the socket command is exercised end to end
 * with zero inference running.
 *
 * To drop a real model in, call `setAffectAnalyzer()` once (a module import in
 * the page, or a dev console call) with something matching `AffectAnalyzer`.
 * Nothing else in the app needs to change.
 *
 * Privacy (§40.2 / §73): **frames never leave the browser.** Only the label and
 * a confidence are sent over the existing session socket, and only when the
 * label changes or the confidence moves materially. There is no video upload
 * path, and deliberately so — adding one is a product/legal decision, not a
 * refactor.
 */

/** Coarse labels. Deliberately small: a 7-way FER model maps onto this cleanly. */
export const AFFECT_LABELS = [
  'neutral',
  'happy',
  'surprised',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'contempt',
] as const;
export type AffectLabel = (typeof AFFECT_LABELS)[number];

export interface AffectReading {
  label: AffectLabel;
  /** 0–1. Readings below `MIN_CONFIDENCE` are dropped rather than sent as noise. */
  confidence: number;
  /** Optional per-label scores, when the model produces them. */
  scores?: Partial<Record<AffectLabel, number>>;
}

export interface AffectAnalyzer {
  /** Human-readable id, surfaced in telemetry so we know which model spoke. */
  readonly id: string;
  /** Called once before the first frame. Load weights here. */
  init?: () => Promise<void>;
  /**
   * Classify one frame. Receives the raw video element so a model can choose
   * its own downscale/crop strategy; must not retain a reference to it.
   * Returning `null` means "no face / not confident" and emits nothing.
   */
  analyze: (frame: HTMLVideoElement) => Promise<AffectReading | null> | AffectReading | null;
  dispose?: () => void;
}

/**
 * Readings below this are treated as no reading at all.
 *
 * The fourth of four floors on the same signal, and the earliest: a reading
 * dropped here never reaches the nudge, the socket, or the customer. All four
 * are 0.42 — this one, `affect-nudge`'s, and the API's `FACE_REACT_MIN_CONFIDENCE`
 * and `FACE_MIN_CONFIDENCE`. They have to agree, or the highest one silently
 * decides and the other three are decoration.
 */
export const MIN_CONFIDENCE = 0.42;

/** Sampling rate. 4 fps is plenty for an emotion trend and costs almost nothing. */
export const SAMPLE_INTERVAL_MS = 250;

/**
 * Emit only on a real change: a different label, or the same label with a
 * confidence that moved by this much. Without this the socket would carry four
 * identical messages a second for a face that is simply sitting still.
 */
export const CONFIDENCE_EPSILON = 0.15;

const nullAnalyzer: AffectAnalyzer = {
  id: 'null',
  analyze: () => null,
};

let current: AffectAnalyzer = nullAnalyzer;

/**
 * Registration happens in an effect, i.e. *after* the first render, so anything
 * rendering "is a model installed?" has to be told when that changes rather
 * than reading the value once.
 */
const listeners = new Set<() => void>();

export function subscribeToAffectAnalyzer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Dev-only seam (`window.__aiCoachAffectDriver`), mirroring `window.__aiCoachVrm`.
 * Distinct from `window.__aiCoachAffect`, which `mediapipe-affect.ts` uses to
 * expose the real analyser instance: this one *swaps* the analyser.
 *
 * The frown → "need a hand?" → coach-hint chain is the one demo beat that
 * cannot be exercised without a face in front of a camera, which no automated
 * check has. Registering a stand-in analyser here lets that path be driven and
 * measured end to end. Stripped from production builds.
 */
function installDevHandle(): void {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return;
  const handle = {
    setAnalyzer: setAffectAnalyzer,
    /** Feed one fixed reading, e.g. `fake('angry', 0.7)`. */
    fake: (label: AffectLabel, confidence = 0.7) =>
      setAffectAnalyzer({ id: `fake:${label}`, analyze: () => ({ label, confidence }) }),
  };
  (window as Window & { __aiCoachAffectDriver?: typeof handle }).__aiCoachAffectDriver = handle;
}

export function setAffectAnalyzer(analyzer: AffectAnalyzer | null): void {
  if (current !== nullAnalyzer) current.dispose?.();
  current = analyzer ?? nullAnalyzer;
  for (const listener of listeners) listener();
}

export function getAffectAnalyzer(): AffectAnalyzer {
  return current;
}

/** True while no real model is installed — the UI says "channel open, no model". */
export function affectAnalyzerInstalled(): boolean {
  return current !== nullAnalyzer;
}

/** Should this reading be sent, given what was last sent? */
export function shouldEmit(next: AffectReading, last: AffectReading | null): boolean {
  if (next.confidence < MIN_CONFIDENCE) return false;
  if (last === null) return true;
  if (last.label !== next.label) return true;
  return Math.abs(last.confidence - next.confidence) >= CONFIDENCE_EPSILON;
}

/**
 * The browser's eight labels in the server's six-label space, mirroring
 * `apps/api/app/domain/affect.py::FACE_TO_LABEL`. Kept in step by hand; the two
 * lists are short and a mismatch shows up immediately as a mislabelled badge.
 * `surprised` has no counterpart — surprise is not an attitude to the
 * conversation — so it maps to 不明確 rather than being forced into 緊張.
 */
export const FACE_TO_AFFECT_LABEL: Record<AffectLabel, string> = {
  neutral: '平穩',
  happy: '正向',
  sad: '挫折',
  // 苦惱 rather than 不耐煩 — see `FACE_TO_LABEL` in the API's `domain/affect.py`.
  angry: '苦惱',
  disgusted: '苦惱',
  contempt: '苦惱',
  fearful: '緊張',
  surprised: '不明確',
};

installDevHandle();
