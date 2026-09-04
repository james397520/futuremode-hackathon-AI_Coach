/**
 * Runtime telemetry — spec §49.5, §93.
 *
 * PRIVACY RULE, enforced by the type system below
 * -----------------------------------------------
 * This module collects **operational metrics only**: which backend answered, which
 * model id, how long loading took, how long the last inference took, whether the
 * worker is alive, and why a fallback happened.
 *
 * It must **never** collect prompt, transcript, query, document or any other user
 * content — not truncated, not hashed, not "just for debugging". That is not a
 * convention here: `TelemetryPatch` maps every content-shaped key to `never`, so a
 * future edit that tries to add `prompt`, `text`, `transcript`, `query`, … to the
 * payload fails to compile. If you are here because the compiler rejected your
 * field, the answer is not to widen the type.
 *
 * The reporter posts to the API so admins can see it in Settings > AI Runtime
 * (§93). A normal trainee never sees any of this (§59, §93).
 */
import type { ComputeBackend, RuntimeTelemetry } from '@ai-coach/shared';

import { errorText } from './capability';
import type { FallbackReason } from './backends/types';

/**
 * Keys that would carry user content. Adding one to a telemetry payload is a
 * compile error — see the file header.
 */
type ForbiddenContentKey =
  | 'prompt'
  | 'prompts'
  | 'text'
  | 'texts'
  | 'transcript'
  | 'transcripts'
  | 'query'
  | 'queries'
  | 'content'
  | 'message'
  | 'messages'
  | 'document'
  | 'documents'
  | 'docs'
  | 'input'
  | 'inputs'
  | 'output'
  | 'utterance'
  | 'embedding'
  | 'vectors'
  | 'user_text'
  | 'snippet'
  | 'excerpt';

/**
 * `T`, with any content-shaped key poisoned to `never`.
 *
 * `RuntimeTelemetry` currently has none of these keys, so `Extract<…>` is `never`
 * and this is the identity today. The point is what happens tomorrow: the moment
 * someone extends the telemetry shape with a content field, every call site that
 * supplies it stops compiling.
 */
export type ContentFree<T> = T & {
  [K in Extract<keyof T, ForbiddenContentKey>]: never;
};

export type TelemetryPatch = ContentFree<Partial<RuntimeTelemetry>>;

/** The admin-only extras (§93). Still content-free. */
export interface RuntimeTelemetryDetail extends RuntimeTelemetry {
  worker_status: 'idle' | 'starting' | 'alive' | 'crashed' | 'unavailable';
  /** How many times we have stepped down a tier this session. */
  fallback_count: number;
  /** Rolling mean of the last N inference durations, in ms. */
  avg_inference_ms?: number;
  /** Total inferences served this session, per backend. */
  inferences: Record<ComputeBackend, number>;
  /** Last update, ISO 8601. */
  updated_at: string;
}

export type TelemetryDetailPatch = ContentFree<Partial<RuntimeTelemetryDetail>>;

export type TelemetryReporter = (
  telemetry: RuntimeTelemetryDetail,
) => void | Promise<void>;

export interface TelemetryCollectorOptions {
  initialBackend?: ComputeBackend;
  reporter?: TelemetryReporter;
  /** Minimum gap between reporter calls. Defaults to 15s. */
  reportIntervalMs?: number;
  /** How many inference timings feed `avg_inference_ms`. Defaults to 20. */
  window?: number;
}

const INFERENCE_ZERO: Record<ComputeBackend, number> = { webgpu: 0, wasm: 0, server: 0 };

export class TelemetryCollector {
  private state: RuntimeTelemetryDetail;
  private reporter: TelemetryReporter | undefined;
  private readonly reportIntervalMs: number;
  private readonly window: number;
  private readonly durations: number[] = [];
  private readonly listeners = new Set<(t: RuntimeTelemetryDetail) => void>();
  private lastReportAt = 0;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: TelemetryCollectorOptions = {}) {
    this.reporter = options.reporter;
    this.reportIntervalMs = options.reportIntervalMs ?? 15_000;
    this.window = Math.max(1, options.window ?? 20);
    this.state = {
      backend: options.initialBackend ?? 'server',
      worker_alive: false,
      worker_status: 'idle',
      fallback_count: 0,
      inferences: { ...INFERENCE_ZERO },
      updated_at: new Date().toISOString(),
    };
  }

  /** The `shared` contract shape — this is what the app should show/send. */
  snapshot(): RuntimeTelemetry {
    const {
      backend,
      model_id,
      load_ms,
      last_inference_ms,
      worker_alive,
      fallback_reason,
    } = this.state;
    return {
      backend,
      ...(model_id === undefined ? {} : { model_id }),
      ...(load_ms === undefined ? {} : { load_ms }),
      ...(last_inference_ms === undefined ? {} : { last_inference_ms }),
      worker_alive,
      ...(fallback_reason === undefined ? {} : { fallback_reason }),
    };
  }

  /** The admin-only superset (§93). */
  detail(): RuntimeTelemetryDetail {
    return { ...this.state, inferences: { ...this.state.inferences } };
  }

  update(patch: TelemetryDetailPatch): void {
    if (this.disposed) return;
    const next: RuntimeTelemetryDetail = {
      ...this.state,
      ...stripUndefined(patch as Partial<RuntimeTelemetryDetail>),
      inferences: {
        ...this.state.inferences,
        ...(patch.inferences ?? {}),
      },
      updated_at: new Date().toISOString(),
    };
    this.state = next;
    this.emit();
    this.scheduleReport();
  }

  recordLoad(input: { backend: ComputeBackend; model_id: string; load_ms: number }): void {
    this.update({
      backend: input.backend,
      model_id: input.model_id,
      load_ms: Math.max(0, Math.round(input.load_ms)),
    });
  }

  recordInference(input: { backend: ComputeBackend; ms: number }): void {
    const ms = Math.max(0, Math.round(input.ms));
    this.durations.push(ms);
    while (this.durations.length > this.window) this.durations.shift();
    const sum = this.durations.reduce((a, b) => a + b, 0);
    const counts = { ...this.state.inferences };
    counts[input.backend] = (counts[input.backend] ?? 0) + 1;
    this.update({
      backend: input.backend,
      last_inference_ms: ms,
      avg_inference_ms:
        this.durations.length > 0 ? Math.round(sum / this.durations.length) : undefined,
      inferences: counts,
    });
  }

  recordFallback(input: {
    from: ComputeBackend;
    to: ComputeBackend;
    reason: FallbackReason;
    message: string;
  }): void {
    this.update({
      backend: input.to,
      // The message is generated by this package from a fixed table — it is never
      // derived from user input, so it is safe to report.
      fallback_reason: `${input.reason}: ${input.message}`,
      fallback_count: this.state.fallback_count + 1,
    });
  }

  recordWorker(status: RuntimeTelemetryDetail['worker_status']): void {
    this.update({ worker_status: status, worker_alive: status === 'alive' });
  }

  setReporter(reporter: TelemetryReporter | undefined): void {
    this.reporter = reporter;
  }

  subscribe(listener: (t: RuntimeTelemetryDetail) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.detail());
    } catch {
      /* ignore */
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Send immediately, ignoring the interval. Used on release / page hide. */
  async flush(): Promise<void> {
    if (this.reportTimer !== null) {
      clearTimeout(this.reportTimer);
      this.reportTimer = null;
    }
    const reporter = this.reporter;
    if (!reporter) return;
    this.lastReportAt = Date.now();
    try {
      await reporter(this.detail());
    } catch {
      // Telemetry must never surface an error to the feature that triggered it.
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reportTimer !== null) {
      clearTimeout(this.reportTimer);
      this.reportTimer = null;
    }
    this.listeners.clear();
  }

  private emit(): void {
    const detail = this.detail();
    for (const listener of [...this.listeners]) {
      try {
        listener(detail);
      } catch {
        /* a broken subscriber must not stall the runtime */
      }
    }
  }

  private scheduleReport(): void {
    if (!this.reporter || this.disposed) return;
    if (this.reportTimer !== null) return;
    const elapsed = Date.now() - this.lastReportAt;
    const delay = Math.max(0, this.reportIntervalMs - elapsed);
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      void this.flush();
    }, delay);
    // Never keep a Node process (or a test runner) alive for telemetry.
    const handle = this.reportTimer as unknown as { unref?: () => void };
    if (typeof handle.unref === 'function') handle.unref();
  }
}

/* ------------------------------------------------------------------ *
 * API reporter
 * ------------------------------------------------------------------ */

export interface ApiTelemetryReporterOptions {
  baseUrl?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  onError?: (message: string) => void;
}

/**
 * Posts the admin-visible telemetry to the API. Fire-and-forget: a failed report
 * is swallowed (with an optional callback) because telemetry is never allowed to
 * affect the user-facing path.
 */
export function createApiTelemetryReporter(
  options: ApiTelemetryReporterOptions = {},
): TelemetryReporter {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const endpoint = options.endpoint ?? '/api/runtime/telemetry';
  const url = `${base}${endpoint}`;

  return async (telemetry) => {
    const impl =
      options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!impl) return;
    let headers: Record<string, string> = { 'content-type': 'application/json' };
    try {
      const extra = await options.headers?.();
      if (extra) headers = { ...headers, ...extra };
    } catch {
      /* auth header resolution failure just means an unauthenticated report */
    }
    try {
      // `assertContentFree` is a runtime backstop for the compile-time rule.
      const body = JSON.stringify(assertContentFree(telemetry));
      await impl(url, { method: 'POST', headers, body, credentials: 'include' });
    } catch (error) {
      options.onError?.(`Telemetry report failed: ${errorText(error)}`);
    }
  };
}

const FORBIDDEN_KEYS = new Set<string>([
  'prompt',
  'prompts',
  'text',
  'texts',
  'transcript',
  'transcripts',
  'query',
  'queries',
  'content',
  'message',
  'messages',
  'document',
  'documents',
  'docs',
  'input',
  'inputs',
  'output',
  'utterance',
  'embedding',
  'vectors',
  'user_text',
  'snippet',
  'excerpt',
]);

/**
 * Runtime backstop: strip any content-shaped key that somehow reached the payload
 * (e.g. via an `as any` in a downstream caller) before it goes over the wire.
 */
export function assertContentFree<T extends object>(value: T): T {
  let clean: Record<string, unknown> | null = null;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      if (clean === null) clean = { ...(value as Record<string, unknown>) };
      delete clean[key];
    }
  }
  return (clean ?? value) as T;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) (out as Record<string, unknown>)[key] = entry;
  }
  return out;
}
