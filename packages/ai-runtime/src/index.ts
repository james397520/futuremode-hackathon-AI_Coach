/**
 * `@ai-coach/ai-runtime` — the client-side three-tier inference runtime.
 *
 *     capability detection → WebGPU EP → (fallback) WASM SIMD → (fallback) Server
 *
 * §51: WebGPU is an **acceleration layer, not a dependency**. Everything exported
 * here works on a browser with no WebGPU, no SIMD, no workers and no storage — it
 * is just slower and less private, never broken.
 *
 * Importing this module is side-effect free and safe during Next.js server
 * rendering: no browser API is touched until a method is called.
 *
 * §96 note for consumers: keep this out of the initial bundle.
 *
 *     const { createAiRuntime } = await import('@ai-coach/ai-runtime');
 *
 * ONNX Runtime Web and the model weights are loaded lazily *behind* this package,
 * inside the worker, and only once local acceleration is actually enabled.
 */
import type { ComputeBackend, RuntimeState } from '@ai-coach/shared-types';

import type { FallbackReason } from './backends/types';
import { FALLBACK_REASONS, describeFallbackReason } from './backends/types';

/** Fast membership test for the machine-readable reason prefix in a detail line. */
const FALLBACK_REASON_SET: ReadonlySet<string> = new Set<string>(FALLBACK_REASONS);

/* ------------------------------------------------------------------ *
 * Façade
 * ------------------------------------------------------------------ */

export { createAiRuntime } from './runtime';
export type { AiRuntime, AiRuntimeOptions, RuntimeSnapshot } from './runtime';

/* ------------------------------------------------------------------ *
 * Capability + state machine
 * ------------------------------------------------------------------ */

export {
  DEFAULT_RUNTIME_POLICY,
  classifyMemory,
  createRuntimeStateMachine,
  detectCapability,
  detectCrossOriginIsolated,
  detectSharedArrayBuffer,
  detectWasm,
  detectWasmSimd,
  detectWorker,
  errorText,
  hasNavigator,
  isBrowser,
  isRuntimeState,
  isWorkerScope,
  nextRuntimeState,
  probeWebgpu,
  selectBackend,
  serverOnlyCapability,
  toComputeCapability,
} from './capability';
export type {
  BackendSelection,
  BackendSelectionInput,
  DetailedComputeCapability,
  DetectOptions,
  EnterpriseWebgpuOverride,
  RuntimeEvent,
  RuntimeStateMachine,
} from './capability';

/* ------------------------------------------------------------------ *
 * Backend contract
 * ------------------------------------------------------------------ */

export {
  BackendFailure,
  FALLBACK_REASONS,
  INTENT_LABELS,
  describeFallbackReason,
} from './backends/types';
export type {
  AuthorityLevel,
  EmbedOptions,
  EmbedResult,
  FallbackReason,
  InferenceBackend,
  IntentLabel,
  IntentResult,
  LoadProgress,
  MemoryClass,
  ModelKind,
  ModelRuntimeHints,
  RerankDocument,
  RerankHit,
  RerankResult,
  ResolvedManifest,
  SafetyCategory,
  SafetyFinding,
  SafetyResult,
  SafetySeverity,
  TaskOutcome,
  TaskOutcomeMeta,
  TaskRunner,
} from './backends/types';

export { ServerBackend, DEFAULT_SERVER_ENDPOINTS } from './backends/server-backend';
export type { ServerBackendOptions, ServerEndpoints } from './backends/server-backend';
export { WebgpuBackend } from './backends/webgpu-backend';
export type { WebgpuBackendOptions } from './backends/webgpu-backend';
export { WasmBackend } from './backends/wasm-backend';
export type { WasmBackendOptions } from './backends/wasm-backend';
export { OrtBackend } from './backends/ort-backend';
export type { LoadedModel, OrtBackendOptions } from './backends/ort-backend';

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export {
  EMBEDDING_AUTHORITY,
  MAX_EMBED_BATCH,
  MAX_EMBED_CHARS,
  cosineSimilarity,
  embedQuery,
  embedTexts,
  localSemanticSearch,
} from './tasks/embedding';
export type { EmbedTaskOptions, EmbeddingMemo, SemanticSearchHit } from './tasks/embedding';

export {
  INTENT_AUTHORITY,
  INTENT_MIN_CONFIDENCE,
  MAX_INTENT_CHARS,
  classifyIntent,
  describeIntent,
  isActionableHint,
  isIntentLabel,
  toOrchestratorHint,
} from './tasks/intent-classification';
export type { IntentHint, IntentTaskOptions } from './tasks/intent-classification';

export {
  DEFAULT_RERANK_TOP_K,
  MAX_RERANK_CANDIDATES,
  RERANK_AUTHORITY,
  originalOrder,
  rerank,
  rerankStrict,
  shouldRerankLocally,
} from './tasks/reranking';
export type { RerankTaskOptions } from './tasks/reranking';

export {
  MASK_TOKEN,
  MAX_PRECHECK_CHARS,
  SAFETY_PRECHECK_AUTHORITY,
  maskFindings,
  redact,
  runSafetyHeuristics,
  safetyPrecheck,
  safetyPrecheckLocal,
} from './tasks/safety-precheck';

/* ------------------------------------------------------------------ *
 * Lifecycle, cache, fallback, telemetry, manifests
 * ------------------------------------------------------------------ */

export { RuntimeLifecycle } from './lifecycle';
export type { LifecyclePhase, RuntimeLifecycleOptions } from './lifecycle';

export { DEFAULT_CACHE_NAME, DEFAULT_DB_NAME, ModelCache, derivedMemoKey, sha256Hex } from './cache';
export type { CacheStats, CachedFileMeta, ManifestFileRef, ModelCacheOptions } from './cache';

export { FallbackController } from './fallback';
export type { FallbackControllerOptions, FallbackNotification } from './fallback';

export {
  TelemetryCollector,
  assertContentFree,
  createApiTelemetryReporter,
} from './telemetry';
export type {
  ApiTelemetryReporterOptions,
  ContentFree,
  RuntimeTelemetryDetail,
  TelemetryCollectorOptions,
  TelemetryDetailPatch,
  TelemetryPatch,
  TelemetryReporter,
} from './telemetry';

export {
  DEFAULT_MODEL_BASE_URL,
  MODEL_FREE_TASKS,
  PUBLIC_MODEL_MIRROR,
  createManifestRegistry,
  resolveManifest,
} from './manifest';
export type { ManifestRegistry, ManifestRegistryOptions, ModelVariant } from './manifest';

export { WordPieceTokenizer } from './tokenizer';
export type { EncodedBatch, EncodedInput, TokenizerOptions } from './tokenizer';

/* ------------------------------------------------------------------ *
 * Worker
 * ------------------------------------------------------------------ */

export { WorkerHost } from './worker/worker-host';
export type { TerminalResponseMap, WorkerHostOptions, WorkerStatus } from './worker/worker-host';
export { WorkerBackend } from './worker/worker-backend';
export type { ModelFileBytes, WorkerBackendOptions } from './worker/worker-backend';
export {
  BOOT_ID,
  PROTOCOL_VERSION,
  TERMINAL_RESPONSE_KIND,
  assertNever,
  createRequestId,
  isErrorResponse,
  isProgressResponse,
  parseWorkerRequest,
  parseWorkerResponse,
} from './worker/protocol';
export type {
  DetectRequest,
  DetectedResponse,
  DisposeRequest,
  DisposedResponse,
  ErrorResponse,
  InferPayload,
  InferRequest,
  InferResult,
  LoadRequest,
  LoadedResponse,
  LocalBackendKind,
  OrtLoadConfig,
  ProgressResponse,
  ReleaseRequest,
  ReleasedResponse,
  RequestId,
  ResultResponse,
  TransferableFile,
  WorkerErrorPayload,
  WorkerRequest,
  WorkerRequestKind,
  WorkerResponse,
  WorkerResponseKind,
} from './worker/protocol';

// Note: `./worker/inference.worker` is intentionally NOT re-exported here.
// Importing it pulls the ONNX-Runtime-facing code into whatever chunk imports the
// package index, which is exactly what §96 forbids. The worker module is loaded by
// URL (or by the consumer's own `workerFactory`) and nowhere else.

/* ------------------------------------------------------------------ *
 * §59 / §93 — the runtime status label
 * ------------------------------------------------------------------ */

/**
 * §59: "UI 顯示: Local AI / GPU accelerated — 不用顯示太多工程資訊給一般學員."
 * §93: a normal user sees only "Local AI ready"; backend / model / load time /
 * inference ms / worker status / fallback reason are the **admin** view.
 *
 * `RUNTIME_LABEL` is the canonical trainee-facing vocabulary. Anything not in here
 * does not belong on a trainee's screen.
 */
export const RUNTIME_LABEL = {
  checking: 'Checking device…',
  preparing: 'Preparing local AI…',
  gpu: 'Local AI · GPU accelerated',
  local: 'Local AI ready',
  cloud: 'AI ready',
  unavailable: 'AI unavailable',
} as const;

export type RuntimeLabelKey = keyof typeof RUNTIME_LABEL;

export type BackendTone = 'accelerated' | 'ready' | 'cloud' | 'loading' | 'unavailable';

export interface BackendDescription {
  /** The trainee-facing label. Always safe to render (§59, §93). */
  label: string;
  /** Which `RUNTIME_LABEL` entry produced it. */
  key: RuntimeLabelKey;
  /** For styling — the runtime pill's accent (§93 status UI). */
  tone: BackendTone;
  /** True when the device is doing the work rather than the server. */
  onDevice: boolean;
  /**
   * Engineering detail. **Admin only** (§93). `undefined` unless
   * `audience: 'admin'` was requested, so it cannot leak into a trainee view by
   * accident.
   */
  detail?: string;
}

export interface DescribeBackendInput {
  backend: ComputeBackend;
  state: RuntimeState;
  /** Defaults to 'trainee' — the restrictive option is the default on purpose. */
  audience?: 'trainee' | 'admin';
  /** Admin extras (§93). Ignored for a trainee audience. */
  modelId?: string;
  loadMs?: number;
  lastInferenceMs?: number;
  workerStatus?: string;
  fallbackReason?: FallbackReason | string;
  executionProvider?: string;
}

/**
 * The plain-language runtime label for the UI.
 *
 * A normal trainee sees one of four short strings and nothing else. Engineering
 * detail is assembled only for `audience: 'admin'`, and even then it is a single
 * line of machine facts — never anything derived from the user's content.
 */
export function describeBackend(input: DescribeBackendInput): BackendDescription {
  const audience = input.audience ?? 'trainee';

  let key: RuntimeLabelKey;
  let tone: BackendTone;
  let onDevice = false;

  switch (input.state) {
    case 'unknown':
    case 'detecting':
      key = 'checking';
      tone = 'loading';
      break;
    case 'loading':
      key = 'preparing';
      tone = 'loading';
      break;
    case 'supported':
    case 'ready':
    case 'degraded':
      if (input.backend === 'webgpu') {
        key = 'gpu';
        tone = 'accelerated';
        onDevice = true;
      } else if (input.backend === 'wasm') {
        key = 'local';
        tone = 'ready';
        onDevice = true;
      } else {
        key = 'cloud';
        tone = 'cloud';
      }
      break;
    case 'fallback':
      // §62: the UI must not look broken. On the server floor everything still
      // works, so the trainee-facing label is simply "AI ready".
      key = 'cloud';
      tone = 'cloud';
      break;
    default:
      key = 'cloud';
      tone = 'cloud';
      break;
  }

  const description: BackendDescription = {
    label: RUNTIME_LABEL[key],
    key,
    tone,
    onDevice,
  };

  if (audience !== 'admin') return description;

  const parts: string[] = [`backend=${input.backend}`, `state=${input.state}`];
  if (input.executionProvider) parts.push(`ep=${input.executionProvider}`);
  if (input.modelId) parts.push(`model=${input.modelId}`);
  if (typeof input.loadMs === 'number') parts.push(`load=${Math.round(input.loadMs)}ms`);
  if (typeof input.lastInferenceMs === 'number') {
    parts.push(`infer=${Math.round(input.lastInferenceMs)}ms`);
  }
  if (input.workerStatus) parts.push(`worker=${input.workerStatus}`);
  if (input.fallbackReason) {
    const reason = String(input.fallbackReason);
    const known = (FALLBACK_REASON_SET as ReadonlySet<string>).has(reason.split(':')[0] ?? '');
    parts.push(
      known
        ? `fallback=${reason} (${describeFallbackReason(
            (reason.split(':')[0] ?? reason) as FallbackReason,
          )})`
        : `fallback=${reason}`,
    );
  }
  return { ...description, detail: parts.join(' · ') };
}


/**
 * One-line, trainee-safe explanation of a fallback, for the notification body
 * (§62 requires a human-readable reason). Re-exported from the backend contract so
 * a UI never has to import from a deep path.
 */
export function describeFallback(reason: FallbackReason): string {
  return describeFallbackReason(reason);
}

/** Whether the local tiers did the work — used by the "stayed on your device" hint. */
export function isOnDevice(backend: ComputeBackend): boolean {
  return backend === 'webgpu' || backend === 'wasm';
}
