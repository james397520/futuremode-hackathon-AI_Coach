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

/** Readings below this are treated as no reading at all. */
export const MIN_CONFIDENCE = 0.45;

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
