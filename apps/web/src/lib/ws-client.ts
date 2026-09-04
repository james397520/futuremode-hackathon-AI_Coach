/**
 * Reusable typed WebSocket client — §49 Real-time Architecture / §55 & §68 event schema.
 *
 * Generic on purpose: the Live Simulation feature (`src/features/simulation`, owned
 * elsewhere) consumes this, and so does the notification stream. It knows about
 * `StreamingEvent` / `ClientCommand` and nothing else — no React, no store.
 *
 * Responsibilities:
 *   - parse + validate inbound frames against the StreamingEvent union
 *   - reconnect with exponential backoff + jitter, and surface `connection.reconnecting`
 *   - detect `seq` gaps (events are monotonic per §55) and report them so the
 *     consumer can refetch the transcript instead of silently losing a turn
 *   - send `{ type: 'ack', seq }` so the server can trim its replay buffer
 *
 * No credentials are passed in the URL: the socket is authenticated by the same
 * HttpOnly session cookie as REST (§70/§71 — nothing secret in the browser).
 */
import type { ClientCommand, StreamingEvent, StreamingEventType } from '@ai-coach/shared-types';

export const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://localhost:8000';

export type WsStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'failed';

export interface SeqGap {
  expected: number;
  received: number;
  missing: number;
}

export interface StreamingClientOptions {
  /** Path such as `/ws/sessions/<id>`; joined against WS_BASE_URL. */
  path: string;
  /** Resume from a known sequence number after a reconnect. */
  lastSeq?: number;
  onEvent: (event: StreamingEvent) => void;
  onStatus?: (status: WsStatus, meta?: { attempt?: number; reason?: string }) => void;
  /** A gap means the consumer must reconcile with REST — never paper over it. */
  onSeqGap?: (gap: SeqGap) => void;
  onParseError?: (raw: string, error: unknown) => void;
  /** Defaults: 8 attempts, 600ms base, 15s ceiling. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Auto-ack every accepted event. Default true. */
  autoAck?: boolean;
  /** Heartbeat interval; 0 disables. Default 25s. */
  heartbeatMs?: number;
}

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<StreamingEventType>([
  'session.started',
  'session.paused',
  'session.resumed',
  'session.completed',
  'speech.started',
  'speech.partial',
  'speech.final',
  'agent.thinking',
  'agent.response.partial',
  'agent.response.final',
  'persona.state.updated',
  'coach.insight',
  'knowledge.citation',
  'score.updated',
  'compliance.warning',
  'runtime.fallback',
  'connection.reconnecting',
  'session.error',
]);

/**
 * Structural check only. The union is the contract (§55: "neither side may invent
 * events"), so an unknown `type` is dropped rather than passed through — that keeps
 * a backend regression from crashing a live session.
 */
function parseStreamingEvent(raw: string): StreamingEvent | null {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as Record<string, unknown>;
  if (typeof candidate.type !== 'string' || !KNOWN_EVENT_TYPES.has(candidate.type)) return null;
  if (typeof candidate.seq !== 'number' || typeof candidate.session_id !== 'string') return null;
  if (typeof candidate.at_ms !== 'number') return null;
  return data as StreamingEvent;
}

export class StreamingClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private lastSeq: number;
  private status: WsStatus = 'idle';
  private disposed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly queue: ClientCommand[] = [];

  constructor(private readonly options: StreamingClientOptions) {
    this.lastSeq = options.lastSeq ?? 0;
  }

  get currentStatus(): WsStatus {
    return this.status;
  }

  get sequence(): number {
    return this.lastSeq;
  }

  connect(): void {
    if (this.disposed || typeof window === 'undefined') return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', { attempt: this.attempt });

    const url = new URL(this.options.path, WS_BASE_URL);
    if (this.lastSeq > 0) url.searchParams.set('since_seq', String(this.lastSeq));

    let socket: WebSocket;
    try {
      socket = new WebSocket(url.toString());
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : 'construct failed');
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
      this.startHeartbeat();
      // Flush anything the consumer sent while we were down.
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) this.rawSend(next);
      }
    };

    socket.onmessage = (message: MessageEvent<string>) => {
      let event: StreamingEvent | null = null;
      try {
        event = parseStreamingEvent(message.data);
      } catch (error) {
        this.options.onParseError?.(message.data, error);
        return;
      }
      if (!event) return;

      // §55 monotonic seq: detect holes, drop replays.
      if (this.lastSeq > 0 && event.seq > this.lastSeq + 1) {
        this.options.onSeqGap?.({
          expected: this.lastSeq + 1,
          received: event.seq,
          missing: event.seq - this.lastSeq - 1,
        });
      }
      if (event.seq <= this.lastSeq) return;
      this.lastSeq = event.seq;

      this.options.onEvent(event);
      if (this.options.autoAck !== false) this.ack(event.seq);
    };

    socket.onerror = () => {
      // `onclose` always follows; backoff is handled there.
    };

    socket.onclose = (closeEvent: CloseEvent) => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.disposed) {
        this.setStatus('closed');
        return;
      }
      // 1000/1001 with a normal reason = intentional teardown by the server.
      if (closeEvent.code === 1000 && closeEvent.wasClean) {
        this.setStatus('closed', { reason: closeEvent.reason });
        return;
      }
      this.scheduleReconnect(closeEvent.reason || `code ${closeEvent.code}`);
    };
  }

  send(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      // `ack` is worthless once stale; everything else is worth replaying.
      if (command.type !== 'ack') this.queue.push(command);
      return;
    }
    this.rawSend(command);
  }

  ack(seq: number): void {
    this.send({ type: 'ack', seq });
  }

  /** Resume point for a fresh client (e.g. after a full page reload). */
  resumeFrom(seq: number): void {
    this.lastSeq = seq;
  }

  close(): void {
    this.disposed = true;
    this.clearReconnect();
    this.stopHeartbeat();
    this.socket?.close(1000, 'client disposed');
    this.socket = null;
    this.setStatus('closed');
  }

  private rawSend(command: ClientCommand): void {
    try {
      this.socket?.send(JSON.stringify(command));
    } catch {
      if (command.type !== 'ack') this.queue.push(command);
    }
  }

  private scheduleReconnect(reason: string): void {
    const maxAttempts = this.options.maxAttempts ?? 8;
    if (this.attempt >= maxAttempts) {
      this.setStatus('failed', { attempt: this.attempt, reason });
      return;
    }
    this.attempt += 1;

    const base = this.options.baseDelayMs ?? 600;
    const ceiling = this.options.maxDelayMs ?? 15_000;
    const backoff = Math.min(ceiling, base * 2 ** (this.attempt - 1));
    // Jitter so a server restart does not get a synchronised stampede.
    const delay = Math.round(backoff * (0.7 + Math.random() * 0.6));

    this.setStatus('reconnecting', { attempt: this.attempt, reason });
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatMs ?? 25_000;
    if (interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // An ack of the latest seq doubles as a keepalive — no extra command type
      // needed, and it keeps the server's replay buffer trimmed.
      if (this.socket?.readyState === WebSocket.OPEN) this.rawSend({ type: 'ack', seq: this.lastSeq });
    }, interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setStatus(status: WsStatus, meta?: { attempt?: number; reason?: string }): void {
    if (this.status === status && !meta) return;
    this.status = status;
    this.options.onStatus?.(status, meta);
  }
}

/** Convenience factory for the session socket path (§68). */
export function createSessionSocket(
  sessionId: string,
  options: Omit<StreamingClientOptions, 'path'>,
): StreamingClient {
  return new StreamingClient({ ...options, path: `/ws/sessions/${sessionId}` });
}
