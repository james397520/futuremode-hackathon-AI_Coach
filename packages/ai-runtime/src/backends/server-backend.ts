/**
 * Tier 3 — **the server**. The always-available floor.
 *
 * Spec §51, §54, §55, §56, §62.
 *
 * This tier is what makes §51 true: WebGPU is an acceleration layer because every
 * capability the runtime exposes also exists here. It:
 *   - downloads **no model** and needs no cache, no worker, no GPU, no SIMD;
 *   - works with local acceleration disabled by policy (§61);
 *   - is the **authoritative** answer for embedding, intent and reranking (§54,
 *     §55) — the local tiers are advisory approximations of exactly this.
 *
 * `load()` is a no-op, `isReady()` is always true, and `release()` frees nothing.
 * That is the whole point: there is no state that can fail to initialise.
 */
import type { ComputeBackend, LocalTask } from '@ai-coach/shared-types';

import { errorText } from '../capability';
import { safetyPrecheckLocal } from '../tasks/safety-precheck';
import {
  BackendFailure,
  INTENT_LABELS,
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

export interface ServerEndpoints {
  embed: string;
  intent: string;
  rerank: string;
}

export const DEFAULT_SERVER_ENDPOINTS: ServerEndpoints = {
  embed: '/api/runtime/embed',
  intent: '/api/runtime/intent',
  rerank: '/api/retrieval/test',
};

export interface ServerBackendOptions {
  /** Origin or path prefix for the API. Empty means same-origin. */
  baseUrl?: string;
  endpoints?: Partial<ServerEndpoints>;
  fetchImpl?: typeof fetch;
  /** Auth headers, resolved per request so a refreshed token is picked up. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Per-request budget. */
  timeoutMs?: number;
  /** Bounded retries for transient network / 5xx failures. Defaults to 1. */
  retries?: number;
  /** Model id reported in results when the server does not name one. */
  modelIdFallback?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export class ServerBackend implements InferenceBackend {
  readonly kind: ComputeBackend = 'server';

  private readonly options: ServerBackendOptions;
  private readonly endpoints: ServerEndpoints;

  constructor(options: ServerBackendOptions = {}) {
    this.options = options;
    this.endpoints = { ...DEFAULT_SERVER_ENDPOINTS, ...(options.endpoints ?? {}) };
  }

  /** Always. That is what "floor" means. */
  isReady(_task: LocalTask): boolean {
    void _task;
    return true;
  }

  /** Nothing to load — no weights ever reach the browser on this tier. */
  async load(_manifest: ResolvedManifest, _onProgress?: (p: LoadProgress) => void): Promise<void> {
    void _manifest;
    void _onProgress;
    return;
  }

  async release(_task?: LocalTask): Promise<void> {
    void _task;
    return;
  }

  /* -------------------- embedding -------------------- */

  async embed(texts: readonly string[], options: EmbedOptions = {}): Promise<EmbedResult> {
    const payload = {
      texts: [...texts],
      role: options.role ?? 'query',
    };
    const body = await this.post<{
      vectors?: unknown;
      embeddings?: unknown;
      dimension?: unknown;
      model_id?: unknown;
      model?: unknown;
    }>(this.endpoints.embed, payload, 'embedding');

    const raw = body.vectors ?? body.embeddings;
    const vectors = parseVectorMatrix(raw);
    if (vectors.length !== texts.length) {
      throw new BackendFailure({
        reason: 'inference_failed',
        backend: 'server',
        task: 'embedding',
        message: `The server returned ${vectors.length} vectors for ${texts.length} inputs.`,
      });
    }
    const dimension =
      typeof body.dimension === 'number' && body.dimension > 0
        ? body.dimension
        : (vectors[0]?.length ?? 0);

    return {
      vectors,
      dimension,
      model_id: pickModelId(body.model_id ?? body.model, this.options.modelIdFallback),
      backend: 'server',
      // The server owns the vector space the index was built with, so its
      // embedding *is* the authoritative one.
      authority: 'authoritative',
      local: false,
    };
  }

  /* -------------------- intent (§53) -------------------- */

  async classifyIntent(text: string): Promise<IntentResult> {
    const body = await this.post<{
      label?: unknown;
      intent?: unknown;
      confidence?: unknown;
      scores?: unknown;
      model_id?: unknown;
      model?: unknown;
    }>(this.endpoints.intent, { text }, 'intent_classification');

    const scores = parseIntentScores(body.scores);
    const declared = normaliseIntent(body.label ?? body.intent);
    const label = declared ?? argmaxIntent(scores);
    const confidence =
      typeof body.confidence === 'number' && Number.isFinite(body.confidence)
        ? clamp01(body.confidence)
        : clamp01(scores[label]);

    return {
      label,
      confidence,
      scores,
      model_id: pickModelId(body.model_id ?? body.model, this.options.modelIdFallback),
      backend: 'server',
      // The orchestrator's own classification. Authoritative here, unlike the
      // local hint the browser may also produce (§53).
      authority: 'authoritative',
      local: false,
    };
  }

  /* -------------------- reranking (§54) -------------------- */

  async rerank(
    query: string,
    docs: readonly RerankDocument[],
    topK = 5,
  ): Promise<RerankResult> {
    if (docs.length === 0) {
      return {
        hits: [],
        model_id: this.options.modelIdFallback ?? 'server',
        backend: 'server',
        authority: 'authoritative',
        local: false,
      };
    }

    const previousRank = new Map<string, number>();
    docs.forEach((doc, index) => previousRank.set(doc.id, index));

    const body = await this.post<{
      hits?: unknown;
      results?: unknown;
      model_id?: unknown;
      model?: unknown;
    }>(
      this.endpoints.rerank,
      {
        query,
        top_k: topK,
        rerank: true,
        candidates: docs.map((d) => ({
          id: d.id,
          text: d.text,
          ...(d.score === undefined ? {} : { score: d.score }),
        })),
      },
      'reranking',
    );

    const rows = Array.isArray(body.hits)
      ? body.hits
      : Array.isArray(body.results)
        ? body.results
        : [];
    const hits = rows
      .map((row, index) => {
        if (!row || typeof row !== 'object') return null;
        const record = row as Record<string, unknown>;
        const id =
          typeof record['id'] === 'string'
            ? record['id']
            : typeof record['chunk_id'] === 'string'
              ? record['chunk_id']
              : null;
        if (id === null) return null;
        const score = typeof record['score'] === 'number' ? record['score'] : 0;
        return {
          id,
          score,
          rank: index,
          previous_rank: previousRank.get(id) ?? index,
        };
      })
      .filter((hit): hit is { id: string; score: number; rank: number; previous_rank: number } =>
        hit !== null,
      )
      .slice(0, Math.max(1, topK));

    return {
      hits,
      model_id: pickModelId(body.model_id ?? body.model, this.options.modelIdFallback),
      // §54: this is the server-authoritative scoring that finance and insurance
      // deployments are required to use.
      authority: 'authoritative',
      backend: 'server',
      local: false,
    };
  }

  /* -------------------- safety pre-check (§55) -------------------- */

  /**
   * Runs the same **local** heuristic as the other tiers, deliberately.
   *
   * There is no "server pre-check" endpoint: the server's authoritative safety
   * layer is the Safety Agent inside the session pipeline (§55), which evaluates
   * the whole turn in context. Calling out to the network for a first-pass regex
   * scan would add latency and — worse — ship the raw text off-device for a check
   * that does not need it. So this tier keeps the pre-check local and honest about
   * being advisory; the authoritative verdict arrives with the session events.
   */
  async safetyPrecheck(text: string): Promise<SafetyResult> {
    return safetyPrecheckLocal(text, 'server');
  }

  /* -------------------- transport -------------------- */

  private async post<T extends object>(
    path: string,
    payload: unknown,
    task: LocalTask,
  ): Promise<T> {
    const impl =
      this.options.fetchImpl ??
      (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
    if (!impl) {
      throw new BackendFailure({
        reason: 'network_failed',
        backend: 'server',
        task,
        fatal: true,
        message: 'fetch() is unavailable, so the server tier cannot be reached.',
      });
    }

    const base = (this.options.baseUrl ?? '').replace(/\/+$/, '');
    const url = `${base}${path}`;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxAttempts = Math.max(1, Math.min(3, (this.options.retries ?? 1) + 1));

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        // Bounded linear backoff. No unbounded retry loops (§62).
        await delay(250 * attempt);
      }
      const controller = createAbortController();
      const timer = setTimeout(() => controller?.abort(), timeoutMs);
      try {
        let headers: Record<string, string> = {
          'content-type': 'application/json',
          accept: 'application/json',
        };
        try {
          const extra = await this.options.headers?.();
          if (extra) headers = { ...headers, ...extra };
        } catch (error) {
          throw new BackendFailure({
            reason: 'network_failed',
            backend: 'server',
            task,
            message: `Could not resolve request headers: ${errorText(error)}`,
            cause: error,
          });
        }

        const response = await impl(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          credentials: 'include',
          ...(controller ? { signal: controller.signal } : {}),
        });

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`HTTP ${response.status} from ${path}`);
          continue; // retryable
        }
        if (!response.ok) {
          // 4xx is not retryable: bad request, unauthorised, feature disabled.
          throw new BackendFailure({
            reason: response.status === 401 || response.status === 403 ? 'policy_off' : 'inference_failed',
            backend: 'server',
            task,
            fatal: true,
            message: `The server rejected the request (HTTP ${response.status}).`,
          });
        }

        const parsed: unknown = await response.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new BackendFailure({
            reason: 'inference_failed',
            backend: 'server',
            task,
            message: 'The server returned an unexpected response shape.',
          });
        }
        return parsed as T;
      } catch (error) {
        if (BackendFailure.is(error) && error instanceof BackendFailure) {
          if (error.fatal) throw error;
          lastError = error;
          continue;
        }
        if (isAbortError(error)) {
          lastError = new BackendFailure({
            reason: 'timeout',
            backend: 'server',
            task,
            message: `The server did not respond within ${timeoutMs}ms.`,
          });
          continue;
        }
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }

    if (BackendFailure.is(lastError) && lastError instanceof BackendFailure) throw lastError;
    throw new BackendFailure({
      reason: 'network_failed',
      backend: 'server',
      task,
      message: `Could not reach ${path}: ${errorText(lastError)}`,
      cause: lastError,
    });
  }
}

/* ------------------------------------------------------------------ *
 * parsing helpers — every server field is treated as untrusted
 * ------------------------------------------------------------------ */

function parseVectorMatrix(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  const out: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) continue;
    const vector: number[] = [];
    for (const entry of row) {
      vector.push(typeof entry === 'number' && Number.isFinite(entry) ? entry : 0);
    }
    out.push(vector);
  }
  return out;
}

function emptyScores(): Record<IntentLabel, number> {
  return { objection: 0, question: 0, off_topic: 0, close_intent: 0 };
}

function normaliseIntent(value: unknown): IntentLabel | null {
  if (typeof value !== 'string') return null;
  const key = value.toLowerCase().replace(/[\s-]+/g, '_');
  return (INTENT_LABELS as readonly string[]).includes(key) ? (key as IntentLabel) : null;
}

function parseIntentScores(value: unknown): Record<IntentLabel, number> {
  const scores = emptyScores();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return scores;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const label = normaliseIntent(key);
    if (!label) continue;
    if (typeof entry === 'number' && Number.isFinite(entry)) scores[label] = clamp01(entry);
  }
  return scores;
}

function argmaxIntent(scores: Record<IntentLabel, number>): IntentLabel {
  let best: IntentLabel = 'question';
  let bestValue = -1;
  for (const label of INTENT_LABELS) {
    const value = scores[label];
    if (value > bestValue) {
      bestValue = value;
      best = label;
    }
  }
  return best;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function pickModelId(value: unknown, fallback: string | undefined): string {
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback ?? 'server';
}

function createAbortController(): AbortController | null {
  try {
    return typeof AbortController === 'function' ? new AbortController() : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'AbortError';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
