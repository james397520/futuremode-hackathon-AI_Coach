'use client';

/**
 * MediaPipe FaceLandmarker as an `AffectAnalyzer`.
 *
 * This is the model half of the webcam channel; `lib/affect.ts` is the seam and
 * `use-camera-session.ts` is the plumbing. Classification is the team's rule
 * engine from `emotion_webcam/expressions.py`, ported in
 * `blendshape-expressions.ts` — MediaPipe supplies the 52 blendshapes, the rules
 * turn them into an emotion.
 *
 * Everything is same-origin on purpose. The CSP in `next.config.mjs` lists only
 * our own API/WS origins in `connect-src`, so fetching the WASM or the 3.6MB
 * model from Google's CDN would be blocked silently. Both are vendored into
 * `public/mediapipe/` instead, which is `'self'`. `script-src` already carries
 * `'wasm-unsafe-eval'`, so the WASM runtime itself is allowed.
 *
 * The model is loaded lazily on the first camera start, not at import: nobody
 * who never opens the camera should pay 3.6MB.
 */
import type { AffectAnalyzer, AffectLabel, AffectReading } from './affect';
import { AFFECT_LABELS } from './affect';
import { BlendshapeSmoother, scoreEmotions, type BlendshapeScores } from './blendshape-expressions';

/**
 * Dev-only handle, mirroring `window.__aiCoachVrm`. The rule weights are the
 * team's own hand-tuned FACS numbers with no calibration behind them, so being
 * able to point the model at a face and read the raw scores back is how the
 * thresholds get tuned per camera:
 *
 *   await window.__aiCoachAffect.init()
 *   window.__aiCoachAffect.analyze(document.querySelector('video'))
 */
const DEBUG_HANDLE = process.env.NODE_ENV !== 'production';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/mediapipe/face_landmarker.task';

type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => {
    faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  };
  close: () => void;
};

function isAffectLabel(key: string): key is AffectLabel {
  return (AFFECT_LABELS as readonly string[]).includes(key);
}

declare global {
  interface Window {
    __aiCoachAffect?: AffectAnalyzer;
  }
}

export function createMediaPipeAffectAnalyzer(): AffectAnalyzer {
  let landmarker: Landmarker | null = null;
  const smoother = new BlendshapeSmoother(0.35);
  // detectForVideo rejects a timestamp that is not strictly increasing, and two
  // frames sampled inside the same millisecond will otherwise throw.
  let lastTimestamp = 0;

  const analyzer: AffectAnalyzer = {
    id: 'mediapipe-facelandmarker',

    async init() {
      if (landmarker) return;
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      landmarker = (await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      })) as unknown as Landmarker;
      smoother.reset();
    },

    analyze(video: HTMLVideoElement): AffectReading | null {
      if (!landmarker) return null;
      const timestamp = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = timestamp;

      const result = landmarker.detectForVideo(video, timestamp);
      const categories = result.faceBlendshapes?.[0]?.categories;
      if (!categories || categories.length === 0) {
        // No face in frame. Reset so the next face does not inherit this one's
        // smoothing tail.
        smoother.reset();
        return null;
      }

      const raw: Record<string, number> = {};
      for (const c of categories) raw[c.categoryName] = c.score;
      const smoothed: BlendshapeScores = smoother.push(raw);

      const ranked = scoreEmotions(smoothed);
      const best = ranked[0];
      if (!best || !isAffectLabel(best.key)) return null;

      const scores: Partial<Record<AffectLabel, number>> = {};
      for (const r of ranked) {
        if (isAffectLabel(r.key)) scores[r.key] = r.score;
      }
      return { label: best.key, confidence: best.score, scores };
    },

    dispose() {
      landmarker?.close();
      landmarker = null;
      smoother.reset();
      lastTimestamp = 0;
      if (DEBUG_HANDLE && typeof window !== 'undefined' && window.__aiCoachAffect === analyzer) {
        delete window.__aiCoachAffect;
      }
    },
  };

  if (DEBUG_HANDLE && typeof window !== 'undefined') window.__aiCoachAffect = analyzer;
  return analyzer;
}
