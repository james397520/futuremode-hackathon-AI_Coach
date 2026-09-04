/**
 * The backend contract — spec §51, §57, §62.
 *
 * Every tier of the three-tier chain (WebGPU EP → WASM SIMD → Server) implements
 * exactly this interface, which is what makes the fallback controller able to step
 * down without the calling feature knowing anything changed.
 *
 * Authority model (§54, §55): the local tiers are **advisory**. The server is the
 * authoritative layer for safety, reranking and scoring. Nothing in this file may
 * imply otherwise.
 */
import type {
  ComputeBackend,
  LocalModelManifest,
  LocalTask,
} from '@ai-coach/shared-types';

/* ------------------------------------------------------------------ *
 * Fallback reasons
 * ------------------------------------------------------------------ */

/**
 * The complete set of reasons a tier can be abandoned. §62 names the first five
 * explicitly; the rest cover the operational failures we hit in practice.
 */
export const FALLBACK_REASONS = [
  'webgpu_unavailable',
  'adapter_request_failed',
  'device_lost',
  'memory_exceeded',
  'unsupported_operator',
  'timeout',
  'worker_unavailable',
  'worker_crashed',
  'model_unavailable',
  'integrity_mismatch',
  'cache_unavailable',
  'policy_off',
  'not_supported_for_task',
  'load_failed',
  'inference_failed',
  'network_failed',
  'aborted',
] as const;

export type FallbackReason = (typeof FALLBACK_REASONS)[number];

/**
 * Human-readable, non-alarming reason text. §62 requires the UI never crash; §93
 * requires that a normal trainee is not shown engineering detail — so these strings
 * are written to be safe to surface anywhere, and the machine-readable
 * `FallbackReason` is what admins see in Settings > AI Runtime.
 */
const FALLBACK_REASON_TEXT: Record<FallbackReason, string> = {
  webgpu_unavailable: 'This browser or device does not expose WebGPU.',
  adapter_request_failed: 'No usable GPU adapter was available.',
  device_lost: 'The GPU device was lost and had to be given up.',
  memory_exceeded: 'The device ran out of memory for local acceleration.',
  unsupported_operator: 'The local model uses an operation this device cannot run.',
  timeout: 'Local processing took too long, so it was handed to the server.',
  worker_unavailable: 'Background workers are not available in this browser.',
  worker_crashed: 'The background worker stopped unexpectedly.',
  model_unavailable: 'The local model could not be downloaded.',
  integrity_mismatch: 'The downloaded model failed its integrity check.',
  cache_unavailable: 'Local model storage is unavailable or disabled.',
  policy_off: 'Local acceleration is turned off by policy.',
  not_supported_for_task: 'This task does not run locally on this device.',
  load_failed: 'The local model could not be initialised.',
  inference_failed: 'Local processing failed, so the server handled it.',
  network_failed: 'The network request did not complete.',
  aborted: 'The request was cancelled.',
};

export function describeFallbackReason(reason: FallbackReason): string {
  return FALLBACK_REASON_TEXT[reason] ?? 'Local acceleration is unavailable.';
}

/**
 * A typed failure that carries the reason the tier must be stepped down.
 *
 * `fatal` means "do not try this backend again for a while" (device lost, model
 * genuinely unsupported); a non-fatal failure may be retried once inside the same
 * tier before stepping down. Retries are always bounded — see `fallback.ts`.
 */
export class BackendFailure extends Error {
  readonly name = 'BackendFailure';
  readonly reason: FallbackReason;
  readonly backend: ComputeBackend;
  readonly fatal: boolean;
  readonly task?: LocalTask;

  constructor(init: {
    reason: FallbackReason;
    backend: ComputeBackend;
    message?: string;
    fatal?: boolean;
    task?: LocalTask;
    cause?: unknown;
  }) {
    super(init.message ?? describeFallbackReason(init.reason));
    this.reason = init.reason;
    this.backend = init.backend;
    this.fatal = init.fatal ?? false;
    this.task = init.task;
    // `cause` is ES2022; assign defensively so an older runtime does not throw.
    try {
      (this as { cause?: unknown }).cause = init.cause;
    } catch {
      /* ignore — cause is diagnostic only */
    }
  }

  static is(value: unknown): value is BackendFailure {
    return (
      value instanceof BackendFailure ||
      (typeof value === 'object' &&
        value !== null &&
        (value as { name?: unknown }).name === 'BackendFailure' &&
        typeof (value as { reason?: unknown }).reason === 'string')
    );
  }
}

/* ------------------------------------------------------------------ *
 * Model metadata that `LocalModelManifest` deliberately does not carry
 * ------------------------------------------------------------------ */

export type ModelKind = 'embedder' | 'sequence_classifier' | 'cross_encoder';

export type MemoryClass = 'low' | 'medium' | 'high';

/**
 * Runtime hints for a model. `LocalModelManifest` in `@ai-coach/shared-types` is a
 * frozen cross-language contract, so we never modify it — we *extend* it here with
 * the browser-side execution detail (pooling, prefixes, label order, sequence
 * length) that only this package needs.
 */
export interface ModelRuntimeHints {
  kind: ModelKind;
  /** Hard cap on tokens per sequence. Longer input is truncated, never rejected. */
  maxSequenceLength: number;
  /** How to collapse the token dimension for embedders. */
  pooling?: 'mean' | 'cls';
  /** L2-normalise the pooled vector (required for cosine similarity). */
  normalize?: boolean;
  /** e5-family models expect asymmetric prefixes. Empty string is a valid value. */
  queryPrefix?: string;
  passagePrefix?: string;
  /** Label order for classifiers — index maps to logit index. */
  labels?: readonly string[];
  /** Basename inside `manifest.files` that holds the ONNX graph. */
  modelFile: string;
  /** Basename inside `manifest.files` that holds the tokenizer (json or vocab.txt). */
  tokenizerFile: string;
  /** Lowercase + strip accents, matching the model's training normaliser. */
  lowercase: boolean;
  stripAccents: boolean;
  /** Which device classes this variant is appropriate for. */
  memoryClass: readonly MemoryClass[];
  /** Rough total download size, used for the progress UI and quota pre-checks. */
  approxDownloadBytes: number;
}

/** A manifest plus the browser-side hints needed to actually execute it. */
export interface ResolvedManifest extends LocalModelManifest {
  hints: ModelRuntimeHints;
}

/* ------------------------------------------------------------------ *
 * Task results
 * ------------------------------------------------------------------ */

/**
 * Whether a result may be acted on directly, or is only a hint for the server.
 * Local tiers are always `advisory` (§53, §54, §55).
 */
export type AuthorityLevel = 'advisory' | 'authoritative';

export interface EmbedOptions {
  /** e5-style asymmetric embedding role. Defaults to 'query'. */
  role?: 'query' | 'passage';
  /** Override the model's default sequence length (still clamped by the model). */
  maxLength?: number;
}

export interface EmbedResult {
  vectors: number[][];
  dimension: number;
  model_id: string;
  backend: ComputeBackend;
  authority: AuthorityLevel;
  /** True when the text never left the browser (§52.1). */
  local: boolean;
}

export const INTENT_LABELS = ['objection', 'question', 'off_topic', 'close_intent'] as const;
export type IntentLabel = (typeof INTENT_LABELS)[number];

export interface IntentResult {
  label: IntentLabel;
  confidence: number;
  /** Full distribution, ordered as `INTENT_LABELS`. */
  scores: Record<IntentLabel, number>;
  model_id: string;
  backend: ComputeBackend;
  /** Always 'advisory' from a local tier — the server orchestrator decides (§53). */
  authority: AuthorityLevel;
  local: boolean;
}

export interface RerankDocument {
  id: string;
  text: string;
  /** Upstream retrieval score, preserved so the server can re-derive ordering. */
  score?: number;
}

export interface RerankHit {
  id: string;
  score: number;
  rank: number;
  /** Position before local reranking, so the server can audit the reorder. */
  previous_rank: number;
}

export interface RerankResult {
  hits: RerankHit[];
  model_id: string;
  backend: ComputeBackend;
  /**
   * 'advisory' from local tiers. Finance / insurance deployments must keep
   * server-authoritative scoring (§54).
   */
  authority: AuthorityLevel;
  local: boolean;
}

export type SafetyCategory =
  | 'pii'
  | 'restricted_keyword'
  | 'prompt_injection'
  | 'sensitive_phrase';

export type SafetySeverity = 'info' | 'low' | 'medium' | 'high';

export interface SafetyFinding {
  category: SafetyCategory;
  /** Stable rule id so the server can correlate without receiving the text. */
  rule: string;
  severity: SafetySeverity;
  /** Character offsets in the *input* string. */
  start: number;
  end: number;
  /** A redacted excerpt, never the raw match. */
  redacted: string;
}

export interface SafetyResult {
  /** true when nothing at or above `medium` was found. */
  pass: boolean;
  findings: SafetyFinding[];
  /** 0..1 heuristic risk. Never used as a hard gate on its own. */
  risk: number;
  /** Input with every finding replaced by a mask token (§55 sensitive-phrase masking). */
  masked: string;
  backend: ComputeBackend;
  /** Always 'advisory'. The server Safety Agent is the authoritative layer (§55). */
  authority: AuthorityLevel;
  local: boolean;
}

/* ------------------------------------------------------------------ *
 * The backend interface
 * ------------------------------------------------------------------ */

export interface LoadProgress {
  task: LocalTask;
  phase: 'download' | 'verify' | 'session' | 'warmup';
  loaded?: number;
  total?: number;
  message?: string;
}

export interface InferenceBackend {
  readonly kind: ComputeBackend;

  /** True when this backend can serve `task` right now, without loading anything. */
  isReady(task: LocalTask): boolean;

  /**
   * Prepare `manifest.task`. Must be idempotent: calling it twice for the same
   * model id is a no-op. Throws `BackendFailure` on any problem.
   */
  load(manifest: ResolvedManifest, onProgress?: (p: LoadProgress) => void): Promise<void>;

  embed(texts: readonly string[], options?: EmbedOptions): Promise<EmbedResult>;

  classifyIntent(text: string): Promise<IntentResult>;

  rerank(query: string, docs: readonly RerankDocument[], topK?: number): Promise<RerankResult>;

  safetyPrecheck(text: string): Promise<SafetyResult>;

  /** Free sessions and GPU resources. Safe to call when nothing is loaded (§60). */
  release(task?: LocalTask): Promise<void>;
}

/**
 * Every task goes through this. The fallback controller implements it; the task
 * modules in `src/tasks/` only ever see this narrow surface, which is why they are
 * completely unaware of which tier answered.
 */
export interface TaskRunner {
  runTask<T>(
    task: LocalTask,
    op: (backend: InferenceBackend) => Promise<T>,
    options?: { label?: string; localOnly?: boolean; serverOnly?: boolean },
  ): Promise<TaskOutcome<T>>;
}

export interface TaskOutcomeMeta {
  backend: ComputeBackend;
  elapsed_ms: number;
  /** A tier was stepped down while serving this call. */
  degraded: boolean;
  fallback_reason?: FallbackReason;
  /** Ordered list of tiers that were tried and abandoned. */
  attempts: Array<{ backend: ComputeBackend; reason: FallbackReason }>;
}

export type TaskOutcome<T> =
  | ({ ok: true; value: T } & TaskOutcomeMeta)
  | ({ ok: false; error: { reason: FallbackReason; message: string } } & TaskOutcomeMeta);
