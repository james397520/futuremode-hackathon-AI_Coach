/**
 * Shared ONNX Runtime Web machinery for the two local tiers.
 *
 * `webgpu-backend.ts` and `wasm-backend.ts` differ only in execution-provider
 * configuration and failure semantics; the session plumbing, tensor building,
 * pooling and error classification are identical and live here.
 *
 * ORT is **never statically imported**. §96 forbids the ML package from entering
 * the initial bundle, so the only reference is the `await import(...)` inside
 * `loadOrt()`, which runs in the worker the first time a local tier is used.
 */
import type * as Ort from 'onnxruntime-web';

import { errorText } from '../capability';
import type { EncodedBatch } from '../tokenizer';
import { BackendFailure, type FallbackReason } from './types';
import type { LocalBackendKind, OrtLoadConfig } from '../worker/protocol';

export type OrtNamespace = typeof Ort;

let ortPromise: Promise<OrtNamespace> | null = null;
let ortConfigured = false;

/**
 * Lazily load ONNX Runtime Web.
 *
 * Two paths:
 *   - `config.moduleUrl` set → `import(url)`. The specifier is a variable, so the
 *     consumer's bundler leaves it alone; this is the self-hosted / air-gapped
 *     path and the one an enterprise deployment should use.
 *   - otherwise → a bare `import('onnxruntime-web')`, resolved by whatever bundled
 *     the worker.
 *
 * Cached, because creating a second ORT instance would allocate a second WASM heap.
 */
export async function loadOrt(config: OrtLoadConfig = {}): Promise<OrtNamespace> {
  if (ortPromise) return ortPromise;
  ortPromise = (async () => {
    try {
      const mod: unknown = config.moduleUrl
        ? await import(/* @vite-ignore */ /* webpackIgnore: true */ config.moduleUrl)
        : await import('onnxruntime-web');
      const ns = unwrapModule(mod);
      if (!ns) {
        throw new Error('the module did not export InferenceSession');
      }
      return ns;
    } catch (error) {
      // Reset so a later attempt (e.g. after the admin self-hosts the bundle) can
      // retry instead of being poisoned forever.
      ortPromise = null;
      throw new BackendFailure({
        reason: 'load_failed',
        backend: 'wasm',
        fatal: true,
        message: `ONNX Runtime Web could not be loaded: ${errorText(error)}`,
        cause: error,
      });
    }
  })();
  return ortPromise;
}

function unwrapModule(mod: unknown): OrtNamespace | null {
  if (!mod || typeof mod !== 'object') return null;
  const direct = mod as { InferenceSession?: unknown; default?: unknown };
  if (direct.InferenceSession) return mod as OrtNamespace;
  const fallback = direct.default as { InferenceSession?: unknown } | undefined;
  if (fallback && fallback.InferenceSession) return fallback as unknown as OrtNamespace;
  return null;
}

/** Configure the global ORT env once. Safe to call repeatedly. */
export function configureOrtEnv(ort: OrtNamespace, config: OrtLoadConfig): void {
  if (ortConfigured) return;
  try {
    if (config.wasmPaths) ort.env.wasm.wasmPaths = config.wasmPaths;
    // Threads > 1 requires SharedArrayBuffer, i.e. cross-origin isolation. The
    // caller has already checked; we just apply the number it computed.
    ort.env.wasm.numThreads = Math.max(1, config.numThreads ?? 1);
    if (typeof config.simd === 'boolean') ort.env.wasm.simd = config.simd;
    // The ORT proxy worker would be a *second* worker inside ours; we already run
    // off the main thread, so it only adds a hop.
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    ortConfigured = true;
  } catch (error) {
    // A read-only env in an exotic build must not stop us from creating sessions.
    void errorText(error);
  }
}

/* ------------------------------------------------------------------ *
 * Error classification
 * ------------------------------------------------------------------ */

export interface ClassifiedFailure {
  reason: FallbackReason;
  fatal: boolean;
}

/**
 * Map an ORT / WebGPU error onto a §62 fallback reason.
 *
 * ORT surfaces most of these as plain `Error`s with provider text in the message,
 * so string matching is unavoidable. The mapping is ordered most-specific first,
 * and the default is a non-fatal `inference_failed` so a transient hiccup does not
 * permanently disable a tier.
 */
export function classifyOrtError(error: unknown, backend: LocalBackendKind): ClassifiedFailure {
  if (BackendFailure.is(error)) return { reason: error.reason, fatal: error.fatal };

  const text = errorText(error).toLowerCase();
  const name = error instanceof Error ? error.name : '';

  if (name === 'AbortError' || /abort/.test(text)) {
    return { reason: 'aborted', fatal: false };
  }
  if (/device.*lost|lost.*device|gpudevice.*destroyed|device is destroyed/.test(text)) {
    // A lost device is fatal for the session; the whole webgpu tier must be
    // abandoned until re-detection.
    return { reason: 'device_lost', fatal: true };
  }
  if (
    /out of memory|oom|allocation failed|failed to allocate|cannot allocate|buffer size|exceeds the limit|maxbuffersize|memory access out of bounds/.test(
      text,
    )
  ) {
    return { reason: 'memory_exceeded', fatal: true };
  }
  if (
    /not implemented|unsupported|no operator|cannot resolve operator|kernel.*not found|unrecognized operator|no available backend|unable to find backend/.test(
      text,
    )
  ) {
    // The graph genuinely cannot run here. Never retry this tier for this model.
    return { reason: 'unsupported_operator', fatal: true };
  }
  if (/timeout|timed out|deadline/.test(text)) {
    return { reason: 'timeout', fatal: false };
  }
  if (/webgpu|adapter|gpu/.test(text) && backend === 'webgpu') {
    return { reason: 'device_lost', fatal: true };
  }
  if (/wasm|webassembly|compile/.test(text)) {
    return { reason: 'load_failed', fatal: true };
  }
  return { reason: 'inference_failed', fatal: false };
}

export function toBackendFailure(
  error: unknown,
  backend: LocalBackendKind,
  extra: { task?: BackendFailure['task']; message?: string } = {},
): BackendFailure {
  if (BackendFailure.is(error) && error instanceof BackendFailure) return error;
  const { reason, fatal } = classifyOrtError(error, backend);
  return new BackendFailure({
    reason,
    backend,
    fatal,
    ...(extra.task ? { task: extra.task } : {}),
    ...(extra.message ? { message: extra.message } : {}),
    cause: error,
  });
}

/* ------------------------------------------------------------------ *
 * Timeouts
 * ------------------------------------------------------------------ */

/**
 * §62 lists `timeout` as a fallback trigger, so every session run is bounded.
 * Note that a WebGPU compute pass cannot actually be cancelled — the timeout stops
 * us *waiting*, and the abandoned promise is left to settle and be discarded.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  backend: LocalBackendKind,
  label: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new BackendFailure({
          reason: 'timeout',
          backend,
          message: `${label} exceeded ${ms}ms on the ${backend} tier.`,
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* ------------------------------------------------------------------ *
 * Session wrapper
 * ------------------------------------------------------------------ */

export type IntWidth = 'int64' | 'int32';

export interface OrtSessionHandle {
  session: Ort.InferenceSession;
  executionProvider: string;
  /** Integer width the graph's inputs actually accepted. */
  intWidth: IntWidth;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

export interface CreateSessionInput {
  ort: OrtNamespace;
  modelBytes: ArrayBuffer;
  backend: LocalBackendKind;
  /** Execution providers in priority order. */
  executionProviders: ReadonlyArray<string | Ort.ExecutionProviderConfig>;
  timeoutMs: number;
  threads?: number;
}

export async function createOrtSession(input: CreateSessionInput): Promise<OrtSessionHandle> {
  const { ort, modelBytes, backend, executionProviders, timeoutMs } = input;
  const options: Ort.SessionOptions = {
    executionProviders,
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    enableMemPattern: true,
    enableCpuMemArena: true,
    logSeverityLevel: 3,
    ...(input.threads && input.threads > 1
      ? { intraOpNumThreads: input.threads, interOpNumThreads: 1 }
      : {}),
  };

  let session: Ort.InferenceSession;
  try {
    session = await withTimeout(
      ort.InferenceSession.create(modelBytes, options),
      timeoutMs,
      backend,
      'Session creation',
    );
  } catch (error) {
    throw toBackendFailure(error, backend, {
      message: `Could not create the ${backend} session: ${errorText(error)}`,
    });
  }

  return {
    session,
    executionProvider: describeProviders(executionProviders),
    // Assume int64 (the transformers.js export default) and correct on first run.
    intWidth: 'int64',
    inputNames: [...session.inputNames],
    outputNames: [...session.outputNames],
  };
}

function describeProviders(
  providers: ReadonlyArray<string | Ort.ExecutionProviderConfig>,
): string {
  const first = providers[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof first.name === 'string') return first.name;
  return 'unknown';
}

export async function releaseOrtSession(handle: OrtSessionHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    await handle.session.release();
  } catch {
    // A session whose device was already lost throws here. Nothing to do — the
    // GPU memory is gone either way.
  }
}

/* ------------------------------------------------------------------ *
 * Feeds
 * ------------------------------------------------------------------ */

function intTensor(
  ort: OrtNamespace,
  values: readonly number[][],
  width: IntWidth,
): Ort.Tensor {
  const rows = values.length;
  const cols = rows > 0 ? (values[0]?.length ?? 0) : 0;
  const dims = [rows, cols];
  if (width === 'int32') {
    const data = new Int32Array(rows * cols);
    for (let r = 0; r < rows; r += 1) {
      const row = values[r];
      if (!row) continue;
      for (let c = 0; c < cols; c += 1) data[r * cols + c] = row[c] ?? 0;
    }
    return new ort.Tensor('int32', data, dims);
  }
  const data = new BigInt64Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    const row = values[r];
    if (!row) continue;
    for (let c = 0; c < cols; c += 1) data[r * cols + c] = BigInt(row[c] ?? 0);
  }
  return new ort.Tensor('int64', data, dims);
}

/**
 * Build the feeds a BERT-family graph expects, restricted to the inputs the graph
 * actually declares (some exports drop `token_type_ids`).
 */
export function buildFeeds(
  ort: OrtNamespace,
  handle: OrtSessionHandle,
  batch: EncodedBatch,
  width: IntWidth = handle.intWidth,
): Record<string, Ort.Tensor> {
  const feeds: Record<string, Ort.Tensor> = {};
  const wanted = new Set(handle.inputNames);
  if (wanted.has('input_ids')) feeds['input_ids'] = intTensor(ort, batch.inputIds, width);
  if (wanted.has('attention_mask')) {
    feeds['attention_mask'] = intTensor(ort, batch.attentionMask, width);
  }
  if (wanted.has('token_type_ids')) {
    feeds['token_type_ids'] = intTensor(ort, batch.tokenTypeIds, width);
  }
  // Some exports name the ids differently.
  if (Object.keys(feeds).length === 0 && handle.inputNames.length > 0) {
    const first = handle.inputNames[0];
    if (first) feeds[first] = intTensor(ort, batch.inputIds, width);
  }
  return feeds;
}

/**
 * Run the session, retrying once with the other integer width if the graph
 * rejected the tensor types. This is the difference between an int32 and an int64
 * ONNX export, and it is not discoverable from `inputNames` alone.
 */
export async function runSession(
  ort: OrtNamespace,
  handle: OrtSessionHandle,
  batch: EncodedBatch,
  backend: LocalBackendKind,
  timeoutMs: number,
): Promise<Record<string, Ort.Tensor>> {
  const attempt = async (width: IntWidth): Promise<Record<string, Ort.Tensor>> => {
    const feeds = buildFeeds(ort, handle, batch, width);
    return withTimeout(handle.session.run(feeds), timeoutMs, backend, 'Inference');
  };

  try {
    return await attempt(handle.intWidth);
  } catch (error) {
    const message = errorText(error).toLowerCase();
    const looksLikeTypeMismatch =
      /invalid.*type|unexpected.*type|tensor\(int|expected.*int|type mismatch/.test(message);
    if (!looksLikeTypeMismatch) throw error;
    const other: IntWidth = handle.intWidth === 'int64' ? 'int32' : 'int64';
    const result = await attempt(other);
    handle.intWidth = other; // remember for subsequent runs
    return result;
  }
}

/* ------------------------------------------------------------------ *
 * Output readers
 * ------------------------------------------------------------------ */

function toFloatArray(tensor: Ort.Tensor): Float32Array {
  const data = tensor.data;
  if (data instanceof Float32Array) return data;
  if (data instanceof Float64Array) return Float32Array.from(data);
  if (ArrayBuffer.isView(data)) {
    // int8 / uint8 / int32 outputs (quantised classifier heads).
    return Float32Array.from(data as unknown as ArrayLike<number>);
  }
  return new Float32Array(0);
}

export function pickOutput(
  outputs: Record<string, Ort.Tensor>,
  preferred: readonly string[],
): Ort.Tensor | undefined {
  for (const name of preferred) {
    const hit = outputs[name];
    if (hit) return hit;
  }
  const keys = Object.keys(outputs);
  const firstKey = keys[0];
  return firstKey === undefined ? undefined : outputs[firstKey];
}

/**
 * Mean- or CLS-pool `[batch, seq, hidden]` into `[batch, hidden]`, masking padded
 * positions, then optionally L2-normalise so cosine similarity is a dot product.
 */
export function poolEmbeddings(
  tensor: Ort.Tensor,
  attentionMask: readonly number[][],
  pooling: 'mean' | 'cls',
  normalize: boolean,
): number[][] {
  const dims = tensor.dims;
  const flat = toFloatArray(tensor);

  // Already pooled (`sentence_embedding` style output): [batch, hidden].
  if (dims.length === 2) {
    const batch = dims[0] ?? 0;
    const hidden = dims[1] ?? 0;
    const out: number[][] = [];
    for (let b = 0; b < batch; b += 1) {
      const vec = Array.from(flat.subarray(b * hidden, (b + 1) * hidden));
      out.push(normalize ? l2Normalize(vec) : vec);
    }
    return out;
  }

  if (dims.length !== 3) return [];
  const batch = dims[0] ?? 0;
  const seq = dims[1] ?? 0;
  const hidden = dims[2] ?? 0;
  const out: number[][] = [];

  for (let b = 0; b < batch; b += 1) {
    const vec = new Array<number>(hidden).fill(0);
    if (pooling === 'cls') {
      const base = b * seq * hidden;
      for (let h = 0; h < hidden; h += 1) vec[h] = flat[base + h] ?? 0;
    } else {
      const mask = attentionMask[b];
      let count = 0;
      for (let s = 0; s < seq; s += 1) {
        const keep = mask ? (mask[s] ?? 0) : 1;
        if (keep === 0) continue;
        count += 1;
        const base = (b * seq + s) * hidden;
        for (let h = 0; h < hidden; h += 1) {
          vec[h] = (vec[h] ?? 0) + (flat[base + h] ?? 0);
        }
      }
      if (count > 0) {
        for (let h = 0; h < hidden; h += 1) vec[h] = (vec[h] ?? 0) / count;
      }
    }
    out.push(normalize ? l2Normalize(vec) : vec);
  }
  return out;
}

export function l2Normalize(vector: readonly number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return [...vector];
  return vector.map((v) => v / norm);
}

/** Read `[batch, labels]` logits into rows. */
export function readLogits(tensor: Ort.Tensor): number[][] {
  const dims = tensor.dims;
  const flat = toFloatArray(tensor);
  if (dims.length === 1) return [Array.from(flat)];
  if (dims.length !== 2) return [];
  const batch = dims[0] ?? 0;
  const labels = dims[1] ?? 0;
  const rows: number[][] = [];
  for (let b = 0; b < batch; b += 1) {
    rows.push(Array.from(flat.subarray(b * labels, (b + 1) * labels)));
  }
  return rows;
}

export function softmax(logits: readonly number[]): number[] {
  if (logits.length === 0) return [];
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  if (!Number.isFinite(max)) return logits.map(() => 1 / logits.length);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  if (sum === 0) return logits.map(() => 1 / logits.length);
  return exps.map((v) => v / sum);
}

export function sigmoid(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const e = Math.exp(value);
  return e / (1 + e);
}

/** Reset the module-level ORT cache. Used by `dispose` so a restart is clean. */
export function resetOrtCache(): void {
  ortPromise = null;
  ortConfigured = false;
}
