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
// Kept in step with the API's `FACE_REACT_MIN_CONFIDENCE` and
// `FACE_MIN_CONFIDENCE` (both 0.42). If this floor were higher the trainee
// would be offered help for an expression the customer never reacted to; if it
// were lower, the reverse.
const MIN_CONFIDENCE = 0.42;
// How long the expression has to be held. Long enough not to fire on a blink
// or a glance away, short enough that someone frowning at a demo sees the card
// while they are still frowning.
const SUSTAIN_MS = 1200;
// Between cards. 30 s was long enough that a second frown in the same exchange
// simply produced nothing, which reads as the feature having broken rather than
// as restraint.
const COOLDOWN_MS = 12_000;
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
  // Forces the effect below to look again while a frown is still being held.
  const [recheck, setRecheck] = useState(0);
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
    if (held < SUSTAIN_MS) {
      // The analyser only emits when the label changes or the confidence moves
      // (`shouldEmit`), so *holding* a frown produces no further readings — and
      // this effect, which only runs on a new reading, never got to see that
      // the 1.5 s had elapsed. A steady frown therefore never opened the card,
      // which is exactly the way anyone actually frowns at a demo. Come back
      // when the time is up instead of waiting for a signal that will not
      // arrive.
      const timer = window.setTimeout(() => setRecheck((n) => n + 1), SUSTAIN_MS - held + 50);
      return () => window.clearTimeout(timer);
    }
    if (visible || !armedRef.current || Date.now() - lastShownRef.current < COOLDOWN_MS) return;

    armedRef.current = false;
    lastShownRef.current = Date.now();
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  }, [reading, cameraLive, traineesTurn, visible, recheck]);

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
