/**
 * The fallback controller — spec §62.
 *
 * > 若 WebGPU unavailable / device lost / memory exceeded / unsupported operator /
 * > timeout → 自動 WebGPU → WASM → Server。UI 不可 crash。
 *
 * This is the component that makes that sentence true. Three guarantees:
 *
 * 1. **The caller's promise always settles.** `runTask` returns a `TaskOutcome`
 *    discriminated union and never rejects. A total failure is `{ ok: false }`
 *    with a reason, which the UI renders as a message — it cannot become an
 *    unhandled rejection or a thrown error inside a React render.
 * 2. **Retries are bounded.** Each tier gets at most `maxAttemptsPerTier`
 *    attempts, and a *fatal* failure (device lost, unsupported operator, memory
 *    exceeded) puts that tier in a cooldown so a hot loop cannot re-enter it. The
 *    chain is walked forwards only; there is no path that revisits a tier within
 *    one call.
 * 3. **Stepping down is visible.** Every transition emits a `runtime.fallback`
 *    notification with a human-readable reason (§62 + §93 admin detail) and is
 *    recorded in telemetry.
 */
import type { ComputeBackend, LocalTask } from '@ai-coach/shared';

import { errorText } from './capability';
import {
  BackendFailure,
  describeFallbackReason,
  type FallbackReason,
  type InferenceBackend,
  type TaskOutcome,
  type TaskRunner,
} from './backends/types';
import type { TelemetryCollector } from './telemetry';

/** The notification shape the app publishes on its notification bus (§81). */
export interface FallbackNotification {
  type: 'runtime.fallback';
  from: ComputeBackend;
  to: ComputeBackend;
  reason: FallbackReason;
  /** Safe to show to any user; contains no engineering jargon and no user data. */
  message: string;
  task: LocalTask;
  at: string;
}

export interface FallbackControllerOptions {
  /** Tier order. Must end in 'server'; the controller enforces it. */
  chain: readonly ComputeBackend[];
  /**
   * Produce a backend that is ready to serve `task` on `tier`, or throw a
   * `BackendFailure`. This is where model loading happens (see `lifecycle.ts`).
   */
  acquire: (tier: ComputeBackend, task: LocalTask) => Promise<InferenceBackend>;
  onFallback?: (notification: FallbackNotification) => void;
  /** Fired when the effective tier changes, so the state machine can follow. */
  onTierChange?: (tier: ComputeBackend, previous: ComputeBackend) => void;
  telemetry?: TelemetryCollector;
  /** Attempts per tier, including the first. Defaults to 2 (one retry). */
  maxAttemptsPerTier?: number;
  /** How long a fatally failed tier stays out of the chain. Defaults to 5 min. */
  cooldownMs?: number;
  onWarning?: (message: string) => void;
  now?: () => number;
}

interface Cooldown {
  until: number;
  reason: FallbackReason;
  message: string;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_COOLDOWN_MS = 5 * 60_000;

/** Failures that mean "retrying this tier right now is pointless". */
const NEVER_RETRY_IN_TIER: readonly FallbackReason[] = [
  'webgpu_unavailable',
  'adapter_request_failed',
  'device_lost',
  'memory_exceeded',
  'unsupported_operator',
  'worker_unavailable',
  'model_unavailable',
  'integrity_mismatch',
  'policy_off',
  'not_supported_for_task',
  'load_failed',
];

export class FallbackController implements TaskRunner {
  private chain: ComputeBackend[];
  private readonly options: FallbackControllerOptions;
  private readonly cooldowns = new Map<ComputeBackend, Cooldown>();
  private tier: ComputeBackend;

  constructor(options: FallbackControllerOptions) {
    this.options = options;
    this.chain = normaliseChain(options.chain);
    this.tier = this.chain[0] ?? 'server';
  }

  /** The tier that answered most recently. */
  get currentBackend(): ComputeBackend {
    return this.tier;
  }

  get activeChain(): readonly ComputeBackend[] {
    return [...this.chain];
  }

  /** Replace the chain (after a re-detect, or a policy change). */
  setChain(chain: readonly ComputeBackend[]): void {
    this.chain = normaliseChain(chain);
    const head = this.chain[0] ?? 'server';
    if (!this.chain.includes(this.tier)) this.tier = head;
  }

  /** Clear cooldowns — the admin "Retry local acceleration" action. */
  resetCooldowns(): void {
    this.cooldowns.clear();
    this.tier = this.chain[0] ?? 'server';
  }

  /** Why a tier is currently skipped, for the admin runtime page (§93). */
  cooldownFor(tier: ComputeBackend): { reason: FallbackReason; message: string } | null {
    const entry = this.cooldowns.get(tier);
    if (!entry) return null;
    if (this.now() >= entry.until) {
      this.cooldowns.delete(tier);
      return null;
    }
    return { reason: entry.reason, message: entry.message };
  }

  /**
   * Run `op` on the best available tier, stepping down on failure.
   *
   * Termination argument: `candidates` is a finite list, each entry is attempted
   * at most `maxAttemptsPerTier` times, and nothing is ever pushed back onto the
   * list. The loop therefore runs at most `chain.length * maxAttemptsPerTier`
   * times and then returns — there is no code path that loops indefinitely.
   */
  async runTask<T>(
    task: LocalTask,
    op: (backend: InferenceBackend) => Promise<T>,
    options: { label?: string; localOnly?: boolean; serverOnly?: boolean } = {},
  ): Promise<TaskOutcome<T>> {
    const started = this.now();
    const attempts: Array<{ backend: ComputeBackend; reason: FallbackReason }> = [];

    let candidates = this.chain.filter((tier) => this.cooldownFor(tier) === null);
    if (candidates.length === 0) {
      // Everything is cooling down. The server floor is never allowed to be
      // unavailable, so put it back regardless.
      candidates = ['server'];
    }
    if (options.serverOnly) candidates = ['server'];
    else if (options.localOnly) candidates = candidates.filter((tier) => tier !== 'server');

    if (candidates.length === 0) {
      return {
        ok: false,
        error: {
          reason: 'not_supported_for_task',
          message: 'No local execution tier is available for this task.',
        },
        backend: this.tier,
        elapsed_ms: Math.round(this.now() - started),
        degraded: true,
        attempts,
      };
    }

    const maxAttempts = Math.max(1, this.options.maxAttemptsPerTier ?? DEFAULT_MAX_ATTEMPTS);
    const startTier = candidates[0] ?? 'server';
    let lastFailure: BackendFailure | null = null;

    for (let index = 0; index < candidates.length; index += 1) {
      const tier = candidates[index];
      if (!tier) continue;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const backend = await this.options.acquire(tier, task);
          const value = await op(backend);
          this.promoteTier(tier);
          return {
            ok: true,
            value,
            backend: tier,
            elapsed_ms: Math.round(this.now() - started),
            degraded: tier !== startTier || attempts.length > 0,
            ...(attempts.length > 0 && attempts[attempts.length - 1]
              ? { fallback_reason: attempts[attempts.length - 1]?.reason }
              : {}),
            attempts,
          };
        } catch (error) {
          const failure = this.toFailure(error, tier, task);
          lastFailure = failure;

          const retryable =
            !failure.fatal &&
            !NEVER_RETRY_IN_TIER.includes(failure.reason) &&
            attempt + 1 < maxAttempts;

          if (retryable) {
            // One bounded retry inside the same tier, for genuinely transient
            // problems (a single timeout, a flaky response).
            continue;
          }

          attempts.push({ backend: tier, reason: failure.reason });
          if (failure.fatal || NEVER_RETRY_IN_TIER.includes(failure.reason)) {
            this.enterCooldown(tier, failure);
          }

          const next = candidates[index + 1];
          if (next) {
            this.stepDown(tier, next, failure, task);
          }
          break; // move to the next tier
        }
      }
    }

    // Every tier, including the server, failed. The promise still resolves — that
    // is the §62 "UI must not crash" contract expressed in the type system.
    const reason = lastFailure?.reason ?? 'inference_failed';
    const message = lastFailure ? lastFailure.message : describeFallbackReason(reason);
    this.options.onWarning?.(`Runtime task "${options.label ?? task}" failed: ${message}`);
    return {
      ok: false,
      error: { reason, message },
      backend: this.tier,
      elapsed_ms: Math.round(this.now() - started),
      degraded: true,
      fallback_reason: reason,
      attempts,
    };
  }

  private toFailure(error: unknown, tier: ComputeBackend, task: LocalTask): BackendFailure {
    if (error instanceof BackendFailure) return error;
    if (BackendFailure.is(error)) {
      // A structured-clone copy that crossed the worker boundary.
      return new BackendFailure({
        reason: error.reason,
        backend: error.backend ?? tier,
        fatal: Boolean(error.fatal),
        task,
        message: error.message,
      });
    }
    return new BackendFailure({
      reason: 'inference_failed',
      backend: tier,
      task,
      message: errorText(error),
      cause: error,
    });
  }

  private enterCooldown(tier: ComputeBackend, failure: BackendFailure): void {
    // The server floor is never cooled down: there is nowhere below it.
    if (tier === 'server') return;
    this.cooldowns.set(tier, {
      until: this.now() + (this.options.cooldownMs ?? DEFAULT_COOLDOWN_MS),
      reason: failure.reason,
      message: failure.message,
    });
  }

  private stepDown(
    from: ComputeBackend,
    to: ComputeBackend,
    failure: BackendFailure,
    task: LocalTask,
  ): void {
    const notification: FallbackNotification = {
      type: 'runtime.fallback',
      from,
      to,
      reason: failure.reason,
      // Two sentences: what happened (in plain language), and the reassurance
      // that the feature still works. §62: the UI must not look broken.
      message: `${describeFallbackReason(failure.reason)} ${describeDestination(to)}`,
      task,
      at: new Date().toISOString(),
    };
    try {
      this.options.onFallback?.(notification);
    } catch {
      /* a broken notification sink must not break the inference path */
    }
    try {
      this.options.telemetry?.recordFallback({
        from,
        to,
        reason: failure.reason,
        message: failure.message,
      });
    } catch {
      /* ignore */
    }
    this.promoteTier(to);
  }

  private promoteTier(tier: ComputeBackend): void {
    if (this.tier === tier) return;
    const previous = this.tier;
    this.tier = tier;
    try {
      this.options.onTierChange?.(tier, previous);
    } catch {
      /* ignore */
    }
  }

  private now(): number {
    const impl = this.options.now;
    if (impl) {
      try {
        return impl();
      } catch {
        /* fall through */
      }
    }
    try {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
    } catch {
      /* ignore */
    }
    return Date.now();
  }
}

function describeDestination(tier: ComputeBackend): string {
  switch (tier) {
    case 'webgpu':
      return 'Switched to GPU acceleration.';
    case 'wasm':
      return 'Switched to on-device CPU processing; results are unchanged, just slower.';
    case 'server':
      return 'Switched to server processing; the feature continues to work normally.';
    default:
      return 'Switched to another processing tier.';
  }
}

/**
 * Deduplicate, keep the canonical webgpu → wasm → server order, and guarantee the
 * chain terminates at the server floor. A chain that did not end in 'server' would
 * be able to fail with nowhere to go, which §51 forbids.
 */
function normaliseChain(chain: readonly ComputeBackend[]): ComputeBackend[] {
  const order: ComputeBackend[] = ['webgpu', 'wasm', 'server'];
  const seen = new Set<ComputeBackend>();
  const out: ComputeBackend[] = [];
  for (const tier of chain) {
    if (!order.includes(tier)) continue;
    if (seen.has(tier)) continue;
    seen.add(tier);
    out.push(tier);
  }
  if (!seen.has('server')) out.push('server');
  return out;
}
