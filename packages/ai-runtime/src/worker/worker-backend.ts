/**
 * Main-thread proxy for a worker-hosted tier.
 *
 * `WebgpuBackend` / `WasmBackend` live inside the worker (§58, §95). This class
 * gives the rest of the runtime the same `InferenceBackend` shape on the main
 * thread, so the fallback controller and the task modules cannot tell the
 * difference between a local tier and the server tier.
 *
 * It also owns the one piece of the model lifecycle that has to stay on the main
 * thread: **fetching and integrity-checking the weights**. `ModelCache` needs
 * Cache Storage + IndexedDB and the app's own `fetch`; doing it here keeps
 * credentials, quota handling and the download progress UI out of the worker.
 * The resulting `ArrayBuffer`s are then *transferred* (zero-copy) into the worker.
 *
 * Consequence of transferring, stated so nobody is surprised by it: the main-thread
 * buffers are detached afterwards. Re-loading the same model reads it back from
 * Cache Storage (or re-downloads it when the enterprise cache switch is off), which
 * is the right trade — holding a second copy of a 120 MB tensor blob on the main
 * heap is exactly the kind of memory pressure that triggers §62's
 * `memory_exceeded`.
 */
import type { ComputeBackend, LocalTask } from '@ai-coach/shared';

import {
  BackendFailure,
  type EmbedOptions,
  type EmbedResult,
  type InferenceBackend,
  type IntentResult,
  type LoadProgress,
  type RerankDocument,
  type RerankResult,
  type ResolvedManifest,
  type SafetyResult,
} from '../backends/types';
import { safetyPrecheckLocal } from '../tasks/safety-precheck';
import {
  createRequestId,
  type InferPayload,
  type InferResult,
  type LocalBackendKind,
  type OrtLoadConfig,
} from './protocol';
import type { WorkerHost } from './worker-host';

export interface ModelFileBytes {
  name: string;
  url: string;
  bytes: ArrayBuffer;
}

export interface WorkerBackendOptions {
  kind: LocalBackendKind;
  host: WorkerHost;
  /** Fetch (and integrity-check) every file in a manifest. */
  fetchFiles: (
    manifest: ResolvedManifest,
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<ModelFileBytes[]>;
  ort?: OrtLoadConfig;
  /** Budget for a load, including download. Downloads can be slow on a VPN. */
  loadTimeoutMs?: number;
  inferTimeoutMs?: number;
  onProgress?: (progress: LoadProgress) => void;
  /** Reported back so telemetry can record load time per model. */
  onLoaded?: (info: { task: LocalTask; model_id: string; load_ms: number; execution_provider: string }) => void;
}

export class WorkerBackend implements InferenceBackend {
  readonly kind: ComputeBackend;

  private readonly options: WorkerBackendOptions;
  private readonly loaded = new Map<LocalTask, { model_id: string; dimension?: number }>();
  private readonly inFlightLoads = new Map<LocalTask, Promise<void>>();

  constructor(options: WorkerBackendOptions) {
    this.options = options;
    this.kind = options.kind;
  }

  isReady(task: LocalTask): boolean {
    // The safety pre-check needs no model, so the tier is always ready for it.
    if (task === 'safety_precheck') return true;
    return this.loaded.has(task);
  }

  loadedModelId(task: LocalTask): string | undefined {
    return this.loaded.get(task)?.model_id;
  }

  /**
   * Download → verify → transfer → create session → warm up.
   *
   * Concurrent calls for the same task share one promise, so two features asking
   * for embeddings at once do not download the model twice.
   */
  async load(manifest: ResolvedManifest, onProgress?: (p: LoadProgress) => void): Promise<void> {
    const existing = this.loaded.get(manifest.task);
    if (existing && existing.model_id === manifest.model_id) return;

    const inFlight = this.inFlightLoads.get(manifest.task);
    if (inFlight) return inFlight;

    const promise = this.doLoad(manifest, onProgress).finally(() => {
      this.inFlightLoads.delete(manifest.task);
    });
    this.inFlightLoads.set(manifest.task, promise);
    return promise;
  }

  private async doLoad(
    manifest: ResolvedManifest,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<void> {
    const report = (p: LoadProgress): void => {
      try {
        onProgress?.(p);
        this.options.onProgress?.(p);
      } catch {
        /* progress reporting must never break a load */
      }
    };

    report({ task: manifest.task, phase: 'download', total: manifest.hints.approxDownloadBytes });

    const files = await this.options.fetchFiles(manifest, (loaded, total) => {
      report({ task: manifest.task, phase: 'download', loaded, total });
    });

    if (files.length === 0) {
      throw new BackendFailure({
        reason: 'model_unavailable',
        backend: this.kind,
        task: manifest.task,
        fatal: true,
        message: 'No model files could be obtained.',
      });
    }

    report({ task: manifest.task, phase: 'session' });

    const response = await this.options.host.request(
      {
        kind: 'load',
        id: createRequestId('load'),
        payload: {
          backend: this.options.kind,
          manifest,
          files: files.map((f) => ({ name: f.name, url: f.url, bytes: f.bytes })),
          ...(this.options.ort ? { ort: this.options.ort } : {}),
          warmup: true,
        },
      },
      {
        ...(this.options.loadTimeoutMs ? { timeoutMs: this.options.loadTimeoutMs } : {}),
        // Zero-copy hand-off; see the note in the file header.
        transfer: files.map((f) => f.bytes),
      },
    );

    this.loaded.set(manifest.task, {
      model_id: response.payload.model_id,
      ...(response.payload.dimension === undefined
        ? {}
        : { dimension: response.payload.dimension }),
    });

    try {
      this.options.onLoaded?.({
        task: response.payload.task,
        model_id: response.payload.model_id,
        load_ms: response.payload.load_ms,
        execution_provider: response.payload.execution_provider,
      });
    } catch {
      /* ignore */
    }
  }

  /* -------------------- inference -------------------- */

  async embed(texts: readonly string[], options: EmbedOptions = {}): Promise<EmbedResult> {
    this.requireLoaded('embedding');
    const response = await this.infer({
      op: 'embed',
      task: 'embedding',
      texts: [...texts],
      ...(Object.keys(options).length > 0 ? { options } : {}),
    });
    if (response.op !== 'embed') throw this.protocolMismatch('embedding', response.op);
    return {
      vectors: response.vectors,
      dimension: response.dimension,
      model_id: response.model_id,
      backend: this.kind,
      // §52.1: the value is that the text never left the browser. The server
      // still owns the authoritative index.
      authority: 'advisory',
      local: true,
    };
  }

  async classifyIntent(text: string): Promise<IntentResult> {
    this.requireLoaded('intent_classification');
    const response = await this.infer({
      op: 'classify_intent',
      task: 'intent_classification',
      text,
    });
    if (response.op !== 'classify_intent') {
      throw this.protocolMismatch('intent_classification', response.op);
    }
    return {
      label: response.label,
      confidence: response.confidence,
      scores: response.scores,
      model_id: response.model_id,
      backend: this.kind,
      // §53: a hint for the server orchestrator, nothing more.
      authority: 'advisory',
      local: true,
    };
  }

  async rerank(
    query: string,
    docs: readonly RerankDocument[],
    topK = 5,
  ): Promise<RerankResult> {
    this.requireLoaded('reranking');
    const response = await this.infer({
      op: 'rerank',
      task: 'reranking',
      query,
      docs: [...docs],
      topK,
    });
    if (response.op !== 'rerank') throw this.protocolMismatch('reranking', response.op);
    return {
      hits: response.hits,
      model_id: response.model_id,
      backend: this.kind,
      // §54: advisory. Finance / insurance keeps server-authoritative scoring.
      authority: 'advisory',
      local: true,
    };
  }

  /**
   * Runs on the **main thread**, not in the worker.
   *
   * The heuristic is a handful of regexes over a single message: a round trip
   * through `postMessage` would cost more than the scan itself, and the composer
   * calls it on every keystroke pause. §95's "no main-thread AI inference" is
   * about model execution, which this is not.
   */
  async safetyPrecheck(text: string): Promise<SafetyResult> {
    return safetyPrecheckLocal(text, this.kind);
  }

  async release(task?: LocalTask): Promise<void> {
    if (task) this.loaded.delete(task);
    else this.loaded.clear();

    if (!this.options.host.alive) return; // nothing to release
    try {
      await this.options.host.request(
        {
          kind: 'release',
          id: createRequestId('release'),
          payload: task ? { task } : {},
        },
        { timeoutMs: 5000 },
      );
    } catch {
      // A release that fails is not worth surfacing: either the worker is gone
      // (so the resources are freed anyway) or it will be terminated next.
    }
  }

  private async infer(payload: InferPayload): Promise<InferResult> {
    const response = await this.options.host.request(
      {
        kind: 'infer',
        id: createRequestId('infer'),
        payload,
      },
      {
        ...(this.options.inferTimeoutMs ? { timeoutMs: this.options.inferTimeoutMs } : {}),
      },
    );
    return response.payload;
  }

  private requireLoaded(task: LocalTask): void {
    if (this.loaded.has(task)) return;
    throw new BackendFailure({
      reason: 'not_supported_for_task',
      backend: this.kind,
      task,
      message: `No local model is loaded for "${task}" on the ${this.kind} tier.`,
    });
  }

  private protocolMismatch(task: LocalTask, got: string): BackendFailure {
    return new BackendFailure({
      reason: 'inference_failed',
      backend: this.kind,
      task,
      message: `The worker answered a "${task}" request with a "${got}" result.`,
    });
  }
}
