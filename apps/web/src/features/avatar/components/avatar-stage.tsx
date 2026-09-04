'use client';

/**
 * The virtual human surface — §50 `<PersonaStage><AvatarVideo/>…`, §37 transport,
 * §51 A/V, §53 fallback, §72 background.
 *
 * One component, three truths, chosen entirely by runtime status:
 *
 *   ready       → `<canvas>` painted from the WebSocket JPEG/WebP frame stream
 *                 (§37 Phase 1). When the runtime gains WebRTC, `transport`
 *                 flips to `webrtc` and the same box holds a `<video>` instead —
 *                 nothing outside this file changes.
 *   loading /
 *   degraded    → the portrait, with a warm-up shimmer or a quality notice.
 *   unavailable → the §53 fallback, driven by the mocked persona state so the
 *                 card still reacts to the conversation.
 *
 * §72: no alpha. The runtime sends an opaque frame and the stage owns the
 * background, so the picture never composites against an undefined ground.
 *
 * Accessibility: the canvas carries `role="img"` and an `aria-label` naming the
 * persona and what it is doing (canvas pixels are invisible to assistive tech),
 * and every runtime status change is announced once, politely, in a visually
 * hidden live region — never as an alert, because none of these states is an
 * emergency.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PersonaSimulationState } from '@ai-coach/shared';

import { useAvatarStore } from '../avatar-store';
import { EXPRESSION_LABEL } from '../lib/expression';
import { cn, tint } from '../lib/tone';
import { useMockAvatarDriver } from '../mock/mock-avatar-runtime';
import { useAvatarFrames } from '../use-avatar-frames';
import { useAvatarSession } from '../use-avatar-session';
import type { AvatarRuntimeStatus } from '../types';
import { AvatarFallback } from './avatar-fallback';
import { AvatarStyles } from './avatar-styles';
import { RuntimeBadge } from './runtime-badge';

export interface AvatarStageProps {
  /** Training session id. Absent (or empty) means "no session yet": no runtime call is made. */
  sessionId?: string;
  /** Prepared avatar asset (§7). Defaults to `NEXT_PUBLIC_AVATAR_ID`. */
  avatarId?: string;
  personaName: string;
  /** Scenario portrait, used when the runtime has none of its own. */
  portraitUrl?: string;
  /** The live persona state — the single source of expression truth (§8/§13). */
  personaState?: PersonaSimulationState | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  /**
   * Timestamp of the last barge-in (§15). Every increase fires §44
   * `POST /sessions/{id}/interrupt`: cancel TTS, flush stale frames, close the
   * mouth, return to listening. A timestamp rather than a boolean because
   * barge-in is an *event*, and two consecutive interruptions must both land.
   */
  bargeInAtMs?: number;
  /** `card` wraps the stage in its own surface; `bare` fills the parent's card. */
  surface?: 'bare' | 'card';
  /** Hide the runtime label when the parent already shows status chips. */
  showBadge?: boolean;
  className?: string;
}

function statusAnnouncement(status: AvatarRuntimeStatus, personaName: string): string {
  switch (status) {
    case 'ready':
      return `${personaName} is now shown as a live video avatar.`;
    case 'loading':
      return `Preparing the video avatar for ${personaName}.`;
    case 'degraded':
      return `Video quality reduced. ${personaName} is still responding normally.`;
    case 'unavailable':
      return `${personaName} is shown as a portrait. Voice and conversation are unaffected.`;
    default:
      return '';
  }
}

export function AvatarStage({
  sessionId,
  avatarId,
  personaName,
  portraitUrl,
  personaState = null,
  speaking,
  listening,
  thinking,
  bargeInAtMs = 0,
  surface = 'bare',
  showBadge = true,
  className,
}: AvatarStageProps) {
  const status = useAvatarStore((s) => s.status);
  const transport = useAvatarStore((s) => s.transport);
  const expression = useAvatarStore((s) => s.expression);
  const transitionTo = useAvatarStore((s) => s.transitionTo);
  const runtimePortrait = useAvatarStore((s) => s.portraitUrl);
  const buffering = useAvatarStore((s) => s.buffering);

  // Frames never enter React state: the sink owns a canvas and a rAF loop.
  const frames = useAvatarFrames({
    onStats: (stats) => useAvatarStore.getState().reportFrameStats(stats),
  });
  const pushFrame = frames.pushFrame;

  const session = useAvatarSession({
    sessionId: sessionId ?? '',
    ...(avatarId === undefined ? {} : { avatarId }),
    personaState,
    speaking,
    listening,
    thinking,
    enabled: typeof sessionId === 'string' && sessionId.length > 0,
    onFrame: pushFrame,
  });

  // §53 — with no runtime at all, the persona state drives the fallback directly
  // so the card still visibly reacts to the conversation (§87 demo arc).
  useMockAvatarDriver({
    enabled: status === 'unavailable' || status === 'unknown',
    personaState,
    speaking,
    listening,
    thinking,
  });

  // §44 barge-in.
  const interrupt = session.interrupt;
  const lastBargeRef = useRef(0);
  useEffect(() => {
    if (bargeInAtMs > lastBargeRef.current) {
      lastBargeRef.current = bargeInAtMs;
      interrupt();
    }
  }, [bargeInAtMs, interrupt]);

  // Clear the canvas whenever the picture stops being live, so a frozen last
  // frame never masquerades as a running stream.
  const resetFrames = frames.reset;
  useEffect(() => {
    if (status !== 'ready') resetFrames();
  }, [status, resetFrames]);

  const live = status === 'ready' && (transport === 'ws-frames' || transport === 'webrtc');
  const effectivePortrait = runtimePortrait ?? portraitUrl ?? null;

  // One announcement per status change, not per render.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(statusAnnouncement(status, personaName));
  }, [status, personaName]);

  const canvasLabel = useMemo(() => {
    const activity = speaking
      ? 'speaking'
      : thinking
        ? 'thinking'
        : listening
          ? 'listening'
          : 'waiting';
    return `${personaName}, simulated customer. Currently ${activity}. Expression: ${EXPRESSION_LABEL[expression.name]}.`;
  }, [personaName, speaking, thinking, listening, expression.name]);

  const body = (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      <AvatarStyles />

      {/* Live pixels. Kept mounted but hidden while warming so the first frame
          does not have to wait for a canvas to be created. */}
      <canvas
        ref={frames.canvasRef}
        role="img"
        aria-label={canvasLabel}
        className={cn('avatar-canvas absolute inset-0', !live && 'invisible')}
      />

      {/* Everything that is not a live frame. */}
      {!live ? (
        <AvatarFallback
          personaName={personaName}
          portraitUrl={effectivePortrait}
          expression={expression}
          transitionTo={transitionTo}
          speaking={speaking}
          listening={listening}
        />
      ) : null}

      {/* Warm-up shimmer — only while the runtime is genuinely loading models. */}
      {status === 'loading' || status === 'checking' ? (
        <div
          aria-hidden="true"
          className="avatar-warm pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
          style={{
            background: `linear-gradient(90deg, transparent, ${tint('indigo', 70)}, transparent)`,
          }}
        />
      ) : null}

      {/* §51 — audio is the master clock; a buffering hint must be quiet. */}
      {buffering ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
          style={{ background: tint('cyan', 60) }}
        />
      ) : null}

      {/* §43 speaking: a bottom glow, never a flashing card. */}
      {speaking ? (
        <div
          aria-hidden="true"
          className="avatar-speak-pulse pointer-events-none absolute inset-x-8 bottom-1 h-1 rounded-pill"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--accent-violet), var(--accent-cyan), transparent)',
          }}
        />
      ) : null}

      {showBadge ? (
        // Sits one row above the parent card's status chip (§20.1 keeps the very
        // bottom-left for Speaking / Listening), so the two never overlap.
        <div className="pointer-events-none absolute bottom-12 left-4">
          <RuntimeBadge compact />
        </div>
      ) : null}

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );

  if (surface === 'bare') return body;

  return (
    <div className="glass-card relative overflow-hidden p-0">
      <div className="relative aspect-[4/3] w-full">{body}</div>
    </div>
  );
}
