'use client';

/**
 * §53 fallback — the floor of the ladder, rendered as a first-class visual.
 *
 *   LivePortrait fails  → freeze expression, MuseTalk keeps the mouth moving
 *   MuseTalk fails      → LivePortrait motion + audio
 *   both fail / absent  → **this component**: static portrait + audio
 *
 * Until the engines are installed this is what everyone sees, so it is built to
 * be presentable rather than apologetic: the prepared portrait (or the persona's
 * initial in a squircle) breathes, blinks, drifts its head inside the §70 clamp,
 * and changes colour temperature with the persona's emotion. Nothing here claims
 * to be a live video, and nothing here looks broken.
 *
 * All motion is CSS (see `avatar-styles.tsx`) and collapses under
 * `prefers-reduced-motion`; the expression is still legible from the caption and
 * the wash, which do not depend on animation.
 */
import { useMemo, type CSSProperties } from 'react';

import { EXPRESSION_LABEL, EXPRESSION_TONE } from '../lib/expression';
import { auroraGlow, cn, onMediaSurface, tint, toneText, toneVar, type ToneKey } from '../lib/tone';
import type { AvatarExpressionName, AvatarExpressionState } from '../types';

export interface AvatarFallbackProps {
  personaName: string;
  /** The runtime's prepared portrait (§7) or the scenario's own image. */
  portraitUrl?: string | null;
  expression: AvatarExpressionState;
  /** Set while an `avatar.expression.transition` is in flight — plays the wash. */
  transitionTo?: AvatarExpressionName | null;
  speaking: boolean;
  listening: boolean;
  className?: string;
}

/** First grapheme of the name — correct for 陳 as well as for "Chen". */
function leadCharacter(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return Array.from(trimmed)[0] ?? '?';
}

export function AvatarFallback({
  personaName,
  portraitUrl,
  expression,
  transitionTo,
  speaking,
  listening,
  className,
}: AvatarFallbackProps) {
  const tone: ToneKey = EXPRESSION_TONE[expression.name];
  const label = EXPRESSION_LABEL[expression.name];

  /**
   * The §9 head pose becomes CSS custom properties, so a state change is a style
   * write on one element rather than a React re-render of the portrait.
   * `avatar-portrait-shell` eases them over 620ms — the same order as the
   * runtime's own expression transition, so the two paths feel identical.
   */
  const poseStyle = useMemo<CSSProperties>(() => {
    // React types `style` as CSSProperties, which has no index signature for
    // custom properties; the cast is the standard way to set CSS variables.
    return {
      '--avatar-yaw': String(expression.head_yaw),
      '--avatar-pitch': String(expression.head_pitch),
      '--avatar-roll': `${expression.head_roll * 0.35}deg`,
    } as unknown as CSSProperties;
  }, [expression.head_yaw, expression.head_pitch, expression.head_roll]);

  const washOpacity = 0.1 + expression.intensity * 0.22;

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      {/* Ground: an aurora that warms with the emotion, never a flat grey box. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: auroraGlow(0.85 + expression.motion_energy * 0.4) }}
      />

      <div
        className={cn(
          'avatar-portrait-shell absolute inset-0 flex items-center justify-center',
        )}
        style={poseStyle}
      >
        <div
          className={cn(
            'avatar-breathe relative flex h-full w-full items-center justify-center',
            expression.motion_energy > 0.55 && 'avatar-breathe-fast',
          )}
        >
          {portraitUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- runtime-supplied portrait, not a build asset
            <img
              src={portraitUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <InitialMark character={leadCharacter(personaName)} tone={tone} speaking={speaking} />
          )}

          {/* Blink — one element over the whole stage, so it works for both the
              portrait and the initial mark without knowing where the eyes are. */}
          <div
            aria-hidden="true"
            className="avatar-blink pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, ${tint('neutral', 26)}, transparent 46%, transparent 54%, ${tint('neutral', 18)})`,
            }}
          />
        </div>
      </div>

      {/* Emotion wash — the colour temperature of the whole stage follows §13. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{
          background: `radial-gradient(circle at 50% 62%, ${tint(tone, 40)}, transparent 72%)`,
          opacity: washOpacity,
        }}
      />

      {/* §45 expression transition: a single wash, once, on change. */}
      {transitionTo ? (
        <div
          key={transitionTo}
          aria-hidden="true"
          className="avatar-transition-wash pointer-events-none absolute inset-0"
          style={{ background: tint(EXPRESSION_TONE[transitionTo], 22) }}
        />
      ) : null}

      {/* Listening bloom — the customer is waiting on the trainee. */}
      {listening && !speaking ? (
        <div
          aria-hidden="true"
          className="avatar-listen-ring pointer-events-none absolute inset-6 rounded-shell"
          style={{ boxShadow: `0 0 0 2px ${tint('cyan', 34)}` }}
        />
      ) : null}

      {/* Expression caption — the piece that still works with motion disabled.
          It sits on the portrait, so it gets the on-media treatment (ink scrim +
          `--text-on-media`, ≥4.6:1 over any photo); a 14% tone wash with the
          card's toned text had no guaranteed contrast over an image at all. The
          emotion colour stays in the dot. */}
      <span
        className="absolute left-4 top-14 inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-tiny backdrop-blur"
        style={onMediaSurface()}
      >
        <span
          aria-hidden="true"
          className="inline-block size-1.5 rounded-pill"
          style={{ backgroundColor: toneVar(tone) }}
        />
        {label}
      </span>
    </div>
  );
}

interface InitialMarkProps {
  character: string;
  tone: ToneKey;
  speaking: boolean;
}

/**
 * The initial-letter treatment, kept — but as a designed mark rather than a
 * placeholder: a soft squircle plate, a tone-matched halo, and the breathing it
 * inherits from the shell above.
 */
function InitialMark({ character, tone, speaking }: InitialMarkProps) {
  return (
    <span className="relative flex items-center justify-center">
      <span
        aria-hidden="true"
        className={cn('absolute -inset-6 rounded-shell blur-2xl', speaking && 'avatar-speak-pulse')}
        style={{ background: tint(tone, 30) }}
      />
      <span
        className="relative flex size-28 items-center justify-center rounded-shell border text-section backdrop-blur"
        style={{
          backgroundColor: tint(tone, 16),
          borderColor: tint(tone, 34),
          color: toneText(tone),
          fontSize: '2.75rem',
          lineHeight: 1,
        }}
      >
        {character}
      </span>
    </span>
  );
}
