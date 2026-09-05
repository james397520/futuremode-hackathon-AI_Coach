/**
 * Local model registry — which model backs which `LocalTask`, at which size.
 *
 * Design rules
 * ------------
 * 1. **Small by default.** Every model here is in the 20–130 MB (quantised) range.
 *    A trainee on a locked-down enterprise laptop must not be asked to download a
 *    gigabyte before the Retrieval Playground works.
 * 2. **URLs are configuration, not code.** The default base is app-relative
 *    (`/models/...`), i.e. self-hosted next to the web app, which is what an
 *    air-gapped or CDN-blocked enterprise deployment needs. A public mirror can be
 *    passed in, but no vendor CDN is hardcoded as the only option.
 * 3. **`safety_precheck` has no model.** §55's first pass is pattern and heuristic
 *    based, runs in plain JS, and therefore works on every device with zero
 *    download. `resolveManifest('safety_precheck', …)` returns `null` on purpose.
 */
import type { LocalModelManifest, LocalTask } from '@ai-coach/shared';

import type { MemoryClass, ModelRuntimeHints, ResolvedManifest } from './backends/types';
import { INTENT_LABELS } from './backends/types';

/** Where model files are served from. Relative to the app origin by default. */
export const DEFAULT_MODEL_BASE_URL = '/models';

/**
 * An opt-in public mirror. Exported as a *constant a deployment may choose*, never
 * used unless `createManifestRegistry({ mirrors: [PUBLIC_MODEL_MIRROR] })` asks for
 * it — see rule 2 above.
 */
export const PUBLIC_MODEL_MIRROR = 'https://huggingface.co';

export interface ModelVariant {
  /** Stable id, also the cache key prefix. */
  model_id: string;
  /** Path fragment appended to the base url, e.g. `bge-small-en-v1.5/int8`. */
  path: string;
  quantization: string;
  dimension?: number;
  files: Array<{ name: string; bytes: number; sha256?: string }>;
  hints: Omit<ModelRuntimeHints, 'approxDownloadBytes'>;
}

export interface ManifestRegistryOptions {
  /** Base URL for model files. Defaults to `/models` (self-hosted). */
  baseUrl?: string;
  /** Ordered fallback bases tried when the primary 404s / is blocked. */
  mirrors?: readonly string[];
  /** Replace or extend the built-in catalogue (enterprise-approved models only). */
  catalogue?: Partial<Record<LocalTask, readonly ModelVariant[]>>;
}

/* ------------------------------------------------------------------ *
 * Built-in catalogue
 * ------------------------------------------------------------------ */

const EMBEDDING_VARIANTS: readonly ModelVariant[] = [
  {
    // English-only but tiny (33M params). The right default for a low-memory
    // device where the alternative is no local embedding at all.
    model_id: 'bge-small-en-v1.5-int8',
    path: 'bge-small-en-v1.5/int8',
    quantization: 'int8-dynamic',
    dimension: 384,
    files: [
      { name: 'model.onnx', bytes: 34_000_000 },
      { name: 'tokenizer.json', bytes: 711_000 },
    ],
    hints: {
      kind: 'embedder',
      maxSequenceLength: 512,
      pooling: 'cls',
      normalize: true,
      // bge uses an instruction prefix on the query side only.
      queryPrefix: 'Represent this sentence for searching relevant passages: ',
      passagePrefix: '',
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: true,
      memoryClass: ['low'],
    },
  },
  {
    // Multilingual is the product default (the platform is zh-TW first), but the
    // vocabulary is large, so int8 is what a mid-range machine gets.
    model_id: 'multilingual-e5-small-int8',
    path: 'multilingual-e5-small/int8',
    quantization: 'int8-dynamic',
    dimension: 384,
    files: [
      { name: 'model.onnx', bytes: 118_000_000 },
      { name: 'tokenizer.json', bytes: 17_100_000 },
    ],
    hints: {
      kind: 'embedder',
      maxSequenceLength: 512,
      pooling: 'mean',
      normalize: true,
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: false,
      memoryClass: ['medium', 'high'],
    },
  },
  {
    model_id: 'multilingual-e5-small-fp16',
    path: 'multilingual-e5-small/fp16',
    quantization: 'fp16',
    dimension: 384,
    files: [
      { name: 'model.onnx', bytes: 235_000_000 },
      { name: 'tokenizer.json', bytes: 17_100_000 },
    ],
    hints: {
      kind: 'embedder',
      maxSequenceLength: 512,
      pooling: 'mean',
      normalize: true,
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: false,
      memoryClass: ['high'],
    },
  },
];

const INTENT_VARIANTS: readonly ModelVariant[] = [
  {
    // A MiniLM-L6 sequence classifier fine-tuned on the four §53 labels. Small
    // enough to warm up inside the Live Simulation page transition.
    model_id: 'intent-minilm-l6-int8',
    path: 'intent-minilm-l6/int8',
    quantization: 'int8-dynamic',
    files: [
      { name: 'model.onnx', bytes: 23_000_000 },
      { name: 'tokenizer.json', bytes: 466_000 },
    ],
    hints: {
      kind: 'sequence_classifier',
      maxSequenceLength: 256,
      labels: INTENT_LABELS,
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: true,
      memoryClass: ['low', 'medium', 'high'],
    },
  },
  {
    model_id: 'intent-minilm-l6-fp32',
    path: 'intent-minilm-l6/fp32',
    quantization: 'none',
    files: [
      { name: 'model.onnx', bytes: 90_000_000 },
      { name: 'tokenizer.json', bytes: 466_000 },
    ],
    hints: {
      kind: 'sequence_classifier',
      maxSequenceLength: 256,
      labels: INTENT_LABELS,
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: true,
      memoryClass: ['high'],
    },
  },
];

const RERANK_VARIANTS: readonly ModelVariant[] = [
  {
    // Cross-encoder: 20 pairs per call, so it is deliberately *not* offered to
    // low-memory devices — §54 says local reranking only "when performance allows".
    model_id: 'ms-marco-minilm-l6-v2-int8',
    path: 'ms-marco-minilm-l6-v2/int8',
    quantization: 'int8-dynamic',
    files: [
      { name: 'model.onnx', bytes: 23_000_000 },
      { name: 'tokenizer.json', bytes: 466_000 },
    ],
    hints: {
      kind: 'cross_encoder',
      maxSequenceLength: 320,
      modelFile: 'model.onnx',
      tokenizerFile: 'tokenizer.json',
      lowercase: true,
      stripAccents: true,
      memoryClass: ['medium', 'high'],
    },
  },
];

const BUILT_IN_CATALOGUE: Record<LocalTask, readonly ModelVariant[]> = {
  embedding: EMBEDDING_VARIANTS,
  intent_classification: INTENT_VARIANTS,
  reranking: RERANK_VARIANTS,
  // Intentionally empty — see rule 3 in the file header.
  safety_precheck: [],
};

/** Tasks that can never run locally as a model. */
export const MODEL_FREE_TASKS: readonly LocalTask[] = ['safety_precheck'];

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

export interface ManifestRegistry {
  /** The best variant for `task` on a `memoryClass` device, or null if none. */
  resolve(task: LocalTask, memoryClass: MemoryClass): ResolvedManifest | null;
  /** Every variant registered for a task, largest last. */
  variants(task: LocalTask): readonly ModelVariant[];
  /** All alternative URLs for one manifest file, primary first. */
  mirrorsFor(manifest: LocalModelManifest, fileUrl: string): readonly string[];
  readonly baseUrl: string;
}

function joinUrl(base: string, ...parts: readonly string[]): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const tail = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0)
    .join('/');
  return tail.length > 0 ? `${trimmedBase}/${tail}` : trimmedBase;
}

export function createManifestRegistry(
  options: ManifestRegistryOptions = {},
): ManifestRegistry {
  const baseUrl = options.baseUrl ?? DEFAULT_MODEL_BASE_URL;
  const mirrors = options.mirrors ?? [];
  const catalogue: Record<LocalTask, readonly ModelVariant[]> = {
    ...BUILT_IN_CATALOGUE,
    ...(options.catalogue ?? {}),
  };

  const toManifest = (task: LocalTask, variant: ModelVariant): ResolvedManifest => {
    const approxDownloadBytes = variant.files.reduce((sum, f) => sum + f.bytes, 0);
    return {
      task,
      model_id: variant.model_id,
      quantization: variant.quantization,
      ...(variant.dimension === undefined ? {} : { dimension: variant.dimension }),
      files: variant.files.map((f) => ({
        url: joinUrl(baseUrl, variant.path, f.name),
        bytes: f.bytes,
        ...(f.sha256 === undefined ? {} : { sha256: f.sha256 }),
      })),
      hints: { ...variant.hints, approxDownloadBytes },
    };
  };

  const order: Record<MemoryClass, number> = { low: 0, medium: 1, high: 2 };

  return {
    baseUrl,

    variants(task) {
      return catalogue[task] ?? [];
    },

    resolve(task, memoryClass) {
      const pool = catalogue[task] ?? [];
      if (pool.length === 0) return null;
      const eligible = pool.filter((v) => v.hints.memoryClass.includes(memoryClass));
      if (eligible.length === 0) {
        // No variant claims this device class, so the task does not run locally
        // here. This is a deliberate answer, not a gap: it is how §54's "local
        // reranking only 效能允許時" is enforced — no reranker variant lists
        // `low`, so a low-memory device resolves to null and the fallback
        // controller uses the server-authoritative reranker instead.
        return null;
      }
      // Prefer the largest variant this device class is allowed to run.
      const best = [...eligible].sort((a, b) => {
        const aMax = Math.max(...a.hints.memoryClass.map((m) => order[m]));
        const bMax = Math.max(...b.hints.memoryClass.map((m) => order[m]));
        if (aMax !== bMax) return bMax - aMax;
        return (
          b.files.reduce((s, f) => s + f.bytes, 0) - a.files.reduce((s, f) => s + f.bytes, 0)
        );
      })[0];
      return best ? toManifest(task, best) : null;
    },

    mirrorsFor(manifest, fileUrl) {
      if (mirrors.length === 0) return [fileUrl];
      // Swap the base prefix for each mirror, keeping the same relative path.
      const trimmedBase = baseUrl.replace(/\/+$/, '');
      const relative = fileUrl.startsWith(trimmedBase)
        ? fileUrl.slice(trimmedBase.length)
        : `/${manifest.model_id}/${fileUrl.split('/').pop() ?? ''}`;
      return [fileUrl, ...mirrors.map((m) => joinUrl(m, relative))];
    },
  };
}

/** Convenience for callers that just want the default self-hosted registry. */
export function resolveManifest(
  task: LocalTask,
  memoryClass: MemoryClass,
  options?: ManifestRegistryOptions,
): ResolvedManifest | null {
  return createManifestRegistry(options).resolve(task, memoryClass);
}
