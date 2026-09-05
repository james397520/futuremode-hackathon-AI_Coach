'use client';

/**
 * The reaction to a frown.
 *
 * When the webcam reads a sustained negative expression while the trainee is
 * the one who should be talking, a small card appears directly above the
 * composer: "這句不好接？我可以給一個回應方向。" One tap asks the coach for a
 * hint through the normal §24 path; the other dismisses it.
 *
 * Why here and why the live reading: the fused server-side affect arrives once
 * per turn, after the trainee has spoken — too late to help them speak. The
 * browser's own face reading is available every 250ms, so this reacts within
 * ~1.5s of the expression, and it is placed where the eye already is (the
 * composer), not in the side panel.
 *
 * Guardrails: needs the label for `SUSTAIN_MS` continuously (a blink of a frown
 * is not a signal), shows at most once per `COOLDOWN_MS`, auto-hides, and never
 * says what emotion it thinks it saw — that would be the system psychoanalysing
 * the user, which is exactly the failure mode the affect design avoids.
 */
import { useEffect, useRef, useState } from 'react';

import type { AffectReading } from '../lib/affect';
import { insetSurface, toneText } from '../lib/tone';
import { LightbulbIcon } from './icons';
import { cn } from './kit';

const NEGATIVE = new Set(['angry', 'sad', 'fearful', 'disgusted', 'contempt']);
const MIN_CONFIDENCE = 0.55;
const SUSTAIN_MS = 1500;
const COOLDOWN_MS = 30_000;
const AUTO_HIDE_MS = 15_000;

export interface AffectNudgeProps {
  reading: AffectReading | null;
  cameraLive: boolean;
  /** Only offer help when it is the trainee's turn to talk. */
  traineesTurn: boolean;
  /** Undefined in assessment mode — the control must not exist there (§8.4). */
  onAskHint?: (() => void) | undefined;
  className?: string;
}

export function AffectNudge({ reading, cameraLive, traineesTurn, onAskHint, className }: AffectNudgeProps) {
  const [visible, setVisible] = useState(false);
  const sinceRef = useRef<number | null>(null);
  const lastShownRef = useRef(0);
  const armedRef = useRef(true);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const negative =
      cameraLive &&
      traineesTurn &&
      reading !== null &&
      NEGATIVE.has(reading.label) &&
      reading.confidence >= MIN_CONFIDENCE;

    if (!negative) {
      // The expression cleared: re-arm. A fresh frown later is a new signal.
      sinceRef.current = null;
      armedRef.current = true;
      return;
    }
    if (sinceRef.current === null) sinceRef.current = Date.now();
    const held = Date.now() - sinceRef.current;
    // `armedRef` is the important guard: one continuous frown gets one card,
    // however long it lasts. Without it the cooldown alone re-showed the card
    // every 30s to someone who had already answered it.
    if (
      held < SUSTAIN_MS ||
      visible ||
      !armedRef.current ||
      Date.now() - lastShownRef.current < COOLDOWN_MS
    )
      return;

    armedRef.current = false;
    lastShownRef.current = Date.now();
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, [reading, cameraLive, traineesTurn, visible]);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  // Hand the floor back the moment the trainee starts talking.
  useEffect(() => {
    if (!traineesTurn && visible) setVisible(false);
  }, [traineesTurn, visible]);

  if (!visible || !onAskHint) return null;

  const dismiss = (): void => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    setVisible(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'sim-card-enter mx-1.5 mb-2 flex items-center gap-3 rounded-card border px-3.5 py-2.5',
        className,
      )}
      style={insetSurface('violet', 12)}
    >
      <LightbulbIcon size={16} style={{ color: toneText('violet') }} />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-text-primary">這句不好接？</p>
        <p className="text-tiny text-text-secondary">我可以給你一個回應方向，不會替你講。</p>
      </div>
      <button
        type="button"
        onClick={() => {
          onAskHint();
          dismiss();
        }}
        className="sim-focusable shrink-0 rounded-pill px-3 py-1.5 text-meta font-medium"
        style={{ background: 'var(--action-dark)', color: 'var(--text-on-accent)' }}
      >
        給我方向
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="sim-focusable shrink-0 rounded-pill px-2.5 py-1.5 text-meta text-text-secondary"
        style={insetSurface('neutral', 9)}
      >
        我自己來
      </button>
    </div>
  );
}
