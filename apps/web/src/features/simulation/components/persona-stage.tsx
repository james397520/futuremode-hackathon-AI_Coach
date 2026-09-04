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

import { auroraGlow, tint, toneText } from '../lib/tone';
import { LiveDot } from './atoms';
import { ChevronRightIcon, MicIcon, SparkleIcon } from './icons';
import { cn, PersonaAvatar } from './kit';

export interface PersonaStageProps {
  personaName: string;
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
  className?: string;
}

export function PersonaStage({
  personaName,
  subtitle,
  avatarUrl,
  eyebrow = 'Customer Simulation',
  speaking,
  listening,
  thinking,
  onOpenProfile,
  waveform,
  className,
}: PersonaStageProps) {
  return (
    <div className={cn('relative', className)}>
      {/* Soft aurora glow behind the stage — small area only (§2). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 -z-10 rounded-shell opacity-90 blur-2xl transition-opacity duration-500"
        style={{ background: auroraGlow(speaking ? 1.25 : 1) }}
      />

      <div className="glass-card sim-portrait relative overflow-hidden p-0">
        <div className="relative aspect-[4/3] w-full">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- feature-local
            <img
              src={avatarUrl}
              alt={`${personaName} — simulated customer portrait`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="dot-matrix flex h-full w-full items-center justify-center"
              style={{ background: auroraGlow(0.8) }}
            >
              <PersonaAvatar name={personaName} size="xl" speaking={speaking} />
            </div>
          )}

          {/* §20.1 top gradient overlay so the name stays legible on any portrait. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{
              background:
                'linear-gradient(to bottom, color-mix(in srgb, var(--text-primary) 52%, transparent), transparent)',
            }}
          />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p
                className="text-tiny uppercase tracking-[0.1em]"
                style={{ color: 'color-mix(in srgb, var(--bg-canvas-soft) 82%, transparent)' }}
              >
                {eyebrow}
              </p>
              <p
                className="truncate text-card-title"
                style={{ color: 'var(--bg-canvas-soft)' }}
              >
                {personaName}
                {subtitle ? (
                  <span
                    className="font-normal"
                    style={{ color: 'color-mix(in srgb, var(--bg-canvas-soft) 76%, transparent)' }}
                  >
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
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--bg-canvas-soft) 24%, transparent)',
                  color: 'var(--bg-canvas-soft)',
                }}
              >
                Profile
                <ChevronRightIcon size={12} />
              </button>
            ) : null}
          </div>

          {/* Bottom status — a chip, never a video-conference control bar (§20.1). */}
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
            <span
              className="flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-tiny backdrop-blur"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--glass-card-strong) 88%, transparent)',
                borderColor: tint('neutral', 22),
                color: speaking
                  ? toneText('violet')
                  : listening
                    ? toneText('cyan')
                    : thinking
                      ? toneText('indigo')
                      : 'var(--text-tertiary)',
              }}
            >
              {speaking ? (
                <>
                  <LiveDot tone="violet" pulsing />
                  Speaking
                </>
              ) : listening ? (
                <>
                  <MicIcon size={11} />
                  Listening
                </>
              ) : thinking ? (
                <>
                  <SparkleIcon size={11} />
                  Thinking
                </>
              ) : (
                <>
                  <LiveDot tone="neutral" />
                  Standing by
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
