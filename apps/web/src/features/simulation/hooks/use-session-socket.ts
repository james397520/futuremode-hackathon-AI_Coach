'use client';

/**
 * The single realtime seam of the Live Simulation page — spec §49 / §55 / §68.
 *
 * Responsibilities
 *  - subscribe to the typed socket (or the scripted demo stream when no backend
 *    is configured) and push every `StreamingEvent` through the store reducer;
 *  - run an *exhaustive* side-effect switch so adding a variant to
 *    `StreamingEvent` fails the build here instead of being silently ignored;
 *  - send `ClientCommand`s, with Assessment Mode gating enforced in code, not CSS;
 *  - survive `connection.reconnecting`, `runtime.fallback`, seq gaps and totally
 *    unknown payloads without ever crashing the page (§62 / §94).
 *
 * Transport seam: `@/lib/ws-client` (owned by the app-shell owner).
 *   createSessionSocket(sessionId, { onEvent, onStatus?, onSeqGap? }) → StreamingClient
 *   StreamingClient: connect() · send(ClientCommand) · ack(seq) · close()
 * That client owns reconnect/backoff, heartbeats, `seq` gap detection and
 * auto-acking, so this hook never re-implements any of it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientCommand,
  ComplianceFinding,
  ID,
  SessionMode,
  StreamingEvent,
} from '@ai-coach/shared';

import { createSessionSocket, type SeqGap, type WsStatus } from '@/lib/ws-client';

import { shouldUseMockStream } from '../lib/env';
import { createMockEventStream, type MockEventStream } from '../mock/mock-event-stream';
import { useSessionActions, useSessionStore } from '../store/session-store';

export type PersonaSpeechPhase = 'start' | 'delta' | 'end';

export interface UseSessionSocketOptions {
  sessionId: ID;
  mode: SessionMode;
  /** Held back until the REST/mock bootstrap resolved. */
  enabled?: boolean;
  onEvent?: (event: StreamingEvent) => void;
  onCompleted?: (evaluationId?: ID) => void;
  onPersonaSpeech?: (phase: PersonaSpeechPhase, text?: string) => void;
  onCompliance?: (finding: ComplianceFinding) => void;
  onRuntimeFallback?: (to: 'wasm' | 'server', reason: string) => void;
  /** Demo only: let the scripted stream type the trainee's lines by itself. */
  autopilotMs?: number;
  /** Bump to force a fresh connection / a fresh demo run (Restart). */
  epoch?: number;
}

export interface SessionSocketApi {
  connected: boolean;
  transport: 'socket' | 'mock';
  send: (command: ClientCommand) => void;
  sendMessage: (text: string) => void;
  pause: () => void;
  resume: () => void;
  end: () => void;
  /** No-op in Assessment Mode — the affordance does not exist there (§8.4). */
  requestHint: () => void;
  pushToTalk: (pressed: boolean) => void;
  sendIntentHint: (intent: string, confidence: number) => void;
}

interface Transport {
  send: (command: ClientCommand) => void;
  close: () => void;
}

export function useSessionSocket(options: UseSessionSocketOptions): SessionSocketApi {
  const { sessionId, mode, enabled = true, epoch = 0 } = options;
  const actions = useSessionActions();
  const [connected, setConnected] = useState(false);

  // Keep callbacks in a ref: the socket must not be torn down because a parent
  // re-rendered with a new closure.
  const callbacks = useRef(options);
  callbacks.current = options;

  const transportRef = useRef<Transport | null>(null);

  const handleEvent = useCallback(
    (event: StreamingEvent) => {
      // 1. Authoritative state first, so the UI paints as early as possible (§49.2).
      actions.applyEvent(event);

      // (`ws-client` auto-acks accepted events, so no `ack` is sent from here.)
      const cb = callbacks.current;
      cb.onEvent?.(event);

      // 3. Side effects that live outside the store (audio, evaluation fetch…).
      switch (event.type) {
        case 'session.started':
        case 'session.paused':
        case 'session.resumed':
          break;

        case 'session.completed':
          cb.onCompleted?.(event.evaluation_id);
          cb.onPersonaSpeech?.('end');
          break;

        case 'speech.started':
          if (event.speaker === 'persona') cb.onPersonaSpeech?.('start');
          break;

        case 'speech.partial':
          if (event.speaker === 'persona') cb.onPersonaSpeech?.('delta', event.text);
          break;

        case 'speech.final':
          if (event.turn?.speaker === 'persona') cb.onPersonaSpeech?.('end', event.turn.text);
          break;

        case 'agent.thinking':
          break;

        case 'agent.response.partial':
          cb.onPersonaSpeech?.('delta', event.delta);
          break;

        case 'agent.response.final':
          cb.onPersonaSpeech?.('end', event.turn?.text);
          break;

        case 'persona.state.updated':
        case 'coach.insight':
        case 'knowledge.citation':
        case 'score.updated':
          break;

        case 'compliance.warning':
          if (event.finding) cb.onCompliance?.(event.finding);
          break;

        case 'runtime.fallback':
          // Acceleration degraded — a quiet badge change, never a modal (§94).
          cb.onRuntimeFallback?.(event.to, event.reason);
          break;

        // Fused trainee affect — the store holds it; nothing side-effecting here.
        case 'trainee.affect.updated':
          break;

        case 'connection.reconnecting':
          setConnected(false);
          break;

        case 'session.error':
          if (!event.recoverable) cb.onPersonaSpeech?.('end');
          break;

        default: {
          // Exhaustiveness guard over the whole realtime contract.
          const exhaustive: never = event;
          void exhaustive;
          break;
        }
      }
    },
    [actions],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return undefined;

    let disposed = false;

    if (shouldUseMockStream) {
      const stream: MockEventStream = createMockEventStream({
        sessionId,
        mode,
        onEvent: (event) => {
          if (!disposed) handleEvent(event);
        },
        autopilotMs: callbacks.current.autopilotMs,
      });
      transportRef.current = { send: (cmd) => stream.send(cmd), close: () => stream.stop() };
      actions.requestStatus('connecting');
      setConnected(true);
      actions.setConnectionOnline(true);
      stream.start();

      return () => {
        disposed = true;
        stream.stop();
        transportRef.current = null;
      };
    }

    actions.requestStatus('connecting');

    try {
      const socket = createSessionSocket(sessionId, {
        onEvent: (event: StreamingEvent) => {
          if (!disposed) handleEvent(event);
        },
        onStatus: (wsStatus: WsStatus, meta?: { attempt?: number; reason?: string }) => {
          if (disposed) return;
          const online = wsStatus === 'open';
          setConnected(online);
          actions.setConnectionOnline(online, meta?.attempt);

          if (wsStatus === 'reconnecting') {
            actions.requestStatus('reconnecting');
          }
          if (wsStatus === 'failed') {
            // Backoff gave up. Surface it inline and keep the transcript usable
            // — the page must not become a dead end (§62 / §94).
            actions.applyEvent({
              seq: 0,
              session_id: sessionId,
              at_ms: Date.now(),
              type: 'session.error',
              code: 'transport_failed',
              message:
                meta?.reason ??
                '即時連線已中斷。逐字稿已保留 — 重新開始練習即可繼續。',
              recoverable: true,
            });
          }
        },
        onSeqGap: (gap: SeqGap) => {
          if (disposed) return;
          // The store already counts gaps; a gap is not fatal on its own.
          void gap;
        },
      });

      socket.connect();

      transportRef.current = {
        send: (cmd) => {
          try {
            socket.send(cmd);
          } catch {
            // Dropping a command is preferable to breaking the session.
          }
        },
        close: () => socket.close(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '目前無法建立即時連線';
      actions.applyEvent({
        seq: 0,
        session_id: sessionId,
        at_ms: Date.now(),
        type: 'session.error',
        code: 'socket_init',
        message,
        recoverable: true,
      });
    }

    return () => {
      disposed = true;
      try {
        transportRef.current?.close();
      } catch {
        // ignore
      }
      transportRef.current = null;
      setConnected(false);
    };
    // `handleEvent` is stable; mode/sessionId/epoch identify the connection.
  }, [actions, enabled, epoch, handleEvent, mode, sessionId]);

  const send = useCallback((command: ClientCommand) => {
    transportRef.current?.send(command);
  }, []);

  const api = useMemo<SessionSocketApi>(
    () => ({
      connected,
      transport: shouldUseMockStream ? 'mock' : 'socket',
      send,
      sendMessage: (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // Optimistic echo: the trainee's words appear before the round trip (§49.2).
        actions.appendLocalTurn(trimmed, Date.now());
        send({ type: 'message.send', text: trimmed });
      },
      pause: () => {
        actions.requestStatus('paused');
        send({ type: 'session.pause' });
      },
      resume: () => {
        send({ type: 'session.resume' });
      },
      end: () => {
        send({ type: 'session.end' });
      },
      requestHint: () => {
        // Hard gate: in an assessment the command is never emitted, even if a
        // caller somehow reaches this function (§8.4 anti-cheating).
        if (mode === 'assessment') return;
        // Arm the store first: with the coach not volunteering, the reply is
        // only shown because someone asked for it, and the asking has to be
        // recorded before the answer can arrive.
        actions.armHint();
        send({ type: 'coach.request_hint' });
      },
      pushToTalk: (pressed: boolean) => {
        send({ type: 'voice.push_to_talk', pressed });
      },
      sendIntentHint: (intent: string, confidence: number) => {
        send({ type: 'client.intent_hint', intent, confidence });
      },
    }),
    [actions, connected, mode, send],
  );

  return api;
}

/** Convenience selector for components that only need the live connection flag. */
export function useIsSocketOnline(): boolean {
  return useSessionStore((s) => s.connection.online);
}
