'use client';

/**
 * Trainee self-view — the picture from `use-camera-session`, floated over the
 * persona stage so you can see what the affect channel is looking at.
 *
 * Mirrored (`scaleX(-1)`), because an un-mirrored self-view reads as someone
 * else's face and people instinctively move the wrong way to re-centre.
 *
 * The `<video>` element is mounted **even while the camera is off**: `videoRef`
 * has to exist before `getUserMedia` resolves, or there is nothing to attach the
 * stream to and the first frame is dropped. It is hidden with `opacity`/
 * `pointer-events`, never unmounted.
 */
import type { MutableRefObject } from 'react';

import { AFFECT_LABEL } from '../lib/labels';
import type { AffectReading } from '../lib/affect';
import { onMediaSurface } from '../lib/tone';
import { CameraOffIcon } from './icons';
import { cn } from './kit';

export interface SelfViewProps {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  live: boolean;
  /** Latest reading that passed the filter, or null while no model is installed. */
  reading: AffectReading | null;
  /** False when no `AffectAnalyzer` is registered — the strip says so plainly. */
  analyzerInstalled: boolean;
  /** Model is downloading / compiling; the picture is already showing. */
  modelLoading?: boolean;
  /** Classifier ran but found no face. */
  noFace?: boolean;
  /** Classifier threw. Shown so a broken model is not mistaken for a still face. */
  lastError?: string | null;
  error?: string | null;
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
  className,
}: SelfViewProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute right-3 top-3 z-20 w-[clamp(7rem,17%,11rem)] transition-opacity duration-300',
        live ? 'opacity-100' : 'pointer-events-none opacity-0',
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

        {/* Status strip: the label when a model is running, an honest note when
            the channel is open but nothing is classifying yet. */}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-2 py-1 text-tiny backdrop-blur"
          style={onMediaSurface(58)}
        >
          {error ?? lastError ? (
            <>
              <CameraOffIcon size={11} />
              <span className="truncate">{error ?? '辨識失敗'}</span>
            </>
          ) : modelLoading ? (
            <span className="truncate">載入辨識模型…</span>
          ) : noFace ? (
            <span className="truncate">畫面中沒有偵測到臉</span>
          ) : analyzerInstalled && reading ? (
            <>
              <span className="truncate">
                {AFFECT_LABEL[reading.label] ?? reading.label}
              </span>
              <span className="ml-auto shrink-0 tabular-nums opacity-80">
                {Math.round(reading.confidence * 100)}%
              </span>
            </>
          ) : (
            <span className="truncate">{analyzerInstalled ? '偵測中…' : '尚未載入辨識模型'}</span>
          )}
        </div>
      </div>
    </div>
  );
}
