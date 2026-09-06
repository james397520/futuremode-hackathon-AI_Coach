'use client';

/**
 * Avatar Runtime session lifecycle — §39–§47, §52, §53.
 *
 * Owns exactly one runtime session for the lifetime of one training session:
 *
 *   probe `/health` ──▶ absent ──▶ status `unavailable`   (the common case;
 *        │                                                 the fallback renders
 *        │                                                 and nobody is told
 *        │                                                 about a "failure")
 *        └─ present ─▶ `/capabilities` ─▶ `POST /sessions` ─▶ WS ─▶ `avatar.ready`
 *
 * Then, for as long as the session lives:
 *   - persona state changes are POSTed to `/sessions/{id}/state`
 *   - barge-in calls `/sessions/{id}/interrupt`
 *
 * §47 is the timing rule that makes this feel human: **state goes out before the
 * audio does.** The expression transition starts at t+50–200ms and the TTS audio
 * lands at t+150–400ms, so the customer visibly *prepares* to speak instead of
 * snapping into a talking pose. That is why the state POST is debounced by only
 * ~90ms and fires on the `thinking`/`processing` edge rather than waiting for
 * `persona_speaking`.
 *
 * Every failure path lands on `status: 'unavailable' | 'degraded'`. Nothing here
 * throws, and nothing here can prevent a session from running (§53).
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PersonaSimulationState } from '@ai-coach/shared';

import { AvatarClient, AvatarSocket, avatarClient } from './avatar-client';
import { useAvatarStore } from './avatar-store';
import {
  AVATAR_DEFAULT_FPS,
  AVATAR_DEFAULT_HEIGHT,
  AVATAR_DEFAULT_MODE,
  AVATAR_DEFAULT_WIDTH,
  AVATAR_ENABLED,
  AVATAR_ID,
} from './lib/env';
import { expressionStateFor, samePayload, toRuntimeStatePayload } from './lib/expression';
import type { AvatarEvent, AvatarFrameStats, AvatarPersonaStatePayload } from './types';

export interface UseAvatarSessionOptions {
  /** Training session id — used only for logging/correlation, never sent as the runtime id. */
  sessionId: string;
  /** Prepared avatar asset id (§7). Defaults to `NEXT_PUBLIC_AVATAR_ID`. */
  avatarId?: string;
  personaState: PersonaSimulationState | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  /** Set false to skip the runtime entirely (e.g. the session has not started). */
  enabled?: boolean;
  /** Binary frames from the socket (§37 Phase 1). */
  onFrame?: (frame: ArrayBuffer) => void;
  /** Injected in tests. */
  client?: AvatarClient;
}

export interface AvatarSessionHandle {
  /** §44 barge-in. Safe to call when there is no runtime — it resolves to a no-op. */
  interrupt: () => void;
  /** Re-probe after the user installs/starts the runtime mid-session. */
  retry: () => void;
  reportFrameStats: (stats: AvatarFrameStats) => void;
}

/** §47 — long enough to coalesce a burst of updates, short enough to precede audio. */
const STATE_DEBOUNCE_MS = 90;

export function useAvatarSession(options: UseAvatarSessionOptions): AvatarSessionHandle {
  const {
    sessionId,
    avatarId = AVATAR_ID,
    personaState,
    speaking,
    listening,
    thinking,
    enabled = true,
    onFrame,
    client = avatarClient,
  } = options;

  const store = useAvatarStore;
  const socketRef = useRef<AvatarSocket | null>(null);
  const runtimeSessionIdRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<AvatarPersonaStatePayload | null>(null);
  const stateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFrameRef = useRef(onFrame);
  const generationRef = useRef(0);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  // -------------------------------------------------------------------------
  // §45 events
  // -------------------------------------------------------------------------
  const handleEvent = useCallback(
    (event: AvatarEvent) => {
      const s = store.getState();
      switch (event.type) {
        case 'avatar.ready':
          s.setStatus('ready');
          s.setTransport('ws-frames');
          s.setCheck('model', 'ok');
          s.setCheck('avatar_cache', 'ok');
          s.setCheck('expression_bank', 'ok');
          s.setCheck('musetalk_warmup', 'ok');
          s.setCheck('webrtc', 'ok', 'WebSocket 影格（第一階段）');
          break;
        case 'avatar.loading':
          if (s.status !== 'degraded') s.setStatus('loading');
          s.setCheck('model', 'running', event.stage);
          break;
        case 'avatar.expression.transition':
          s.beginTransition(event.to);
          break;
        case 'avatar.state.changed':
          s.endTransition();
          break;
        case 'avatar.audio.buffering':
          s.setBuffering(true);
          break;
        case 'avatar.speaking.started':
          s.setBuffering(false);
          s.setSpeaking(true);
          break;
        case 'avatar.speaking.ended':
          s.setSpeaking(false);
          break;
        case 'avatar.interrupted':
          s.setSpeaking(false);
          s.setBuffering(false);
          break;
        case 'avatar.frame.drop':
          if (typeof event.av_drift_ms === 'number') s.reportDrift(event.av_drift_ms);
          break;
        case 'avatar.runtime.degraded':
          // §53: one engine down is not the end of the picture.
          s.degrade(event.component ?? 'runtime', event.reason);
          break;
        case 'avatar.error':
          s.fail({ code: event.code ?? 'MODEL_LOAD_FAILED', message: event.message ?? '虛擬人執行環境發生錯誤' });
          break;
        default:
          break;
      }
    },
    [store],
  );

  // -------------------------------------------------------------------------
  // Lifecycle: probe → session → socket
  // -------------------------------------------------------------------------
  const teardown = useCallback(() => {
    if (stateTimerRef.current !== null) {
      clearTimeout(stateTimerRef.current);
      stateTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    const runtimeId = runtimeSessionIdRef.current;
    runtimeSessionIdRef.current = null;
    lastPayloadRef.current = null;
    if (runtimeId) void client.closeSession(runtimeId);
  }, [client]);

  const start = useCallback(
    async (abort: AbortSignal, generation: number): Promise<void> => {
      const s = store.getState();
      const alive = (): boolean => !abort.aborted && generationRef.current === generation;

      if (!AVATAR_ENABLED) {
        s.setStatus('unavailable');
        s.setCheck('backend', 'skipped', '設定中已停用虛擬人執行環境');
        return;
      }

      s.setStatus('checking');
      s.setCheck('backend', 'running');

      const health = await client.health(abort);
      if (!alive()) return;
      if (!health.ok) {
        // The overwhelmingly common case: no engines installed. Quiet, not an error.
        s.setCheck('backend', 'skipped', '偵測不到本機虛擬人執行環境');
        s.setStatus('unavailable');
        return;
      }
      s.setHealth(health.value);
      s.setCheck('backend', 'ok', health.value.platform);

      const capabilities = await client.capabilities(abort);
      if (!alive()) return;
      if (capabilities.ok) {
        s.setCapabilities(capabilities.value);
      }

      const fps = capabilities.ok && capabilities.value.max_recommended_fps > 0
        ? Math.min(AVATAR_DEFAULT_FPS, capabilities.value.max_recommended_fps)
        : AVATAR_DEFAULT_FPS;
      const mode =
        capabilities.ok && !capabilities.value.state_bank && capabilities.value.continuous_liveportrait
          ? 'continuous'
          : AVATAR_DEFAULT_MODE;

      s.setStatus('loading');
      const created = await client.createSession(
        {
          avatar_id: avatarId,
          fps,
          width: AVATAR_DEFAULT_WIDTH,
          height: AVATAR_DEFAULT_HEIGHT,
          mode,
        },
        abort,
      );
      if (!alive()) {
        if (created.ok) void client.closeSession(created.value.session_id);
        return;
      }
      if (!created.ok) {
        s.fail(created.error);
        s.setStatus('unavailable');
        return;
      }

      runtimeSessionIdRef.current = created.value.session_id;
      s.setRuntimeSession(created.value.session_id, created.value.portrait_url);

      const socket = new AvatarSocket({
        sessionId: created.value.session_id,
        onEvent: handleEvent,
        onFrame: (frame) => onFrameRef.current?.(frame),
        onStatus: (socketStatus, meta) => {
          const current = store.getState();
          if (socketStatus === 'failed') {
            current.fail({
              code: 'SOCKET_FAILED',
              message: meta?.reason ?? '虛擬人串流已中斷',
            });
          }
        },
      });
      socketRef.current = socket;
      socket.connect();

      // §47 — the runtime gets the persona's current state immediately, so the
      // expression is already right before the first word is synthesised.
      const payload = toRuntimeStatePayload({ personaState, speaking, listening, thinking });
      lastPayloadRef.current = payload;
      void client.pushState(created.value.session_id, payload);
    },
    // `personaState` et al. are intentionally excluded: this effect starts the
    // session once, and the separate effect below streams state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [avatarId, client, handleEvent, store],
  );

  useEffect(() => {
    if (!enabled) {
      teardown();
      store.getState().reset();
      return;
    }

    const controller = new AbortController();
    generationRef.current += 1;
    const generation = generationRef.current;
    void start(controller.signal, generation);

    return () => {
      controller.abort();
      generationRef.current += 1;
      teardown();
    };
  }, [enabled, sessionId, start, teardown, store]);

  // -------------------------------------------------------------------------
  // §43 — stream persona state. Also mirrors the expression locally so the
  // fallback animates identically when the runtime is absent (§53).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const inputs = { personaState, speaking, listening, thinking };
    const current = store.getState();
    // With no runtime, `useMockAvatarDriver` owns the expression so it can play
    // the §47 lead-in (transition first, commit ~140ms later). Writing here too
    // would commit instantly and swallow that.
    if (current.status !== 'unavailable' && current.status !== 'unknown') {
      current.setExpression(expressionStateFor(inputs));
    }

    const runtimeId = runtimeSessionIdRef.current;
    if (!runtimeId) return;

    const payload = toRuntimeStatePayload(inputs);
    if (samePayload(lastPayloadRef.current, payload)) return;

    if (stateTimerRef.current !== null) clearTimeout(stateTimerRef.current);
    stateTimerRef.current = setTimeout(() => {
      stateTimerRef.current = null;
      lastPayloadRef.current = payload;
      void client.pushState(runtimeId, payload).then((result) => {
        if (!result.ok) store.getState().fail(result.error);
      });
    }, STATE_DEBOUNCE_MS);
  }, [personaState, speaking, listening, thinking, client, store]);

  // -------------------------------------------------------------------------
  // Public handle
  // -------------------------------------------------------------------------
  const interrupt = useCallback(() => {
    const runtimeId = runtimeSessionIdRef.current;
    // Optimistic locally: the mouth must close the instant the trainee talks
    // over the customer, not one network round-trip later (§15).
    store.getState().setSpeaking(false);
    store.getState().setBuffering(false);
    if (!runtimeId) return;
    void client.interrupt(runtimeId);
  }, [client, store]);

  const retry = useCallback(() => {
    teardown();
    store.getState().reset();
    const controller = new AbortController();
    generationRef.current += 1;
    void start(controller.signal, generationRef.current);
  }, [start, teardown, store]);

  const reportFrameStats = useCallback(
    (stats: AvatarFrameStats) => {
      store.getState().reportFrameStats(stats);
    },
    [store],
  );

  return { interrupt, retry, reportFrameStats };
}
