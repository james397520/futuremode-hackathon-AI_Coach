/**
 * Local reranking — spec §54.
 *
 *   Retrieved top 20  →  browser local reranker  →  Top 5
 *
 * AUTHORITY: **advisory.**
 *
 * > 正式金融/保險環境仍建議 server authoritative scoring.
 *
 * Read that as a hard requirement, not a suggestion. In a finance or insurance
 * deployment the ordering that reaches the trainee — and therefore the ordering
 * that ends up cited in a compliance report — must come from the server's own
 * reranker, because that is the one that is versioned, audited and reproducible.
 * A cross-encoder running in a browser is none of those things: the quantised
 * variant differs per device class, and a device-lost fallback would silently
 * change the ranking mid-session.
 *
 * So this module is a **latency optimisation for the UI**, and it is written to
 * make that impossible to forget:
 *   - `requireServerAuthority` (default in `rerankStrict`) refuses the local tier
 *     outright, which is what a regulated workspace should configure;
 *   - `RerankResult.authority` is `'advisory'` whenever `local` is true, and every
 *     hit carries `previous_rank` so the original server ordering can always be
 *     recovered and audited;
 *   - a low-memory device never gets a local reranker at all (the manifest registry
 *     does not offer one), because §54's "when performance allows" is a real
 *     condition, not a formality.
 */
import type {
  AuthorityLevel,
  RerankDocument,
  RerankResult,
  TaskOutcome,
  TaskRunner,
} from '../backends/types';

export const RERANK_AUTHORITY: AuthorityLevel = 'advisory';

/** §54: top 20 in. More than this is trimmed — a cross-encoder is O(n) sessions. */
export const MAX_RERANK_CANDIDATES = 20;
/** §54: top 5 out. */
export const DEFAULT_RERANK_TOP_K = 5;
/** Per-document text cap; the tokenizer truncates too. */
export const MAX_RERANK_DOC_CHARS = 4_000;

export interface RerankTaskOptions {
  topK?: number;
  /**
   * Regulated deployments set this. It forces the server tier, so no local
   * reordering can reach the trainee or a report.
   */
  requireServerAuthority?: boolean;
  localOnly?: boolean;
}

/**
 * Narrow a candidate list.
 *
 * Degenerate inputs resolve rather than fail: zero or one candidate needs no
 * model, so it short-circuits without touching a backend at all.
 */
export async function rerank(
  runner: TaskRunner,
  query: string,
  docs: readonly RerankDocument[],
  options: RerankTaskOptions = {},
): Promise<TaskOutcome<RerankResult>> {
  const topK = clampTopK(options.topK ?? DEFAULT_RERANK_TOP_K);
  const cleanQuery = typeof query === 'string' ? query.trim() : '';
  const candidates = sanitiseCandidates(docs);

  if (cleanQuery.length === 0 || candidates.length === 0) {
    return passthrough(candidates, topK);
  }
  if (candidates.length === 1) {
    // Nothing to reorder. Returning the identity ordering is both correct and
    // free, and avoids loading a 23 MB model to rank one document.
    return passthrough(candidates, topK);
  }

  return runner.runTask<RerankResult>(
    'reranking',
    async (backend) => {
      const result = await backend.rerank(cleanQuery, candidates, topK);
      return {
        ...result,
        // A local reorder is advisory; the server's is authoritative (§54).
        authority: backend.kind === 'server' ? 'authoritative' : RERANK_AUTHORITY,
        local: backend.kind !== 'server',
      };
    },
    {
      label: 'reranking',
      ...(options.requireServerAuthority ? { serverOnly: true } : {}),
      ...(options.localOnly && !options.requireServerAuthority ? { localOnly: true } : {}),
    },
  );
}

/**
 * The regulated-deployment entry point: identical behaviour, server tier only.
 * Prefer this in finance / insurance workspaces (§54).
 */
export async function rerankStrict(
  runner: TaskRunner,
  query: string,
  docs: readonly RerankDocument[],
  options: Omit<RerankTaskOptions, 'requireServerAuthority' | 'localOnly'> = {},
): Promise<TaskOutcome<RerankResult>> {
  return rerank(runner, query, docs, { ...options, requireServerAuthority: true });
}

/**
 * Is local reranking worth attempting on this device?
 *
 * §54 says "小型 cross-encoder 可在效能允許時" — when performance allows. A
 * low-memory device runs 20 cross-encoder pairs slower than the network round
 * trip, so the honest answer there is no.
 */
export function shouldRerankLocally(input: {
  memoryClass: 'low' | 'medium' | 'high';
  backend: 'webgpu' | 'wasm' | 'server';
  candidateCount: number;
}): boolean {
  if (input.backend === 'server') return false;
  if (input.memoryClass === 'low') return false;
  if (input.candidateCount > MAX_RERANK_CANDIDATES) return false;
  // The CPU tier only pays off for a short list.
  if (input.backend === 'wasm' && input.candidateCount > 10) return false;
  return true;
}

/**
 * Recover the pre-rerank ordering from a result. Kept as a first-class helper
 * because an auditor asking "what did retrieval actually return?" must always have
 * an answer, even after a local reorder (§54).
 */
export function originalOrder(result: RerankResult): string[] {
  return [...result.hits].sort((a, b) => a.previous_rank - b.previous_rank).map((h) => h.id);
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function clampTopK(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RERANK_TOP_K;
  return Math.max(1, Math.min(Math.floor(value), MAX_RERANK_CANDIDATES));
}

function sanitiseCandidates(docs: readonly RerankDocument[]): RerankDocument[] {
  if (!Array.isArray(docs)) return [];
  const seen = new Set<string>();
  const out: RerankDocument[] = [];
  for (const doc of docs) {
    if (!doc || typeof doc.id !== 'string' || doc.id.length === 0) continue;
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    out.push({
      id: doc.id,
      text: typeof doc.text === 'string' ? doc.text.slice(0, MAX_RERANK_DOC_CHARS) : '',
      ...(typeof doc.score === 'number' && Number.isFinite(doc.score)
        ? { score: doc.score }
        : {}),
    });
    if (out.length >= MAX_RERANK_CANDIDATES) break;
  }
  return out;
}

/** Identity ordering, reported honestly as not having been reranked. */
function passthrough(
  candidates: readonly RerankDocument[],
  topK: number,
): TaskOutcome<RerankResult> {
  return {
    ok: true,
    value: {
      hits: candidates.slice(0, topK).map((doc, index) => ({
        id: doc.id,
        score: doc.score ?? 0,
        rank: index,
        previous_rank: index,
      })),
      model_id: 'passthrough',
      backend: 'server',
      // No model ran, so nothing was decided locally.
      authority: 'authoritative',
      local: false,
    },
    backend: 'server',
    elapsed_ms: 0,
    degraded: false,
    attempts: [],
  };
}
