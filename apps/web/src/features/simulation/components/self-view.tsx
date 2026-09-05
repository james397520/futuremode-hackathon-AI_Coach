'use client';

/**
 * Trainee self-view — the picture from `use-camera-session`, floated over the
 * persona stage, with the emotion badge in its top-right corner.
 *
 * Mirrored (`scaleX(-1)`), because an un-mirrored self-view reads as someone
 * else's face and people instinctively move the wrong way to re-centre.
 *
 * The `<video>` element is mounted **even while the camera is off**: `videoRef`
 * has to exist before `getUserMedia` resolves, or there is nothing to attach the
 * stream to and the first frame is dropped. It is hidden with `opacity`, never
 * unmounted.
 *
 * No confidence percentage is shown. That number is an uncalibrated rule-engine
 * score (see `blendshape-expressions.ts`); printing it as a percentage would
 * claim a precision it does not have. The badge's face and the name under it
 * are the whole reading.
 */
import type { MutableRefObject } from 'react';

import type { TraineeAffect } from '@ai-coach/shared';

import type { AffectReading } from '../lib/affect';
import { FACE_TO_AFFECT_LABEL, MIN_CONFIDENCE } from '../lib/affect';
import { AFFECT_LABEL } from '../lib/labels';
import { onMediaSurface } from '../lib/tone';
import { AffectFace } from './affect-face';
import { cn } from './kit';

export interface SelfViewProps {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  live: boolean;
  /** Latest analysis, or null while nothing has been classified yet. */
  reading: AffectReading | null;
  /** False when no `AffectAnalyzer` is registered — the badge says so plainly. */
  analyzerInstalled: boolean;
  /** Model is downloading / compiling; the picture is already showing. */
  modelLoading?: boolean;
  /** Classifier ran but found no face. */
  noFace?: boolean;
  /** Classifier threw. Shown so a broken model is not mistaken for a still face. */
  lastError?: string | null;
  error?: string | null;
  /**
   * Server-fused reading (text + face). It arrives once per turn, so the live
   * face reading above still drives the badge between turns — otherwise the
   * badge would freeze for the whole time the customer is answering.
   */
  fused?: TraineeAffect | null;
  className?: string;
}

export function SelfView({
  videoRef,
  live,
  reading,
  analyzerInstalled,
  modelLoading = false,
  noFace = false,
  lastError = null,
  error = null,
  fused = null,
  className,
}: SelfViewProps) {
  // The fused label is the product's answer; the raw face is only what this
  // machine happens to see right now. Prefer the former whenever it has one,
  // and say so when the two signals disagreed.
  const fusedLabel = fused && fused.source !== 'none' ? fused.label : null;
  // Same floor the rest of the pipeline uses. Without it this badge announced
  // 苦惱 at a score nothing else would act on, so the one visible signal said
  // "seen" while the offer of help, the socket and the customer all stayed
  // silent — which reads as broken, and is worse than showing nothing.
  const liveLabel =
    reading && reading.confidence >= MIN_CONFIDENCE
      ? FACE_TO_AFFECT_LABEL[reading.label]
      : null;

  const status = error
    ? error
    : lastError
      ? '辨識失敗'
      : modelLoading
        ? '載入辨識模型…'
        : !analyzerInstalled
          ? '尚未載入模型'
          : noFace
            ? '沒有偵測到臉'
            : (fusedLabel ?? liveLabel ?? '偵測中…');

  // The badge only wears a real face when there is a real reading behind it.
  const faceLabel = reading && analyzerInstalled && !noFace && !lastError ? reading.label : null;
  const conflicted = fused?.conflict === true;

  return (
    <div
      className={cn(
        'pointer-events-none absolute right-3 top-3 z-20 w-[clamp(13rem,34%,21rem)] transition-opacity duration-300',
        live ? 'opacity-100' : 'opacity-0',
        className,
      )}
      aria-hidden={!live}
    >
      <div className="sim-self-view relative overflow-hidden rounded-card">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          // Mirrored self-view; `object-cover` so a 4:3 camera fills the 16:10 box.
          className="block aspect-[16/10] w-full scale-x-[-1] object-cover"
        />

        {/* Emotion badge, top-right of the picture, name underneath it. */}
        <div className="absolute right-2.5 top-2.5 flex w-[5rem] flex-col items-center gap-1.5">
          <AffectFace
            label={faceLabel}
            size={54}
            title={`目前情緒：${status}`}
            className="sim-affect-face"
          />
          <span
            className="max-w-full truncate rounded-pill px-2 py-0.5 text-center text-tiny backdrop-blur"
            style={onMediaSurface(58)}
            // A conflict is not an error and must not be hidden: the words and
            // the face said different things, and the words won.
            title={
              conflicted
                ? '文字與表情判讀不一致，以文字（有逐字證據）為準'
                : (fused?.evidence_quote || undefined)
            }
          >
            {status}
            {conflicted ? ' ·⁉' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
