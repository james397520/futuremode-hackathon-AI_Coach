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
 * Every non-live rung has a second rendering: the local 3D VRM character
 * (`../vrm/vrm-stage`), chosen by the persona's gender and driven by the very
 * same `expression` / `speaking` store slice. It is on by default
 * (`NEXT_PUBLIC_AVATAR_3D=0` turns it off) and falls back to the CSS portrait
 * when WebGL or the model load fails — the status ladder never sees any of it.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PersonaSimulationState } from '@ai-coach/shared';

import { AVATAR_3D_ENABLED } from '@/lib/runtime-env';

import { useAvatarStore } from '../avatar-store';
import { EXPRESSION_LABEL, EXPRESSION_TONE } from '../lib/expression';
import type { AvatarBodyGender } from '../lib/persona-gender';
import { cn, onMediaSurface, tint, toneVar } from '../lib/tone';
import { useMockAvatarDriver } from '../mock/mock-avatar-runtime';
import { useAvatarFrames } from '../use-avatar-frames';
import { useAvatarSession } from '../use-avatar-session';
import type { AvatarRuntimeStatus } from '../types';
import type { VrmStageStatus } from '../vrm/vrm-stage';
import { AvatarFallback } from './avatar-fallback';
import { AvatarStyles } from './avatar-styles';
import { RuntimeBadge } from './runtime-badge';

/**
 * `three` + `@pixiv/three-vrm` are ~700KB; they load only when a stage mounts
 * in a browser, never in the initial chunk and never on the server.
 */
const VrmStage = dynamic(() => import('../vrm/vrm-stage').then((m) => m.VrmStage), {
  ssr: false,
});

export interface AvatarStageProps {
  /** Training session id. Absent (or empty) means "no session yet": no runtime call is made. */
  sessionId?: string;
  /** Prepared avatar asset (§7). Defaults to `NEXT_PUBLIC_AVATAR_ID`. */
  avatarId?: string;
  personaName: string;
  /**
   * Which 3D body to load. Resolved upstream by `resolvePersonaGender`
   * (explicit contract field → name → voice → female).
   */
  personaGender?: AvatarBodyGender;
  /** Persona age — picks the young / middle / senior body (`avatar-body.ts`). */
  personaAge?: number | null;
  /**
   * Fired when the persona is actually visible — the 3D body finished loading,
   * or it failed and the portrait took over. The voice pipeline holds the
   * opening line until then: a customer who talks to an empty frame for two
   * seconds reads as a bug even though nothing is wrong.
   */
  onPersonaVisible?: () => void;
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

function statusAnnouncement(
  status: AvatarRuntimeStatus,
  personaName: string,
  vrmOnScreen: boolean,
): string {
  // Announce what is on screen. The VRM outranks frames, so it is checked
  // first: gating it on an absent runtime made the page announce "live video"
  // over a locally-rendered 3D character.
  if (vrmOnScreen) {
    return `${personaName} 以 3D 虛擬人呈現。語音與對話不受影響。`;
  }
  switch (status) {
    case 'ready':
      return `${personaName} 現在以即時虛擬人影像呈現。`;
    case 'loading':
      return `正在準備 ${personaName} 的虛擬人影像。`;
    case 'degraded':
      return `視訊畫質已降低。${personaName} 仍正常回應。`;
    case 'unavailable':
      return `${personaName} 以靜態頭像呈現。語音與對話不受影響。`;
    default:
      return '';
  }
}

export function AvatarStage({
  sessionId,
  avatarId,
  personaName,
  personaGender = 'female',
  personaAge = null,
  onPersonaVisible,
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

  const effectivePortrait = runtimePortrait ?? portraitUrl ?? null;

  /*
   * The 3D character outranks the runtime's frame stream.
   *
   * It used to be the other way round — VRM only on the non-live rungs — which
   * meant that on a machine where the Avatar Runtime is installed (this one),
   * the stage always showed the runtime's photo-portrait and the 3D model was
   * effectively unreachable. The product decision is the opposite: the VRM *is*
   * the virtual human; the frame stream fills in while the model loads and
   * takes over for good if it fails. `NEXT_PUBLIC_AVATAR_3D=0` restores frames.
   *
   * `failed` is sticky for this mount — retrying a broken GPU every render
   * would just flicker.
   */
  const [vrmStatus, setVrmStatus] = useState<VrmStageStatus>('loading');
  const wantVrm = AVATAR_3D_ENABLED && vrmStatus !== 'failed';
  const vrmOnScreen = wantVrm && vrmStatus === 'ready';

  const streaming = status === 'ready' && (transport === 'ws-frames' || transport === 'webrtc');
  // What is actually on screen: the canvas only wins when the VRM is not up.
  const live = streaming && !vrmOnScreen;
  const onPersonaVisibleRef = useRef(onPersonaVisible);
  onPersonaVisibleRef.current = onPersonaVisible;
  const onVrmStatus = useCallback((next: VrmStageStatus, reason?: string) => {
    setVrmStatus(next);
    // `failed` counts: the portrait is on screen and the persona is visible.
    if (next === 'ready' || next === 'failed') onPersonaVisibleRef.current?.();
    if (next === 'failed' && reason) {
      // Not an avatar-runtime failure, so not `fail()`: the ladder is untouched.
      console.warn('[avatar] 3D persona unavailable, using portrait:', reason);
    }
  }, []);

  // Tell the badge which surface won, so it never calls a rendered 3D
  // character "靜態頭像".
  useEffect(() => {
    useAvatarStore
      .getState()
      .setRenderer(live ? 'frames' : vrmOnScreen ? 'vrm' : 'portrait');
  }, [live, vrmOnScreen]);
  useEffect(() => () => useAvatarStore.getState().setRenderer('portrait'), []);

  // One announcement per status change, not per render.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    setAnnouncement(statusAnnouncement(status, personaName, vrmOnScreen));
  }, [status, personaName, vrmOnScreen]);

  const canvasLabel = useMemo(() => {
    const activity = speaking
      ? '說話中'
      : thinking
        ? '思考中'
        : listening
          ? '聆聽中'
          : '等待中';
    return `${personaName}，模擬客戶。目前${activity}。表情：${EXPRESSION_LABEL[expression.name]}。`;
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

      {/* Everything that is not a live frame. The portrait stays mounted under
          the 3D canvas until the model has painted, so the swap is a fade-in,
          not a blank. */}
      {!live && !vrmOnScreen ? (
        <AvatarFallback
          personaName={personaName}
          portraitUrl={effectivePortrait}
          expression={expression}
          transitionTo={transitionTo}
          speaking={speaking}
          listening={listening}
        />
      ) : null}

      {wantVrm ? (
        <VrmStage
          gender={personaGender}
          age={personaAge}
          ariaLabel={canvasLabel}
          speaking={speaking}
          onStatus={onVrmStatus}
          className={cn(
            'absolute inset-0 transition-opacity duration-500',
            vrmOnScreen ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}

      {/* The expression caption the portrait carries, kept over the 3D view so
          the mood is still legible without reading a face. */}
      {vrmOnScreen ? (
        <span
          className="absolute left-4 top-14 inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-tiny backdrop-blur"
          style={onMediaSurface()}
        >
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-pill"
            style={{ backgroundColor: toneVar(EXPRESSION_TONE[expression.name]) }}
          />
          {EXPRESSION_LABEL[expression.name]}
        </span>
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
          <RuntimeBadge compact onMedia />
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
