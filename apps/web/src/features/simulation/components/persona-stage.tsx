'use client';

/**
 * Persona stage — spec §20.1 (the most important visual on the right).
 *
 *   4/3 stage · portrait radius 18–22px · white inner border · soft shadow ·
 *   dark gradient overlay at the top · persona name top-left · `Profile`
 *   top-right · a `● Speaking` chip at the bottom.
 *
 * Motion is deliberately small (§43): a bottom glow + tiny pulse while the
 * persona speaks. The card itself never flashes. Dark mode keeps the portrait
 * warm and slightly lifted rather than crushed (§42.2).
 */
import type { ReactNode } from 'react';
import type { PersonaSimulationState } from '@ai-coach/shared';

import { AvatarStage, type AvatarBodyGender } from '@/features/avatar';
import { auroraGlow, INK, onMediaSurface } from '../lib/tone';
import { LiveDot } from './atoms';
import { ChevronRightIcon, MicIcon, SparkleIcon } from './icons';
import { cn } from './kit';

export interface PersonaStageProps {
  personaName: string;
  /** Picks the 3D body (male / female suit). Resolved by the page from the persona. */
  personaGender?: AvatarBodyGender;
  /** e.g. `陳先生 · Mortgage Insurance` second line. */
  subtitle?: string;
  avatarUrl?: string;
  eyebrow?: string;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  onOpenProfile?: () => void;
  /** Waveform slot — filled on the voice page (§24). */
  waveform?: ReactNode;
  /**
   * Live persona state. The Avatar Runtime drives expression from this (§8/§13);
   * when the runtime is absent it still drives the fallback's expression, so the
   * card reacts to the conversation either way.
   */
  personaState?: PersonaSimulationState | null;
  /** Training session id — the avatar runtime session is scoped to it. */
  sessionId?: string;
  /** Timestamp of the last trainee barge-in — each increase fires §44 interrupt. */
  bargeInAtMs?: number;
  /**
   * Fill the parent instead of holding a 4/3 card. Used by the `stage-fill`
   * layout, where the virtual human *is* the left half of the screen and the
   * context cards float over it — so a fixed aspect box would letterbox it.
   */
  fill?: boolean;
  className?: string;
}

export function PersonaStage({
  personaName,
  personaGender,
  subtitle,
  avatarUrl,
  eyebrow = '客戶模擬',
  speaking,
  listening,
  thinking,
  onOpenProfile,
  waveform,
  personaState = null,
  sessionId,
  bargeInAtMs = 0,
  fill = false,
  className,
}: PersonaStageProps) {
  return (
    <div className={cn('relative', fill && 'h-full min-h-0', className)}>
      {/* Soft aurora glow behind the stage — small area only (§2). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 -z-10 rounded-shell opacity-90 blur-2xl transition-opacity duration-500"
        style={{ background: auroraGlow(speaking ? 1.25 : 1) }}
      />

      <div
        className={cn(
          'glass-card sim-portrait relative overflow-hidden p-0',
          fill && 'h-full min-h-0',
        )}
      >
        <div className={cn('relative w-full', fill ? 'h-full min-h-0' : 'aspect-[4/3]')}>
          {/*
            The virtual human itself (`features/avatar`). It picks its own
            surface: live frames from the local Avatar Runtime when one is
            running, and the §53 portrait fallback — breathing, blinking and
            expression-driven — when there is not. The card, its gradient, the
            name plate and the status chip below are unchanged: this is a swap of
            the inner visual only.
          */}
          <AvatarStage
            personaName={personaName}
            {...(personaGender === undefined ? {} : { personaGender })}
            {...(avatarUrl === undefined ? {} : { portraitUrl: avatarUrl })}
            {...(sessionId === undefined ? {} : { sessionId })}
            personaState={personaState}
            speaking={speaking}
            listening={listening}
            thinking={thinking}
            bargeInAtMs={bargeInAtMs}
            surface="bare"
          />

          {/* §20.1 top gradient overlay so the name stays legible on any portrait.
              Built from `INK`, not `--text-primary`: the latter is near-white in
              dark mode and turned this into a light veil under light text. At 64%
              the `--text-on-media` name plate stays ≥4.6:1 even over a white photo. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{
              background: `linear-gradient(to bottom, color-mix(in srgb, ${INK} 64%, transparent), transparent)`,
            }}
          />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              {/* Hierarchy by weight, not alpha: the 78% `--text-on-media-dim`
                  fell to ~3:1 at 11px over a light portrait. */}
              <p
                className="text-tiny uppercase tracking-[0.1em]"
                style={{ color: 'var(--text-on-media)' }}
              >
                {eyebrow}
              </p>
              <p
                className="truncate text-card-title"
                style={{ color: 'var(--text-on-media)' }}
              >
                {personaName}
                {subtitle ? (
                  <span className="font-normal">
                    {' · '}
                    {subtitle}
                  </span>
                ) : null}
              </p>
            </div>

            {onOpenProfile ? (
              <button
                type="button"
                onClick={onOpenProfile}
                className="sim-focusable flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-tiny backdrop-blur"
                // Dark scrim in both themes. `--bg-canvas-soft` is near-white in
                // light mode, which put white text on a white wash over the photo.
                style={onMediaSurface()}
              >
                資料
                <ChevronRightIcon size={12} />
              </button>
            ) : null}
          </div>

          {/* Bottom status — a chip, never a video-conference control bar (§20.1). */}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
            <span
              className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny backdrop-blur"
              // Over the portrait, so: ink scrim + `--text-on-media` (§20.1), never
              // the card's toned text, which is tuned for glass and unreadable on
              // a photo. The tone lives in the dot.
              style={onMediaSurface()}
            >
              {speaking ? (
                <>
                  <LiveDot tone="violet" pulsing onMedia />
                  說話中
                </>
              ) : listening ? (
                <>
                  <MicIcon size={11} />
                  聆聽中
                </>
              ) : thinking ? (
                <>
                  <SparkleIcon size={11} />
                  思考中
                </>
              ) : (
                <>
                  <LiveDot tone="neutral" onMedia />
                  待命中
                </>
              )}
            </span>

            {waveform ? <div className="h-8 min-w-0 flex-1">{waveform}</div> : null}
          </div>

          {/* §43 Live Speaking: bottom glow only. */}
          {speaking ? (
            <div
              aria-hidden="true"
              className="sim-speaking-glow pointer-events-none absolute inset-x-6 bottom-0 h-1 rounded-pill"
              style={{
                background:
                  'linear-gradient(90deg, transparent, var(--accent-violet), var(--accent-cyan), transparent)',
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
