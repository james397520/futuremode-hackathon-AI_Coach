/**
 * Avatar Runtime client — §39–§45.
 *
 * Two pieces:
 *   `AvatarClient`  — the HTTP surface (`/health`, `/capabilities`, `/sessions`,
 *                     `/sessions/{id}/state`, `/sessions/{id}/interrupt`).
 *   `AvatarSocket`  — one WebSocket carrying BOTH the §45 JSON control events and
 *                     the Phase-1 binary video frames (§37: JPEG/WebP first,
 *                     WebRTC second). Reconnect/backoff mirrors
 *                     `src/lib/ws-client.ts` so there is one reconnect idiom in
 *                     the app; it is not shared code because the avatar socket is
 *                     binary, unauthenticated, seq-less and loopback-only, and
 *                     bending `StreamingClient` around that would make the
 *                     session socket worse.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ §53 — NOTHING HERE THROWS.                                               │
 * │ Every method resolves to `AvatarResult`. An avatar failure degrades the  │
 * │ picture; it must never bubble into React and unmount a live training     │
 * │ session. That is the whole reason this module owns its own error type    │
 * │ instead of reusing `ApiError`.                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * No credentials are ever sent: the runtime is a loopback process, and
 * `credentials: 'omit'` keeps the app's session cookie away from it.
 */
import {
  AVATAR_BASE_URL,
  AVATAR_PROBE_TIMEOUT_MS,
  AVATAR_REQUEST_TIMEOUT_MS,
  AVATAR_WS_URL,
} from './lib/env';
import {
  avatarFail,
  avatarOk,
  type AvatarCapabilities,
  type AvatarErrorCode,
  type AvatarEvent,
  type AvatarEventType,
  type AvatarHealth,
  type AvatarPersonaStatePayload,
  type AvatarResult,
  type AvatarSessionRequest,
  type AvatarSessionResponse,
} from './types';

const EVENT_TYPES: ReadonlySet<string> = new Set<AvatarEventType>([
  'avatar.ready',
  'avatar.loading',
  'avatar.state.changed',
  'avatar.expression.transition',
  'avatar.audio.buffering',
  'avatar.speaking.started',
  'avatar.speaking.ended',
  'avatar.interrupted',
  'avatar.frame.drop',
  'avatar.runtime.degraded',
  'avatar.error',
]);

/** Unknown event types are dropped rather than passed through (§45 is the contract). */
export function parseAvatarEvent(raw: string): AvatarEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { type?: unknown };
  if (typeof candidate.type !== 'string' || !EVENT_TYPES.has(candidate.type)) return null;
  return data as AvatarEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface AvatarClientOptions {
  baseUrl?: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class AvatarClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;

  constructor(options: AvatarClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? AVATAR_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  }

  /** §39 — also our presence probe. A rejected connection means "not installed". */
  async health(signal?: AbortSignal): Promise<AvatarResult<AvatarHealth>> {
    const result = await this.request<Record<string, unknown>>('GET', '/health', {
      timeoutMs: AVATAR_PROBE_TIMEOUT_MS,
      signal,
    });
    if (!result.ok) return result;
    const body = result.value;
    if (typeof body.status !== 'string') {
      return avatarFail('RUNTIME_BAD_RESPONSE', '/health did not return a status');
    }
    return avatarOk<AvatarHealth>({
      status: body.status,
      platform: typeof body.platform === 'string' ? body.platform : 'unknown',
      liveportrait: typeof body.liveportrait === 'string' ? body.liveportrait : 'unknown',
      musetalk: typeof body.musetalk === 'string' ? body.musetalk : 'unknown',
      encoder: typeof body.encoder === 'string' ? body.encoder : 'unknown',
    });
  }

  /** §40 — `max_recommended_fps` is host-measured; we never invent a value. */
  async capabilities(signal?: AbortSignal): Promise<AvatarResult<AvatarCapabilities>> {
    const result = await this.request<Record<string, unknown>>('GET', '/capabilities', {
      timeoutMs: AVATAR_PROBE_TIMEOUT_MS,
      signal,
    });
    if (!result.ok) return result;
    const body = result.value;
    const fps = typeof body.max_recommended_fps === 'number' ? body.max_recommended_fps : 0;
    return avatarOk<AvatarCapabilities>({
      backend: typeof body.backend === 'string' ? body.backend : 'unknown',
      state_bank: body.state_bank === true,
      continuous_liveportrait: body.continuous_liveportrait === true,
      musetalk: body.musetalk === true,
      webrtc: body.webrtc === true,
      max_recommended_fps: fps > 0 ? Math.round(fps) : 0,
    });
  }

  /** §42 */
  async createSession(
    request: AvatarSessionRequest,
    signal?: AbortSignal,
  ): Promise<AvatarResult<AvatarSessionResponse>> {
    const result = await this.request<Record<string, unknown>>('POST', '/sessions', {
      body: request,
      signal,
    });
    if (!result.ok) return result;
    const sessionId = result.value.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return avatarFail('SESSION_CREATE_FAILED', '/sessions did not return a session_id');
    }
    const portrait = result.value.portrait_url;
    return avatarOk<AvatarSessionResponse>({
      session_id: sessionId,
      ...(typeof portrait === 'string' && portrait.length > 0 ? { portrait_url: portrait } : {}),
    });
  }

  /** §43 — persona state. §47: this must be sent *before* the audio starts. */
  async pushState(
    sessionId: string,
    state: AvatarPersonaStatePayload,
    signal?: AbortSignal,
  ): Promise<AvatarResult<void>> {
    const result = await this.request<unknown>('POST', `/sessions/${encodeURIComponent(sessionId)}/state`, {
      body: state,
      signal,
    });
    return result.ok ? avatarOk(undefined) : result;
  }

  /** §44 — barge-in: cancel TTS, flush frames, close the mouth, go back to listening. */
  async interrupt(sessionId: string, signal?: AbortSignal): Promise<AvatarResult<void>> {
    const result = await this.request<unknown>(
      'POST',
      `/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      { signal },
    );
    return result.ok ? avatarOk(undefined) : result;
  }

  /**
   * Best-effort teardown. Not in the spec's endpoint list, so a 404/405 is
   * treated as success: the runtime simply reaps the session when the socket
   * closes.
   */
  async closeSession(sessionId: string): Promise<AvatarResult<void>> {
    const result = await this.request<unknown>(
      'DELETE',
      `/sessions/${encodeURIComponent(sessionId)}`,
      { timeoutMs: AVATAR_PROBE_TIMEOUT_MS, keepalive: true },
    );
    if (result.ok) return avatarOk(undefined);
    return result.error.code === 'RUNTIME_BAD_RESPONSE' ? avatarOk(undefined) : result;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      body?: unknown;
      signal?: AbortSignal;
      timeoutMs?: number;
      keepalive?: boolean;
    } = {},
  ): Promise<AvatarResult<T>> {
    const doFetch = this.fetchImpl;
    if (!doFetch) return avatarFail('RUNTIME_UNREACHABLE', 'fetch is unavailable in this environment');

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? AVATAR_REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const external = options.signal;
    const onExternalAbort = (): void => controller.abort();
    external?.addEventListener('abort', onExternalAbort);

    try {
      const response = await doFetch(`${this.baseUrl}${path}`, {
        method,
        // Loopback service: never attach the app's session cookie (§73).
        credentials: 'omit',
        cache: 'no-store',
        keepalive: options.keepalive === true,
        signal: controller.signal,
        ...(options.body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }),
      });

      if (!response.ok) {
        const code = this.codeForStatus(response.status);
        return avatarFail(code, `${method} ${path} → HTTP ${response.status}`);
      }

      // 204 / empty bodies are legitimate for state + interrupt.
      const text = await response.text();
      if (text.trim().length === 0) return avatarOk({} as T);
      try {
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed)) return avatarOk({} as T);
        return avatarOk(parsed as T);
      } catch {
        return avatarFail('RUNTIME_BAD_RESPONSE', `${method} ${path} returned non-JSON`);
      }
    } catch (error) {
      const aborted = external?.aborted === true;
      if (aborted) return avatarFail('RUNTIME_TIMEOUT', 'request cancelled');
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      return isAbort
        ? avatarFail('RUNTIME_TIMEOUT', `${method} ${path} timed out after ${timeoutMs}ms`)
        : avatarFail('RUNTIME_UNREACHABLE', `${method} ${path} failed: no Avatar Runtime on ${this.baseUrl}`);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  private codeForStatus(status: number): AvatarErrorCode {
    if (status === 404 || status === 405) return 'RUNTIME_BAD_RESPONSE';
    if (status === 507) return 'OUT_OF_MEMORY';
    if (status >= 500) return 'MODEL_LOAD_FAILED';
    return 'RUNTIME_BAD_RESPONSE';
  }
}

// ---------------------------------------------------------------------------
// §45 — the control + frame socket
// ---------------------------------------------------------------------------

export type AvatarSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface AvatarSocketOptions {
  sessionId: string;
  wsUrl?: string;
  /** §45 JSON control events. */
  onEvent: (event: AvatarEvent) => void;
  /**
   * Phase-1 binary video frames (§37) — one encoded JPEG/WebP per message.
   * The consumer must decode without blocking and drop what it cannot keep up
   * with (§49); this socket never buffers frames itself.
   */
  onFrame: (frame: ArrayBuffer) => void;
  onStatus?: (status: AvatarSocketStatus, meta?: { attempt?: number; reason?: string }) => void;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class AvatarSocket {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private disposed = false;
  private status: AvatarSocketStatus = 'idle';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: AvatarSocketOptions) {}

  get currentStatus(): AvatarSocketStatus {
    return this.status;
  }

  connect(): void {
    if (this.disposed || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', { attempt: this.attempt });

    const base = (this.options.wsUrl ?? AVATAR_WS_URL).replace(/\/+$/, '');
    const url = `${base}/ws/sessions/${encodeURIComponent(this.options.sessionId)}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : 'construct failed');
      return;
    }
    // Frames must arrive as ArrayBuffer: `createImageBitmap` on a Blob costs an
    // extra copy, and at 25fps that copy is the difference between smooth and not.
    socket.binaryType = 'arraybuffer';
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('open');
    };

    socket.onmessage = (message: MessageEvent<unknown>) => {
      const data = message.data;
      if (typeof data === 'string') {
        const event = parseAvatarEvent(data);
        if (event) this.options.onEvent(event);
        return;
      }
      if (data instanceof ArrayBuffer) {
        this.options.onFrame(data);
        return;
      }
      // Defensive: a server that ignores `binaryType` hands us a Blob.
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data
          .arrayBuffer()
          .then((buffer) => {
            if (!this.disposed) this.options.onFrame(buffer);
          })
          .catch(() => {
            /* §53: a single unreadable frame is never worth surfacing. */
          });
      }
    };

    socket.onerror = () => {
      // `onclose` always follows; backoff is handled there.
    };

    socket.onclose = (closeEvent: CloseEvent) => {
      this.socket = null;
      if (this.disposed) {
        this.setStatus('closed');
        return;
      }
      if (closeEvent.code === 1000 && closeEvent.wasClean) {
        this.setStatus('closed', { reason: closeEvent.reason });
        return;
      }
      this.scheduleReconnect(closeEvent.reason || `code ${closeEvent.code}`);
    };
  }

  /** Control messages travel as JSON on the same socket (§38: WS = state/control). */
  send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      /* §53 */
    }
  }

  close(): void {
    this.disposed = true;
    this.clearReconnect();
    try {
      this.socket?.close(1000, 'client disposed');
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.setStatus('closed');
  }

  private scheduleReconnect(reason: string): void {
    const maxAttempts = this.options.maxAttempts ?? 6;
    if (this.attempt >= maxAttempts) {
      this.setStatus('failed', { attempt: this.attempt, reason });
      return;
    }
    this.attempt += 1;

    const base = this.options.baseDelayMs ?? 600;
    const ceiling = this.options.maxDelayMs ?? 10_000;
    const backoff = Math.min(ceiling, base * 2 ** (this.attempt - 1));
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

  private setStatus(status: AvatarSocketStatus, meta?: { attempt?: number; reason?: string }): void {
    if (this.status === status && !meta) return;
    this.status = status;
    this.options.onStatus?.(status, meta);
  }
}

/** Module-level singleton — the runtime is a single local process. */
export const avatarClient = new AvatarClient();
