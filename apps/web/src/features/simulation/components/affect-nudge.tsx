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

import { FACE_TO_AFFECT_LABEL, type AffectLabel, type AffectReading } from '../lib/affect';
import { insetSurface, toneText } from '../lib/tone';
import { LightbulbIcon } from './icons';
import { cn } from './kit';

const NEGATIVE_LABELS = ['angry', 'sad', 'fearful', 'disgusted', 'contempt'] as const satisfies readonly AffectLabel[];
const NEGATIVE: ReadonlySet<AffectLabel> = new Set<AffectLabel>(NEGATIVE_LABELS);
// Kept in step with the API's `FACE_REACT_MIN_CONFIDENCE` and
// `FACE_MIN_CONFIDENCE` (both 0.42). If this floor were higher the trainee
// would be offered help for an expression the customer never reacted to; if it
// were lower, the reverse.
const MIN_CONFIDENCE = 0.25;
// How long the expression has to be held before help is offered. Three seconds
// is a decision, not a flicker: long enough that a glance away or a moment of
// concentration is not read as being stuck.
const SUSTAIN_MS = 3000;
// The detection itself is acknowledged much sooner. Seeing that the system
// noticed is worth something on its own — and without it, the three seconds
// before the offer look like nothing is happening.
const NOTICE_MS = 800;
// How long a lost expression is tolerated before the streak is torn down.
const CLEAR_GRACE_MS = 600;
// Between cards. 30 s was long enough that a second frown in the same exchange
// simply produced nothing, which reads as the feature having broken rather than
// as restraint.
const COOLDOWN_MS = 12_000;
const AUTO_HIDE_MS = 15_000;

export interface AffectNudgeProps {
  reading: AffectReading | null;
  cameraLive: boolean;
  /**
   * Whether the floor is available for an offer of help. Both call sites pass
   * "the session is running", not literally the trainee's turn — a frown during
   * the customer's answer is the most natural moment to look stuck.
   */
  traineesTurn: boolean;
  /** The classifier saw no face. A stale reading must not keep a streak alive. */
  noFace?: boolean;
  /** Undefined in assessment mode — the control must not exist there (§8.4). */
  onAskHint?: (() => void) | undefined;
  className?: string;
}

export function AffectNudge({
  reading,
  cameraLive,
  traineesTurn,
  noFace = false,
  onAskHint,
  className,
}: AffectNudgeProps) {
  const [visible, setVisible] = useState(false);
  // The quiet half: "we can see it", shown while the offer is not (yet) due.
  const [noticed, setNoticed] = useState(false);
  // Forces the effect below to look again while a frown is still being held.
  const [recheck, setRecheck] = useState(0);
  const sinceRef = useRef<number | null>(null);
  const lastShownRef = useRef(0);
  const armedRef = useRef(true);
  // When the expression was last actually seen, so a one-frame dropout does not
  // reset a streak that is otherwise healthy.
  const lastSeenRef = useRef(0);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Detection is independent of whose turn it is: the face is the face.
    //
    // The score compared against the floor is the best *negative* rule's, not
    // the winning label's. They differ: `neutral` is in the same ranking, so by
    // the time a frown wins it has only just crossed neutral and its own score
    // is around 0.27 — gating on that number meant gating on "has this person
    // crossed from a frown into a scowl".
    const negativeScore =
      reading === null
        ? 0
        : Math.max(
            ...NEGATIVE_LABELS.map(
              (key) => reading.scores?.[key] ?? (reading.label === key ? reading.confidence : 0),
            ),
          );
    const detected =
      cameraLive &&
      reading !== null &&
      !noFace &&
      NEGATIVE.has(reading.label) &&
      negativeScore >= MIN_CONFIDENCE;

    if (detected) lastSeenRef.current = Date.now();

    if (!detected) {
      // One frame is not "the frown stopped". Speech drives jawOpen and the
      // mouth channels, which can promote `surprised` — not a negative label —
      // for a frame or two, and the streak needs 12 consecutive clean samples
      // at 250 ms to reach three seconds. Without this grace the clock reset
      // every time the trainee opened their mouth, which is most of the time.
      if (sinceRef.current !== null && Date.now() - lastSeenRef.current < CLEAR_GRACE_MS) {
        const timer = window.setTimeout(() => setRecheck((n) => n + 1), CLEAR_GRACE_MS);
        return () => window.clearTimeout(timer);
      }
      // The expression cleared: re-arm. A fresh frown later is a new signal.
      sinceRef.current = null;
      armedRef.current = true;
      setNoticed(false);
      return;
    }
    if (sinceRef.current === null) sinceRef.current = Date.now();
    const held = Date.now() - sinceRef.current;

    // The analyser only emits when the label changes or the confidence moves
    // (`shouldEmit`), so *holding* a frown produces no further readings — and
    // this effect, which only runs on a new reading, would never see that the
    // time had elapsed. A steady frown therefore never opened anything, which
    // is exactly the way anyone frowns at a demo. Come back when the next
    // threshold is due instead of waiting for a signal that will not arrive.
    const next = held < NOTICE_MS ? NOTICE_MS : held < SUSTAIN_MS ? SUSTAIN_MS : null;
    if (next !== null) {
      const timer = window.setTimeout(() => setRecheck((n) => n + 1), next - held + 50);
      if (held >= NOTICE_MS) setNoticed(true);
      return () => window.clearTimeout(timer);
    }
    setNoticed(true);

    // Offering help is the part that needs the floor: a card asking whether you
    // want a hand is noise while the customer is still talking.
    if (!traineesTurn) return;
    // `armedRef` is the important guard: one continuous frown gets one card,
    // however long it lasts. Without it the cooldown alone re-showed the card
    // every 30s to someone who had already answered it.
    if (visible || !armedRef.current || Date.now() - lastShownRef.current < COOLDOWN_MS) return;

    armedRef.current = false;
    lastShownRef.current = Date.now();
    setVisible(true);
    hideTimerRef.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    // `noticed` is deliberately NOT a dependency: adding it would make
    // `setNoticed(true)` re-run this effect, whose cleanup would then cancel the
    // very timer that advances to the next threshold.
  }, [reading, cameraLive, traineesTurn, noFace, visible, recheck]);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  if (!visible || !onAskHint) {
    // Not offering help, but the expression was seen. Saying so is the whole
    // difference between a system that is watching and one that looks broken.
    if (!noticed || !cameraLive || reading === null) return null;
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'sim-card-enter mx-1.5 mb-2 flex items-center gap-2 rounded-pill px-3 py-1.5',
          className,
        )}
        style={insetSurface('violet', 8)}
      >
        <span
          aria-hidden
          className="inline-block size-1.5 rounded-pill"
          style={{ backgroundColor: toneText('violet') }}
        />
        <span className="text-tiny text-text-secondary">
          偵測到你的情緒：{FACE_TO_AFFECT_LABEL[reading.label] ?? reading.label}
        </span>
      </div>
    );
  }

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
