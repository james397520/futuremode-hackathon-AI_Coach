'use client';

/**
 * Preflight / warm-up checklist — §52, bounded by §53.
 *
 * §52 lists eight gates before Start Training: backend, model, avatar cache,
 * expression bank, MuseTalk warm-up, TTS, WebRTC, audio device.
 *
 * §53 outranks it: *an avatar failure must never end — or prevent — a training
 * session.* So the six avatar-side checks are advisory. They report, they never
 * block. Only the two the conversation genuinely needs (a voice to speak with
 * and a device to hear it on) can hold Start, and even those are marked
 * `required` in the store rather than hardcoded here, so a text-mode session can
 * clear them by simply reporting `skipped`.
 *
 * `blockingChecks()` is exported separately so a Start button can gate on it
 * without rendering the list.
 */
import { useAvatarStore } from '../avatar-store';
import { cn, tint, toneText, type ToneKey } from '../lib/tone';
import type { PreflightCheck, PreflightCheckState } from '../types';
import { AvatarStyles } from './avatar-styles';

const STATE_TONE: Record<PreflightCheckState, ToneKey> = {
  pending: 'neutral',
  running: 'indigo',
  ok: 'mint',
  skipped: 'neutral',
  failed: 'warning',
};

const STATE_LABEL: Record<PreflightCheckState, string> = {
  pending: 'Waiting',
  running: 'Starting',
  ok: 'Ready',
  skipped: 'Not used',
  failed: 'Unavailable',
};

/** The checks that may legitimately hold Start Training (§52 ∩ §53). */
export function blockingChecks(checks: readonly PreflightCheck[]): PreflightCheck[] {
  return checks.filter((check) => check.required && (check.state === 'failed' || check.state === 'pending'));
}

export interface AvatarPreflightProps {
  /** Hide once the session is running; the checklist is a pre-start surface. */
  visible?: boolean;
  className?: string;
}

export function AvatarPreflight({ visible = true, className }: AvatarPreflightProps) {
  const checks = useAvatarStore((s) => s.preflight);
  const status = useAvatarStore((s) => s.status);
  if (!visible) return null;

  const blocking = blockingChecks(checks);
  const settled = status === 'ready' || status === 'unavailable' || status === 'degraded';

  return (
    <section
      className={cn('grid gap-2', className)}
      aria-label="Simulation readiness"
      // The list mutates as checks settle; announce it politely, never assertively.
      aria-live="polite"
      aria-busy={!settled}
    >
      {/* Mounted standalone on the setup page: bring the pulse keyframes and the
          AA tone mixes with it. */}
      <AvatarStyles />
      <ul className="grid gap-1">
        {checks.map((check) => {
          const tone = STATE_TONE[check.state];
          return (
            <li key={check.id} className="flex items-center justify-between gap-3 text-tiny">
              <span className="flex min-w-0 items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-pill',
                    check.state === 'running' ? 'avatar-speak-pulse' : undefined,
                  )}
                  style={{ backgroundColor: toneText(tone) }}
                />
                <span className="truncate">{check.label}</span>
              </span>
              <span
                className="shrink-0 rounded-pill border px-1.5 py-0.5"
                style={{
                  backgroundColor: tint(tone, 12),
                  borderColor: tint(tone, 26),
                  color: toneText(tone),
                }}
              >
                {check.detail ?? STATE_LABEL[check.state]}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-tiny" style={{ color: 'var(--text-tertiary)' }}>
        {blocking.length > 0
          ? `Waiting on ${blocking.map((check) => check.label.toLowerCase()).join(', ')}.`
          : status === 'unavailable'
            ? 'Video avatar is not installed on this machine — training runs in portrait mode.'
            : 'All set. Training can start.'}
      </p>
    </section>
  );
}
