/**
 * The shared body of the two local tiers.
 *
 * `WebgpuBackend` and `WasmBackend` differ in execution-provider configuration and
 * in how they classify failures; the model lifecycle, tokenisation, tensor
 * plumbing and pooling are the same, so they live here.
 *
 * This class only ever runs **inside the inference worker** (§58) — it is
 * instantiated by `inference.worker.ts`. It never fetches anything: the main
 * thread hands it already-cached, already-integrity-checked bytes.
 */
import type * as Ort from 'onnxruntime-web';

import type { ComputeBackend, LocalTask } from '@ai-coach/shared-types';

import { errorText } from '../capability';
import { WordPieceTokenizer } from '../tokenizer';
import { safetyPrecheckLocal } from '../tasks/safety-precheck';
import type { LocalBackendKind, OrtLoadConfig, TransferableFile } from '../worker/protocol';
import {
  BackendFailure,
  type EmbedOptions,
  type EmbedResult,
  type InferenceBackend,
  type IntentLabel,
  type IntentResult,
  type LoadProgress,
  type RerankDocument,
  type RerankResult,
  type ResolvedManifest,
  type SafetyResult,
} from './types';
import { INTENT_LABELS } from './types';
import {
  configureOrtEnv,
  createOrtSession,
  loadOrt,
  pickOutput,
  poolEmbeddings,
  readLogits,
  releaseOrtSession,
  runSession,
  sigmoid,
  softmax,
  toBackendFailure,
  type OrtNamespace,
  type OrtSessionHandle,
} from './ort-session';

export interface LoadedModel {
  manifest: ResolvedManifest;
  handle: OrtSessionHandle;
  tokenizer: WordPieceTokenizer;
  loadedAt: number;
  loadMs: number;
}

export interface OrtBackendOptions {
  ort?: OrtLoadConfig;
  /** Per-run timeout. §62 lists timeout as a fallback trigger. */
  inferenceTimeoutMs?: number;
  sessionTimeoutMs?: number;
  /** Max texts per embed batch, to bound peak memory on a low-end GPU. */
  maxBatchSize?: number;
}

const DEFAULT_INFERENCE_TIMEOUT_MS = 12_000;
const DEFAULT_SESSION_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_BATCH = 8;

export abstract class OrtBackend implements InferenceBackend {
  abstract readonly kind: LocalBackendKind;

  /** Execution providers passed to ORT, in priority order. */
  protected abstract executionProviders(): ReadonlyArray<
    string | { name: string; [key: string]: unknown }
  >;

  /** Threads for the WASM EP; WebGPU ignores it. */
  protected abstract sessionThreads(): number;

  /** Tier-specific pre-flight (e.g. WebGPU device-lost watch). */
  protected async prepare(_ort: OrtNamespace): Promise<void> {
    return;
  }

  /** Tier-specific health gate, checked before every run. */
  protected assertHealthy(task?: LocalTask): void {
    void task;
  }

  protected readonly models = new Map<LocalTask, LoadedModel>();
  protected readonly options: OrtBackendOptions;
  private ortNs: OrtNamespace | null = null;

  constructor(options: OrtBackendOptions = {}) {
    this.options = options;
  }

  isReady(task: LocalTask): boolean {
    // The safety pre-check has no model, so it is always ready (§55).
    if (task === 'safety_precheck') return true;
    return this.models.has(task);
  }

  protected get inferenceTimeoutMs(): number {
    return this.options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  }

  protected get sessionTimeoutMs(): number {
    return this.options.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  }

  protected get maxBatchSize(): number {
    return Math.max(1, this.options.maxBatchSize ?? DEFAULT_MAX_BATCH);
  }

  /* -------------------- load -------------------- */

  /**
   * Create the session and tokenizer for `manifest.task`. Idempotent per model id.
   * `files` are the transferred buffers; the base class picks out the two it needs
   * by the basenames in `manifest.hints`.
   */
  async loadWithFiles(
    manifest: ResolvedManifest,
    files: readonly TransferableFile[],
    onProgress?: (p: LoadProgress) => void,
  ): Promise<LoadedModel> {
    const existing = this.models.get(manifest.task);
    if (existing && existing.manifest.model_id === manifest.model_id) return existing;
    if (existing) {
      // Switching variant (e.g. after a memory-class re-classification).
      await this.release(manifest.task);
    }

    const started = now();
    const ort = await this.ensureOrt();
    await this.prepare(ort);

    const modelBytes = findFile(files, manifest.hints.modelFile);
    if (!modelBytes) {
      throw new BackendFailure({
        reason: 'model_unavailable',
        backend: this.kind,
        task: manifest.task,
        fatal: true,
        message: `Model file "${manifest.hints.modelFile}" was not supplied to the worker.`,
      });
    }
    const tokenizerBytes = findFile(files, manifest.hints.tokenizerFile);
    if (!tokenizerBytes) {
      throw new BackendFailure({
        reason: 'model_unavailable',
        backend: this.kind,
        task: manifest.task,
        fatal: true,
        message: `Tokenizer file "${manifest.hints.tokenizerFile}" was not supplied to the worker.`,
      });
    }

    onProgress?.({ task: manifest.task, phase: 'session' });

    let tokenizer: WordPieceTokenizer;
    try {
      tokenizer = WordPieceTokenizer.fromFile(manifest.hints.tokenizerFile, tokenizerBytes, {
        lowercase: manifest.hints.lowercase,
        stripAccents: manifest.hints.stripAccents,
        maxLength: manifest.hints.maxSequenceLength,
      });
    } catch (error) {
      throw new BackendFailure({
        reason: 'load_failed',
        backend: this.kind,
        task: manifest.task,
        fatal: true,
        message: `Tokenizer could not be parsed: ${errorText(error)}`,
        cause: error,
      });
    }

    const handle = await createOrtSession({
      ort,
      modelBytes,
      backend: this.kind,
      executionProviders: this.executionProviders(),
      timeoutMs: this.sessionTimeoutMs,
      threads: this.sessionThreads(),
    });

    const loaded: LoadedModel = {
      manifest,
      handle,
      tokenizer,
      loadedAt: Date.now(),
      loadMs: Math.round(now() - started),
    };
    this.models.set(manifest.task, loaded);
    return loaded;
  }

  /**
   * `InferenceBackend.load` — present so the interface is uniform, but the local
   * tiers need the file bytes, which only `loadWithFiles` can supply. The worker
   * always calls `loadWithFiles`; a direct `load()` is a programming error and is
   * reported as one rather than silently doing nothing.
   */
  async load(manifest: ResolvedManifest, onProgress?: (p: LoadProgress) => void): Promise<void> {
    void onProgress;
    const existing = this.models.get(manifest.task);
    if (existing && existing.manifest.model_id === manifest.model_id) return;
    throw new BackendFailure({
      reason: 'load_failed',
      backend: this.kind,
      task: manifest.task,
      fatal: true,
      message:
        'A local tier must be loaded through the worker with transferred model bytes; call loadWithFiles().',
    });
  }

  /** §60 warmup: one throwaway inference so the first real call is not the slow one. */
  async warmup(task: LocalTask): Promise<void> {
    const model = this.models.get(task);
    if (!model) return;
    try {
      switch (model.manifest.hints.kind) {
        case 'embedder':
          await this.embedInternal(model, ['warmup'], {});
          return;
        case 'sequence_classifier':
          await this.classifyInternal(model, 'warmup');
          return;
        case 'cross_encoder':
          await this.rerankInternal(model, 'warmup', [{ id: 'w', text: 'warmup' }], 1);
          return;
        default:
          return;
      }
    } catch (error) {
      // A failed warmup is a real signal — surface it so the fallback controller
      // steps down now rather than on the user's first query.
      throw toBackendFailure(error, this.kind, { task });
    }
  }

  private async ensureOrt(): Promise<OrtNamespace> {
    if (this.ortNs) return this.ortNs;
    const config: OrtLoadConfig = {
      ...(this.options.ort ?? {}),
      numThreads: this.sessionThreads(),
    };
    const ort = await loadOrt(config);
    configureOrtEnv(ort, config);
    this.ortNs = ort;
    return ort;
  }

  /**
   * One place where an ORT exception becomes a typed `BackendFailure` carrying the
   * §62 fallback reason, so the fallback controller never has to interpret a raw
   * runtime error.
   */
  private async runOrThrow(
    ort: OrtNamespace,
    model: LoadedModel,
    batch: Parameters<typeof runSession>[2],
    task: LocalTask,
  ): Promise<Record<string, Ort.Tensor>> {
    try {
      return await runSession(ort, model.handle, batch, this.kind, this.inferenceTimeoutMs);
    } catch (error) {
      throw toBackendFailure(error, this.kind, { task });
    }
  }

  /* -------------------- embedding (§52.1) -------------------- */

  async embed(texts: readonly string[], options: EmbedOptions = {}): Promise<EmbedResult> {
    this.assertHealthy('embedding');
    const model = this.requireModel('embedding');
    return this.embedInternal(model, texts, options);
  }

  private async embedInternal(
    model: LoadedModel,
    texts: readonly string[],
    options: EmbedOptions,
  ): Promise<EmbedResult> {
    const ort = await this.ensureOrt();
    const hints = model.manifest.hints;
    const prefix =
      options.role === 'passage' ? (hints.passagePrefix ?? '') : (hints.queryPrefix ?? '');
    const prepared = texts.map((t) => `${prefix}${typeof t === 'string' ? t : ''}`);

    const vectors: number[][] = [];
    let dimension = model.manifest.dimension ?? 0;

    for (let i = 0; i < prepared.length; i += this.maxBatchSize) {
      const slice = prepared.slice(i, i + this.maxBatchSize);
      const batch = model.tokenizer.encodeBatch(slice, options.maxLength);
      const outputs = await this.runOrThrow(ort, model, batch, 'embedding');
      const tensor = pickOutput(outputs, [
        'sentence_embedding',
        'last_hidden_state',
        'embeddings',
        'output',
      ]);
      if (!tensor) {
        throw new BackendFailure({
          reason: 'inference_failed',
          backend: this.kind,
          task: 'embedding',
          message: 'The embedding model produced no output tensor.',
        });
      }
      const pooled = poolEmbeddings(
        tensor,
        batch.attentionMask,
        hints.pooling ?? 'mean',
        hints.normalize ?? true,
      );
      for (const vector of pooled) {
        vectors.push(vector);
        if (dimension === 0) dimension = vector.length;
      }
    }

    if (vectors.length !== prepared.length) {
      throw new BackendFailure({
        reason: 'inference_failed',
        backend: this.kind,
        task: 'embedding',
        message: `Expected ${prepared.length} vectors but produced ${vectors.length}.`,
      });
    }

    return {
      vectors,
      dimension,
      model_id: model.manifest.model_id,
      backend: this.kind as ComputeBackend,
      // Advisory: the server owns the authoritative index (§52.1 is about not
      // having to send *test* queries out of the browser).
      authority: 'advisory',
      local: true,
    };
  }

  /* -------------------- intent classification (§53) -------------------- */

  async classifyIntent(text: string): Promise<IntentResult> {
    this.assertHealthy('intent_classification');
    const model = this.requireModel('intent_classification');
    return this.classifyInternal(model, text);
  }

  private async classifyInternal(model: LoadedModel, text: string): Promise<IntentResult> {
    const ort = await this.ensureOrt();
    const batch = model.tokenizer.encodeBatch([typeof text === 'string' ? text : '']);
    const outputs = await this.runOrThrow(ort, model, batch, 'intent_classification');
    const tensor = pickOutput(outputs, ['logits', 'output', 'output_0']);
    if (!tensor) {
      throw new BackendFailure({
        reason: 'inference_failed',
        backend: this.kind,
        task: 'intent_classification',
        message: 'The intent model produced no output tensor.',
      });
    }
    const rows = readLogits(tensor);
    const row = rows[0];
    if (!row || row.length === 0) {
      throw new BackendFailure({
        reason: 'inference_failed',
        backend: this.kind,
        task: 'intent_classification',
        message: 'The intent model produced an empty logit row.',
      });
    }
    const labels = (model.manifest.hints.labels ?? INTENT_LABELS) as readonly string[];
    const probabilities = softmax(row);

    const scores = emptyIntentScores();
    let best: IntentLabel = 'question';
    let bestValue = -1;
    for (let i = 0; i < labels.length; i += 1) {
      const label = normaliseIntentLabel(labels[i]);
      if (!label) continue;
      const value = probabilities[i] ?? 0;
      scores[label] = Math.max(scores[label], value);
      if (value > bestValue) {
        bestValue = value;
        best = label;
      }
    }

    return {
      label: best,
      confidence: bestValue < 0 ? 0 : Number(bestValue.toFixed(4)),
      scores,
      model_id: model.manifest.model_id,
      backend: this.kind as ComputeBackend,
      // §53: the result is sent to the server orchestrator as a hint. It never
      // decides anything on its own.
      authority: 'advisory',
      local: true,
    };
  }

  /* -------------------- reranking (§54) -------------------- */

  async rerank(
    query: string,
    docs: readonly RerankDocument[],
    topK = 5,
  ): Promise<RerankResult> {
    this.assertHealthy('reranking');
    const model = this.requireModel('reranking');
    return this.rerankInternal(model, query, docs, topK);
  }

  private async rerankInternal(
    model: LoadedModel,
    query: string,
    docs: readonly RerankDocument[],
    topK: number,
  ): Promise<RerankResult> {
    const ort = await this.ensureOrt();
    if (docs.length === 0) {
      return {
        hits: [],
        model_id: model.manifest.model_id,
        backend: this.kind as ComputeBackend,
        authority: 'advisory',
        local: true,
      };
    }

    const scored: Array<{ id: string; score: number; previous_rank: number }> = [];
    for (let i = 0; i < docs.length; i += this.maxBatchSize) {
      const slice = docs.slice(i, i + this.maxBatchSize);
      const batch = model.tokenizer.encodePairBatch(
        query,
        slice.map((d) => d.text),
      );
      const outputs = await this.runOrThrow(ort, model, batch, 'reranking');
      const tensor = pickOutput(outputs, ['logits', 'score', 'output', 'output_0']);
      if (!tensor) {
        throw new BackendFailure({
          reason: 'inference_failed',
          backend: this.kind,
          task: 'reranking',
          message: 'The reranker produced no output tensor.',
        });
      }
      const rows = readLogits(tensor);
      for (let j = 0; j < slice.length; j += 1) {
        const doc = slice[j];
        if (!doc) continue;
        const row = rows[j];
        // A cross-encoder head is either 1 logit (relevance) or 2 (irrelevant,
        // relevant). Handle both without guessing wrong.
        const raw =
          row && row.length >= 2
            ? (softmax(row)[1] ?? 0)
            : sigmoid(row && row.length === 1 ? (row[0] ?? 0) : 0);
        scored.push({ id: doc.id, score: Number(raw.toFixed(6)), previous_rank: i + j });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const limit = Math.max(1, Math.min(topK, scored.length));
    const hits = scored.slice(0, limit).map((entry, index) => ({
      id: entry.id,
      score: entry.score,
      rank: index,
      previous_rank: entry.previous_rank,
    }));

    return {
      hits,
      model_id: model.manifest.model_id,
      backend: this.kind as ComputeBackend,
      // §54: advisory. Finance / insurance deployments keep server-authoritative
      // scoring, and this reorder is only a latency optimisation for the UI.
      authority: 'advisory',
      local: true,
    };
  }

  /* -------------------- safety pre-check (§55) -------------------- */

  /**
   * Delegates to the shared pure heuristic. No model, no session, no GPU — which
   * is why it works even when every local model failed to load.
   */
  async safetyPrecheck(text: string): Promise<SafetyResult> {
    return safetyPrecheckLocal(text, this.kind as ComputeBackend);
  }

  /* -------------------- release (§60) -------------------- */

  async release(task?: LocalTask): Promise<void> {
    if (task) {
      const model = this.models.get(task);
      this.models.delete(task);
      await releaseOrtSession(model?.handle);
      return;
    }
    const all = [...this.models.values()];
    this.models.clear();
    for (const model of all) {
      await releaseOrtSession(model.handle);
    }
  }

  loadedModel(task: LocalTask): LoadedModel | undefined {
    return this.models.get(task);
  }

  protected requireModel(task: LocalTask): LoadedModel {
    const model = this.models.get(task);
    if (!model) {
      throw new BackendFailure({
        reason: 'not_supported_for_task',
        backend: this.kind,
        task,
        message: `No local model is loaded for "${task}" on the ${this.kind} tier.`,
      });
    }
    return model;
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function findFile(
  files: readonly TransferableFile[],
  wanted: string,
): ArrayBuffer | undefined {
  const exact = files.find((f) => f.name === wanted);
  if (exact) return exact.bytes;
  const byTail = files.find((f) => f.url.endsWith(`/${wanted}`) || f.url.endsWith(wanted));
  if (byTail) return byTail.bytes;
  // Last resort: match by extension, so a `model_quantized.onnx` still loads when
  // the manifest said `model.onnx`.
  const wantedExt = wanted.slice(wanted.lastIndexOf('.'));
  const byExt = files.find((f) => f.name.endsWith(wantedExt));
  return byExt?.bytes;
}

function emptyIntentScores(): Record<IntentLabel, number> {
  return { objection: 0, question: 0, off_topic: 0, close_intent: 0 };
}

/** Accept `off-topic`, `close intent`, `LABEL_0`-free variants, etc. */
function normaliseIntentLabel(value: string | undefined): IntentLabel | null {
  if (!value) return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return (INTENT_LABELS as readonly string[]).includes(key) ? (key as IntentLabel) : null;
}

function now(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch {
    /* ignore */
  }
  return Date.now();
}
