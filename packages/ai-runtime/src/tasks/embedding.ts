/**
 * Local embedding — spec §52, §52.1.
 *
 * AUTHORITY: **advisory.** The server owns the vector space the knowledge index
 * was built with, so a locally produced vector is only comparable to other locally
 * produced vectors. Never write one into the index, and never mix local and server
 * vectors in the same similarity computation — that is why `EmbedResult` carries
 * both `model_id` and `local`.
 *
 * Where it earns its place (§52.1):
 *   - **Retrieval Playground.** A coach iterating on test queries gets instant
 *     feedback, and — the actual point — the test query never leaves the browser.
 *   - **Local semantic search.** Filtering an already-loaded list of chunks or
 *     questions client-side, with no round trip.
 *
 * When the local tier is unavailable the same call goes to the server and returns
 * `authority: 'authoritative'`, `local: false`. Callers that care (because they are
 * about to tell the user "this stayed on your device") must check `local`.
 */
import type { ComputeBackend } from '@ai-coach/shared';

import type {
  AuthorityLevel,
  EmbedOptions,
  EmbedResult,
  TaskOutcome,
  TaskRunner,
} from '../backends/types';

export const EMBEDDING_AUTHORITY: AuthorityLevel = 'advisory';

/** Hard cap per call. Larger requests are rejected rather than silently truncated. */
export const MAX_EMBED_BATCH = 64;
/** Characters per input. The tokenizer truncates too; this bounds transfer cost. */
export const MAX_EMBED_CHARS = 8_000;

/** Optional in-memory memo, satisfied by `ModelCache` (§61 sensitive-data switch). */
export interface EmbeddingMemo {
  recall(key: string): number[] | undefined;
  remember(key: string, vector: readonly number[]): void;
  keyFor(modelId: string, role: string, text: string): string;
}

export interface EmbedTaskOptions extends EmbedOptions {
  /** Force the server tier (e.g. to produce index-comparable vectors). */
  serverOnly?: boolean;
  /** Refuse to fall back to the server (e.g. a privacy-critical playground run). */
  localOnly?: boolean;
  memo?: EmbeddingMemo;
}

/**
 * Embed a batch of texts.
 *
 * Input handling is deliberately forgiving — the caller is often a text field —
 * but never silently wrong:
 *   - non-strings become empty strings (a vector is still returned, so indices
 *     line up with the caller's array);
 *   - over-long inputs are clipped at `MAX_EMBED_CHARS`;
 *   - duplicates are computed once and fanned back out, which matters a lot for
 *     the playground where the same query is re-run repeatedly;
 *   - an oversized batch fails fast instead of pinning the GPU.
 */
export async function embedTexts(
  runner: TaskRunner,
  texts: readonly string[],
  options: EmbedTaskOptions = {},
): Promise<TaskOutcome<EmbedResult>> {
  const inputs = Array.isArray(texts) ? texts : [];
  if (inputs.length === 0) {
    return {
      ok: true,
      value: {
        vectors: [],
        dimension: 0,
        model_id: 'none',
        backend: 'server' as ComputeBackend,
        authority: EMBEDDING_AUTHORITY,
        local: false,
      },
      backend: 'server',
      elapsed_ms: 0,
      degraded: false,
      attempts: [],
    };
  }
  if (inputs.length > MAX_EMBED_BATCH) {
    return {
      ok: false,
      error: {
        reason: 'inference_failed',
        message: `At most ${MAX_EMBED_BATCH} texts can be embedded per call (received ${inputs.length}).`,
      },
      backend: 'server',
      elapsed_ms: 0,
      degraded: false,
      attempts: [],
    };
  }

  const normalised = inputs.map((text) =>
    typeof text === 'string' ? text.slice(0, MAX_EMBED_CHARS) : '',
  );

  // Deduplicate, remembering where each unique text came from.
  const uniqueOrder: string[] = [];
  const indexOfUnique = new Map<string, number>();
  const mapping: number[] = [];
  for (const text of normalised) {
    let index = indexOfUnique.get(text);
    if (index === undefined) {
      index = uniqueOrder.length;
      indexOfUnique.set(text, index);
      uniqueOrder.push(text);
    }
    mapping.push(index);
  }

  const role = options.role ?? 'query';
  const { role: _role, serverOnly, localOnly, memo, ...embedOptions } = options;
  void _role;

  const outcome = await runner.runTask<EmbedResult>(
    'embedding',
    async (backend) => {
      // Memo lookup happens per-backend, because a vector from the WASM tier is
      // only interchangeable with one from WebGPU (same graph), never with the
      // server's (different model).
      const pending: string[] = [];
      const cached = new Map<number, number[]>();
      if (memo) {
        for (let i = 0; i < uniqueOrder.length; i += 1) {
          const text = uniqueOrder[i] ?? '';
          const hit = memo.recall(memo.keyFor(backend.kind, role, text));
          if (hit) cached.set(i, hit);
          else pending.push(text);
        }
      } else {
        pending.push(...uniqueOrder);
      }

      let produced: EmbedResult;
      if (pending.length === 0) {
        const first = cached.get(0);
        produced = {
          vectors: [],
          dimension: first?.length ?? 0,
          model_id: 'memo',
          backend: backend.kind,
          authority: backend.kind === 'server' ? 'authoritative' : EMBEDDING_AUTHORITY,
          local: backend.kind !== 'server',
        };
      } else {
        produced = await backend.embed(pending, { ...embedOptions, role });
      }

      // Reassemble in the caller's original order.
      const uniqueVectors: number[][] = new Array<number[]>(uniqueOrder.length);
      let cursor = 0;
      for (let i = 0; i < uniqueOrder.length; i += 1) {
        const hit = cached.get(i);
        if (hit) {
          uniqueVectors[i] = hit;
          continue;
        }
        const vector = produced.vectors[cursor] ?? [];
        cursor += 1;
        uniqueVectors[i] = vector;
        if (memo && vector.length > 0) {
          memo.remember(memo.keyFor(backend.kind, role, uniqueOrder[i] ?? ''), vector);
        }
      }

      const vectors = mapping.map((index) => uniqueVectors[index] ?? []);
      const dimension = produced.dimension > 0 ? produced.dimension : (vectors[0]?.length ?? 0);

      return {
        vectors,
        dimension,
        model_id: produced.model_id,
        backend: backend.kind,
        // The server tier is authoritative; the local tiers are not (§52.1).
        authority: backend.kind === 'server' ? 'authoritative' : EMBEDDING_AUTHORITY,
        local: backend.kind !== 'server',
      };
    },
    {
      label: 'embedding',
      ...(serverOnly ? { serverOnly: true } : {}),
      ...(localOnly ? { localOnly: true } : {}),
    },
  );

  return outcome;
}

/** Convenience for the single-query case (the playground's hot path). */
export async function embedQuery(
  runner: TaskRunner,
  text: string,
  options: EmbedTaskOptions = {},
): Promise<TaskOutcome<EmbedResult>> {
  return embedTexts(runner, [text], { ...options, role: options.role ?? 'query' });
}

/* ------------------------------------------------------------------ *
 * Local similarity helpers (§52.1 local semantic search)
 * ------------------------------------------------------------------ */

/**
 * Cosine similarity. Our embedders L2-normalise, so this is usually a dot product,
 * but the norms are computed anyway — a caller may pass server vectors, which are
 * not guaranteed to be normalised.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export interface SemanticSearchHit<T> {
  item: T;
  score: number;
  rank: number;
}

/**
 * Rank an in-memory corpus against a query vector. Pure and synchronous — this is
 * the "local semantic search" of §52.1 and does no I/O at all.
 *
 * Both sides must come from the *same* model. Mixing a local query vector with
 * server-side document vectors produces meaningless scores, so the caller is
 * responsible for keeping the pair consistent (`EmbedResult.model_id`).
 */
export function localSemanticSearch<T>(
  queryVector: readonly number[],
  corpus: ReadonlyArray<{ item: T; vector: readonly number[] }>,
  topK = 5,
): Array<SemanticSearchHit<T>> {
  if (queryVector.length === 0 || corpus.length === 0) return [];
  const scored = corpus.map((entry) => ({
    item: entry.item,
    score: cosineSimilarity(queryVector, entry.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, Math.max(1, Math.min(topK, scored.length)))
    .map((entry, index) => ({ item: entry.item, score: entry.score, rank: index }));
}
