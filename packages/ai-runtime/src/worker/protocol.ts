/**
 * The main-thread ⇄ worker message protocol — spec §58.
 *
 * Everything crossing the boundary is a discriminated union on `kind`, correlated
 * by `id`. Two rules make this safe:
 *
 *   1. **Exhaustiveness.** Every `switch` over a request or response kind ends in
 *      `assertNever(...)`, so adding a command without handling it is a compile
 *      error on both sides.
 *   2. **Validation.** `postMessage` data is untrusted input as far as the type
 *      system is concerned (a stale worker, an extension, a different protocol
 *      version). `parseWorkerResponse` / `parseWorkerRequest` narrow `unknown`
 *      before anything reads a field.
 *
 * Model bytes are fetched and integrity-checked on the **main thread** (that is
 * where `ModelCache` and the auth context live) and handed to the worker as
 * transferable `ArrayBuffer`s, so the transfer is zero-copy and the worker never
 * needs credentials.
 */
import type { ComputeBackend, ComputeCapability, LocalTask, RuntimePolicy } from '@ai-coach/shared';

import type {
  EmbedOptions,
  FallbackReason,
  IntentLabel,
  RerankDocument,
  ResolvedManifest,
  SafetyFinding,
} from '../backends/types';
import type { EnterpriseWebgpuOverride } from '../capability';

export const PROTOCOL_VERSION = 1;

export type RequestId = string;

/** Which local tier the worker should use for a load. Never 'server'. */
export type LocalBackendKind = Extract<ComputeBackend, 'webgpu' | 'wasm'>;

export interface OrtLoadConfig {
  /**
   * Absolute URL of an ONNX Runtime Web ESM build. When omitted the worker does a
   * bare `import('onnxruntime-web')`, which requires the consumer's bundler to
   * have resolved it into the worker chunk. Self-hosting the ORT bundle and
   * passing its URL is the enterprise-friendly path (no CDN egress).
   */
  moduleUrl?: string;
  /** Directory holding `ort-wasm-*.wasm`. Defaults to ORT's own resolution. */
  wasmPaths?: string;
  /** Threads for the WASM EP. 1 unless the page is cross-origin isolated. */
  numThreads?: number;
  /** Whether SIMD was detected. */
  simd?: boolean;
}

/* ------------------------------------------------------------------ *
 * Requests (main thread → worker)
 * ------------------------------------------------------------------ */

export interface TransferableFile {
  /** Basename used to match against `ModelRuntimeHints.modelFile` / `tokenizerFile`. */
  name: string;
  url: string;
  bytes: ArrayBuffer;
}

export interface DetectRequest {
  kind: 'detect';
  id: RequestId;
  payload: {
    policy: RuntimePolicy;
    enterpriseOverride?: EnterpriseWebgpuOverride;
    adapterTimeoutMs?: number;
  };
}

export interface LoadRequest {
  kind: 'load';
  id: RequestId;
  payload: {
    backend: LocalBackendKind;
    manifest: ResolvedManifest;
    files: TransferableFile[];
    ort?: OrtLoadConfig;
    /** Run one throwaway inference after session creation (§60 warmup). */
    warmup?: boolean;
  };
}

export type InferPayload =
  | {
      op: 'embed';
      task: Extract<LocalTask, 'embedding'>;
      texts: string[];
      options?: EmbedOptions;
    }
  | {
      op: 'classify_intent';
      task: Extract<LocalTask, 'intent_classification'>;
      text: string;
    }
  | {
      op: 'rerank';
      task: Extract<LocalTask, 'reranking'>;
      query: string;
      docs: RerankDocument[];
      topK: number;
    }
  | {
      op: 'safety_precheck';
      task: Extract<LocalTask, 'safety_precheck'>;
      text: string;
    };

export interface InferRequest {
  kind: 'infer';
  id: RequestId;
  payload: InferPayload & { timeoutMs?: number };
}

export interface ReleaseRequest {
  kind: 'release';
  id: RequestId;
  /** Omit `task` to release everything (§60 idle timeout). */
  payload: { task?: LocalTask };
}

export interface DisposeRequest {
  kind: 'dispose';
  id: RequestId;
  payload: Record<string, never>;
}

export type WorkerRequest =
  | DetectRequest
  | LoadRequest
  | InferRequest
  | ReleaseRequest
  | DisposeRequest;

export type WorkerRequestKind = WorkerRequest['kind'];

/* ------------------------------------------------------------------ *
 * Responses (worker → main thread)
 * ------------------------------------------------------------------ */

/** Sent unsolicited once the worker module has finished evaluating. */
export interface BootResponse {
  kind: 'boot';
  id: '__boot__';
  payload: { protocol: number; ok: true };
}

export interface DetectedResponse {
  kind: 'detected';
  id: RequestId;
  payload: {
    capability: ComputeCapability;
    /** Diagnostic extras for the admin runtime page. Content-free. */
    detail: {
      crossOriginIsolated: boolean;
      sharedArrayBuffer: boolean;
      wasmThreads: number;
      cores: number;
      softwareAdapter: boolean;
      webgpuUnavailableReason?: string;
    };
  };
}

export interface LoadedResponse {
  kind: 'loaded';
  id: RequestId;
  payload: {
    task: LocalTask;
    model_id: string;
    backend: LocalBackendKind;
    load_ms: number;
    dimension?: number;
    /** ORT reported which EP actually bound; may differ from the request. */
    execution_provider: string;
  };
}

export interface ProgressResponse {
  kind: 'progress';
  id: RequestId;
  payload: {
    task: LocalTask;
    phase: 'session' | 'warmup' | 'tokenizer' | 'inference';
    loaded?: number;
    total?: number;
    message?: string;
  };
}

export type InferResult =
  | {
      op: 'embed';
      vectors: number[][];
      dimension: number;
      model_id: string;
      inference_ms: number;
    }
  | {
      op: 'classify_intent';
      label: IntentLabel;
      confidence: number;
      scores: Record<IntentLabel, number>;
      model_id: string;
      inference_ms: number;
    }
  | {
      op: 'rerank';
      hits: Array<{ id: string; score: number; rank: number; previous_rank: number }>;
      model_id: string;
      inference_ms: number;
    }
  | {
      op: 'safety_precheck';
      pass: boolean;
      findings: SafetyFinding[];
      risk: number;
      masked: string;
      inference_ms: number;
    };

export interface ResultResponse {
  kind: 'result';
  id: RequestId;
  payload: InferResult;
}

export interface ReleasedResponse {
  kind: 'released';
  id: RequestId;
  payload: { task?: LocalTask };
}

export interface DisposedResponse {
  kind: 'disposed';
  id: RequestId;
  payload: Record<string, never>;
}

export interface WorkerErrorPayload {
  reason: FallbackReason;
  message: string;
  backend: ComputeBackend;
  /** true ⇒ do not retry this backend for a while (device lost, unsupported op). */
  fatal: boolean;
  task?: LocalTask;
}

export interface ErrorResponse {
  kind: 'error';
  id: RequestId;
  payload: WorkerErrorPayload;
}

export type WorkerResponse =
  | BootResponse
  | DetectedResponse
  | LoadedResponse
  | ProgressResponse
  | ResultResponse
  | ReleasedResponse
  | DisposedResponse
  | ErrorResponse;

export type WorkerResponseKind = WorkerResponse['kind'];

/**
 * The response kind that settles each request kind. `worker-host.ts` maps the same
 * relation to *types* in `TerminalResponseMap`; this is the runtime half, used to
 * detect protocol drift when a reply arrives with the wrong kind for its id.
 */
export const TERMINAL_RESPONSE_KIND: Record<WorkerRequestKind, WorkerResponseKind> = {
  detect: 'detected',
  load: 'loaded',
  infer: 'result',
  release: 'released',
  dispose: 'disposed',
};

export const BOOT_ID = '__boot__';

/* ------------------------------------------------------------------ *
 * Exhaustiveness
 * ------------------------------------------------------------------ */

/**
 * Compile-time exhaustiveness guard. If a new member is added to `WorkerRequest`
 * or `WorkerResponse` and a `switch` does not handle it, the call to this function
 * fails to typecheck because the argument is no longer `never`.
 *
 * At runtime it throws, which is correct: reaching it means the union and the
 * switch have drifted apart.
 */
export function assertNever(value: never, context: string): never {
  const shown =
    value && typeof value === 'object'
      ? String((value as { kind?: unknown }).kind ?? '[object]')
      : String(value);
  throw new Error(`${context}: unhandled protocol member "${shown}"`);
}

/* ------------------------------------------------------------------ *
 * Runtime validation of untrusted `postMessage` data
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REQUEST_KINDS: readonly WorkerRequestKind[] = [
  'detect',
  'load',
  'infer',
  'release',
  'dispose',
];

const RESPONSE_KINDS: readonly WorkerResponseKind[] = [
  'boot',
  'detected',
  'loaded',
  'progress',
  'result',
  'released',
  'disposed',
  'error',
];

/**
 * Structural check only — it confirms the envelope (`kind` is a known member and
 * `id` is a string) so the correlation layer can route the message. Per-kind
 * payload fields are read defensively by the handlers themselves.
 */
export function parseWorkerRequest(data: unknown): WorkerRequest | null {
  if (!isRecord(data)) return null;
  const kind = data['kind'];
  const id = data['id'];
  if (typeof kind !== 'string' || typeof id !== 'string') return null;
  if (!REQUEST_KINDS.includes(kind as WorkerRequestKind)) return null;
  if (!isRecord(data['payload']) && data['payload'] !== undefined) return null;
  return data as unknown as WorkerRequest;
}

export function parseWorkerResponse(data: unknown): WorkerResponse | null {
  if (!isRecord(data)) return null;
  const kind = data['kind'];
  const id = data['id'];
  if (typeof kind !== 'string' || typeof id !== 'string') return null;
  if (!RESPONSE_KINDS.includes(kind as WorkerResponseKind)) return null;
  return data as unknown as WorkerResponse;
}

export function isErrorResponse(response: WorkerResponse): response is ErrorResponse {
  return response.kind === 'error';
}

export function isProgressResponse(response: WorkerResponse): response is ProgressResponse {
  return response.kind === 'progress';
}

/** Monotonic-ish request ids. `crypto.randomUUID` when available. */
export function createRequestId(prefix = 'r'): RequestId {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === 'function') return `${prefix}_${c.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
