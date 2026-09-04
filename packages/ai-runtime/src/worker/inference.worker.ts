/**
 * The inference worker — spec §58, §95.
 *
 * > AI inference 不應堵塞 UI main thread.
 *
 * Everything expensive happens here: capability detection (§58 explicitly allows
 * WebGPU detection in the worker), ORT session ownership, tokenisation, and the
 * inference runs themselves. The main thread only ever fetches bytes and posts
 * messages, which is how §95's "no main-thread AI inference" is actually enforced
 * rather than merely intended.
 *
 * Importing this module has **no side effects on the main thread**: the message
 * listener is only installed when `isWorkerScope()` is true, so a Next.js server
 * render or an accidental main-thread import is inert. `startInferenceWorker()` is
 * also exported explicitly, which is what the Blob bootstrap in `worker-host.ts`
 * calls.
 */
import type { LocalTask } from '@ai-coach/shared-types';

import {
  detectCapability,
  detectCrossOriginIsolated,
  detectSharedArrayBuffer,
  errorText,
  isWorkerScope,
  toComputeCapability,
} from '../capability';
import { OrtBackend } from '../backends/ort-backend';
import { resetOrtCache } from '../backends/ort-session';
import { WasmBackend } from '../backends/wasm-backend';
import { WebgpuBackend } from '../backends/webgpu-backend';
import { BackendFailure, type SafetyResult } from '../backends/types';
import { safetyPrecheckLocal } from '../tasks/safety-precheck';
import {
  BOOT_ID,
  PROTOCOL_VERSION,
  assertNever,
  parseWorkerRequest,
  type DetectRequest,
  type DisposeRequest,
  type InferRequest,
  type LoadRequest,
  type LocalBackendKind,
  type ReleaseRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

/* ------------------------------------------------------------------ *
 * Worker scope plumbing
 * ------------------------------------------------------------------ */

type PostFn = (message: WorkerResponse, transfer?: Transferable[]) => void;

function workerPost(): PostFn {
  const scope = self as unknown as {
    postMessage?: (message: unknown, transfer?: Transferable[]) => void;
  };
  return (message, transfer) => {
    try {
      if (typeof scope.postMessage !== 'function') return;
      if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
      else scope.postMessage(message);
    } catch {
      // A structured-clone failure here would otherwise silently hang the caller's
      // promise; the host's per-request timeout is the backstop.
    }
  };
}

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

interface WorkerState {
  webgpu: WebgpuBackend | null;
  wasm: WasmBackend | null;
  /** Which tier owns each task's session right now. */
  owners: Map<LocalTask, LocalBackendKind>;
}

const state: WorkerState = {
  webgpu: null,
  wasm: null,
  owners: new Map(),
};

function backendFor(kind: LocalBackendKind, request: LoadRequest | null): OrtBackend {
  if (kind === 'webgpu') {
    if (!state.webgpu) {
      state.webgpu = new WebgpuBackend({
        ...(request?.payload.ort ? { ort: request.payload.ort } : {}),
      });
    }
    return state.webgpu;
  }
  if (!state.wasm) {
    const threadsAvailable = detectSharedArrayBuffer() && detectCrossOriginIsolated();
    state.wasm = new WasmBackend({
      ...(request?.payload.ort ? { ort: request.payload.ort } : {}),
      threads: threadsAvailable ? (request?.payload.ort?.numThreads ?? 2) : 1,
    });
  }
  return state.wasm;
}

function ownerBackend(task: LocalTask): OrtBackend | null {
  const kind = state.owners.get(task);
  if (!kind) return null;
  return kind === 'webgpu' ? state.webgpu : state.wasm;
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

async function handleDetect(post: PostFn, request: DetectRequest): Promise<void> {
  const payload = request.payload ?? {};
  const capability = await detectCapability({
    ...(payload.policy ? { policy: payload.policy } : {}),
    ...(payload.enterpriseOverride ? { enterpriseOverride: payload.enterpriseOverride } : {}),
    ...(typeof payload.adapterTimeoutMs === 'number'
      ? { adapterTimeoutMs: payload.adapterTimeoutMs }
      : {}),
  });
  post({
    kind: 'detected',
    id: request.id,
    payload: {
      capability: toComputeCapability(capability),
      detail: {
        crossOriginIsolated: capability.crossOriginIsolated,
        sharedArrayBuffer: capability.sharedArrayBuffer,
        wasmThreads: capability.wasmThreads,
        cores: capability.cores,
        softwareAdapter: capability.softwareAdapter,
        ...(capability.webgpuUnavailableReason
          ? { webgpuUnavailableReason: capability.webgpuUnavailableReason }
          : {}),
      },
    },
  });
}

async function handleLoad(post: PostFn, request: LoadRequest): Promise<void> {
  const { backend: kind, manifest, files, warmup } = request.payload;
  const backend = backendFor(kind, request);

  const loaded = await backend.loadWithFiles(manifest, files, (progress) => {
    post({
      kind: 'progress',
      id: request.id,
      payload: {
        task: progress.task,
        phase: progress.phase === 'download' || progress.phase === 'verify' ? 'session' : progress.phase,
        ...(progress.loaded === undefined ? {} : { loaded: progress.loaded }),
        ...(progress.total === undefined ? {} : { total: progress.total }),
        ...(progress.message === undefined ? {} : { message: progress.message }),
      },
    });
  });

  state.owners.set(manifest.task, kind);

  if (warmup !== false) {
    post({
      kind: 'progress',
      id: request.id,
      payload: { task: manifest.task, phase: 'warmup' },
    });
    // §60: warm the session now so the first user-visible inference is not the
    // one that pays for shader compilation.
    await backend.warmup(manifest.task);
  }

  post({
    kind: 'loaded',
    id: request.id,
    payload: {
      task: manifest.task,
      model_id: manifest.model_id,
      backend: kind,
      load_ms: loaded.loadMs,
      ...(manifest.dimension === undefined ? {} : { dimension: manifest.dimension }),
      execution_provider: loaded.handle.executionProvider,
    },
  });
}

async function handleInfer(post: PostFn, request: InferRequest): Promise<void> {
  const payload = request.payload;
  const started = nowMs();

  switch (payload.op) {
    case 'embed': {
      const backend = requireOwner(payload.task);
      const result = await backend.embed(payload.texts, payload.options ?? {});
      post({
        kind: 'result',
        id: request.id,
        payload: {
          op: 'embed',
          vectors: result.vectors,
          dimension: result.dimension,
          model_id: result.model_id,
          inference_ms: Math.round(nowMs() - started),
        },
      });
      return;
    }
    case 'classify_intent': {
      const backend = requireOwner(payload.task);
      const result = await backend.classifyIntent(payload.text);
      post({
        kind: 'result',
        id: request.id,
        payload: {
          op: 'classify_intent',
          label: result.label,
          confidence: result.confidence,
          scores: result.scores,
          model_id: result.model_id,
          inference_ms: Math.round(nowMs() - started),
        },
      });
      return;
    }
    case 'rerank': {
      const backend = requireOwner(payload.task);
      const result = await backend.rerank(payload.query, payload.docs, payload.topK);
      post({
        kind: 'result',
        id: request.id,
        payload: {
          op: 'rerank',
          hits: result.hits,
          model_id: result.model_id,
          inference_ms: Math.round(nowMs() - started),
        },
      });
      return;
    }
    case 'safety_precheck': {
      // No model, no session — works even when nothing loaded (§55).
      const owner = ownerBackend('safety_precheck');
      const result: SafetyResult = owner
        ? await owner.safetyPrecheck(payload.text)
        : safetyPrecheckLocal(payload.text, 'wasm');
      post({
        kind: 'result',
        id: request.id,
        payload: {
          op: 'safety_precheck',
          pass: result.pass,
          findings: result.findings,
          risk: result.risk,
          masked: result.masked,
          inference_ms: Math.round(nowMs() - started),
        },
      });
      return;
    }
    default:
      // Exhaustiveness: adding an op to `InferPayload` breaks the build here.
      return assertNever(payload, 'inference.worker/handleInfer');
  }
}

async function handleRelease(post: PostFn, request: ReleaseRequest): Promise<void> {
  const task = request.payload?.task;
  if (task) {
    const backend = ownerBackend(task);
    state.owners.delete(task);
    if (backend) await backend.release(task);
  } else {
    // §60 idle timeout: hand the GPU back entirely.
    state.owners.clear();
    if (state.webgpu) await state.webgpu.release();
    if (state.wasm) await state.wasm.release();
  }
  post({ kind: 'released', id: request.id, payload: task ? { task } : {} });
}

async function handleDispose(post: PostFn, request: DisposeRequest): Promise<void> {
  state.owners.clear();
  try {
    if (state.webgpu) await state.webgpu.release();
  } catch {
    /* releasing a lost device throws; the memory is gone either way */
  }
  try {
    if (state.wasm) await state.wasm.release();
  } catch {
    /* ignore */
  }
  state.webgpu = null;
  state.wasm = null;
  resetOrtCache();
  post({ kind: 'disposed', id: request.id, payload: {} });
  // The host terminates us right after this; closing ourselves is belt and braces.
  try {
    (self as unknown as { close?: () => void }).close?.();
  } catch {
    /* ignore */
  }
}

function requireOwner(task: LocalTask): OrtBackend {
  const backend = ownerBackend(task);
  if (!backend) {
    throw new BackendFailure({
      reason: 'not_supported_for_task',
      backend: 'wasm',
      task,
      message: `No local model is loaded for "${task}" in the worker.`,
    });
  }
  return backend;
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

async function dispatch(post: PostFn, request: WorkerRequest): Promise<void> {
  switch (request.kind) {
    case 'detect':
      return handleDetect(post, request);
    case 'load':
      return handleLoad(post, request);
    case 'infer':
      return handleInfer(post, request);
    case 'release':
      return handleRelease(post, request);
    case 'dispose':
      return handleDispose(post, request);
    default:
      // Exhaustiveness: a new command must be handled here to compile.
      return assertNever(request, 'inference.worker/dispatch');
  }
}

function reportError(post: PostFn, id: string, error: unknown): void {
  if (BackendFailure.is(error)) {
    post({
      kind: 'error',
      id,
      payload: {
        reason: error.reason,
        message: error.message,
        backend: error.backend,
        fatal: error.fatal,
        ...(error.task ? { task: error.task } : {}),
      },
    });
    return;
  }
  post({
    kind: 'error',
    id,
    payload: {
      reason: 'inference_failed',
      message: errorText(error),
      backend: 'wasm',
      fatal: false,
    },
  });
}

/**
 * Install the message listener. Idempotent, and a no-op outside worker scope so
 * importing this module from the main thread (or during SSR) does nothing.
 */
let started = false;

export function startInferenceWorker(): void {
  if (started) return;
  if (!isWorkerScope()) return;
  started = true;

  const post = workerPost();
  const scope = self as unknown as {
    addEventListener?: (type: string, handler: (event: Event) => void) => void;
  };

  scope.addEventListener?.('message', (event: Event) => {
    const data = (event as MessageEvent<unknown>).data;
    const request = parseWorkerRequest(data);
    if (!request) {
      // Not ours — an extension, a stale protocol, or noise. Ignore silently
      // rather than replying to an id we cannot trust.
      return;
    }
    void dispatch(post, request).catch((error: unknown) => {
      reportError(post, request.id, error);
    });
  });

  // A rejection that escapes `dispatch` (e.g. inside a detached ORT promise) must
  // not kill the worker; the host would then restart it for nothing.
  scope.addEventListener?.('unhandledrejection', (event: Event) => {
    try {
      (event as PromiseRejectionEvent).preventDefault?.();
    } catch {
      /* ignore */
    }
  });

  post({ kind: 'boot', id: BOOT_ID, payload: { protocol: PROTOCOL_VERSION, ok: true } });
}

function nowMs(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    /* ignore */
  }
  return Date.now();
}

// Self-start when this module is the worker entry. Guarded, so the same module is
// safe to import anywhere.
startInferenceWorker();
