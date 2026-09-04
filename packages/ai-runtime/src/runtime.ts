/**
 * `createAiRuntime` — the single public façade the web app talks to.
 *
 * Contract, and the reason every method returns a `TaskOutcome` instead of
 * throwing (§51, §62):
 *
 *   **Every method succeeds through the server backend even if nothing local ever
 *   loads.** No WebGPU, no WASM, no worker, no Cache Storage, acceleration turned
 *   off by an admin, a device that lost its GPU mid-session — the call still
 *   resolves. There is no configuration in which a feature built on this façade
 *   stops working; only configurations in which it is slower or less private.
 *
 * Construction is SSR-safe: `createAiRuntime()` allocates plain objects, registers
 * no listeners, and touches no browser API. Nothing happens until the first
 * `detect()` / `warmup()` / task call, which the app makes from an effect.
 */
import type {
  ComputeBackend,
  ComputeCapability,
  LocalTask,
  RuntimePolicy,
  RuntimeState,
  RuntimeTelemetry,
} from '@ai-coach/shared-types';

import {
  DEFAULT_RUNTIME_POLICY,
  createRuntimeStateMachine,
  errorText,
  type DetailedComputeCapability,
  type EnterpriseWebgpuOverride,
  type RuntimeEvent,
  type RuntimeStateMachine,
} from './capability';
import { ModelCache, derivedMemoKey, type CacheStats } from './cache';
import { FallbackController, type FallbackNotification } from './fallback';
import { RuntimeLifecycle, type LifecyclePhase, type RuntimeLifecycleOptions } from './lifecycle';
import { createManifestRegistry, type ManifestRegistry, type ManifestRegistryOptions } from './manifest';
import {
  TelemetryCollector,
  createApiTelemetryReporter,
  type RuntimeTelemetryDetail,
  type TelemetryReporter,
} from './telemetry';
import type {
  EmbedResult,
  FallbackReason,
  IntentResult,
  LoadProgress,
  RerankDocument,
  RerankResult,
  SafetyResult,
  TaskOutcome,
  TaskRunner,
} from './backends/types';
import type { ServerBackendOptions } from './backends/server-backend';
import type { OrtLoadConfig } from './worker/protocol';
import type { WorkerHostOptions, WorkerStatus } from './worker/worker-host';
import { embedQuery, embedTexts, type EmbedTaskOptions, type EmbeddingMemo } from './tasks/embedding';
import { classifyIntent as classifyIntentTask, type IntentTaskOptions } from './tasks/intent-classification';
import { rerank as rerankTask, type RerankTaskOptions } from './tasks/reranking';
import { safetyPrecheckLocal } from './tasks/safety-precheck';

/* ------------------------------------------------------------------ *
 * Options and snapshot
 * ------------------------------------------------------------------ */

export interface AiRuntimeOptions {
  /** Partial policy merged over `DEFAULT_RUNTIME_POLICY` (§61). */
  policy?: Partial<RuntimePolicy>;
  /** §97: workspace admin may force `on` / `off` / `automatic`. */
  enterpriseOverride?: EnterpriseWebgpuOverride;
  /**
   * §97 consent gate. Defaults to `false`: the runtime works (through the server)
   * from the first call, and no model is downloaded until the user accepts the
   * "Local AI acceleration" prompt. An admin forcing `on` may pass `true`.
   */
  enableLocal?: boolean;

  /** API prefix for the server tier and telemetry. Empty means same-origin. */
  apiBaseUrl?: string;
  server?: Omit<ServerBackendOptions, 'baseUrl' | 'fetchImpl'>;
  fetchImpl?: typeof fetch;
  /** Auth headers, re-resolved per request. */
  authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;

  /** Where model files live. Defaults to `/models` — self-hosted, no vendor CDN. */
  modelBaseUrl?: string;
  modelMirrors?: readonly string[];
  manifests?: ManifestRegistryOptions;

  worker?: WorkerHostOptions;
  ort?: OrtLoadConfig;

  /** §60: inactivity before GPU resources are released. Default 120s. */
  idleTimeoutMs?: number;
  releaseOnHidden?: boolean;

  /** `false` disables reporting entirely; omit for the default API reporter. */
  telemetryReporter?: TelemetryReporter | false;
  telemetryEndpoint?: string;

  onFallback?: (notification: FallbackNotification) => void;
  onProgress?: (progress: LoadProgress) => void;
  onWarning?: (message: string) => void;
}

export interface RuntimeSnapshot {
  /** §92 state machine. The UI may only display these values. */
  state: RuntimeState;
  phase: LifecyclePhase;
  /** The `shared-types` contract shape. Null until `detect()` has run. */
  capability: ComputeCapability | null;
  /** Diagnostics for the admin runtime page (§93). */
  capabilityDetail: DetailedComputeCapability | null;
  /** The tier that answered most recently. */
  backend: ComputeBackend;
  chain: readonly ComputeBackend[];
  policy: RuntimePolicy;
  localEnabled: boolean;
  workerStatus: WorkerStatus;
  telemetry: RuntimeTelemetry;
  lastFallback: FallbackNotification | null;
  lastWarning: string | null;
}

export interface AiRuntime {
  /** Latest capability, or null before `detect()`. */
  readonly capability: ComputeCapability | null;
  readonly capabilityDetail: DetailedComputeCapability | null;
  readonly state: RuntimeState;
  readonly backend: ComputeBackend;
  readonly policy: RuntimePolicy;

  /** Subscribe to snapshot changes. Called immediately with the current value. */
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  snapshot(): RuntimeSnapshot;

  detect(): Promise<ComputeCapability>;

  embed(texts: readonly string[], options?: EmbedTaskOptions): Promise<TaskOutcome<EmbedResult>>;
  embedQuery(text: string, options?: EmbedTaskOptions): Promise<TaskOutcome<EmbedResult>>;
  classifyIntent(text: string, options?: IntentTaskOptions): Promise<TaskOutcome<IntentResult>>;
  rerank(
    query: string,
    docs: readonly RerankDocument[],
    options?: RerankTaskOptions,
  ): Promise<TaskOutcome<RerankResult>>;
  /** Never fails: the heuristic is pure JS and needs no model (§55). */
  safetyPrecheck(text: string): Promise<SafetyResult>;

  /** §60: preload + warm the sessions for these tasks. Resolves either way. */
  warmup(tasks?: readonly LocalTask[]): Promise<void>;
  /** §60: drop sessions and GPU resources now. Keeps cached weights. */
  release(): Promise<void>;

  telemetry(): RuntimeTelemetry;
  telemetryDetail(): RuntimeTelemetryDetail;

  setPolicy(policy: Partial<RuntimePolicy>): Promise<void>;
  /** §97 consent toggle. */
  setLocalEnabled(enabled: boolean): Promise<void>;

  /** §61 "Clear on logout" / admin "Clear local model cache". */
  clearCache(): Promise<void>;
  cacheStats(): Promise<CacheStats>;

  /** Clear fallback cooldowns and re-detect — the "Retry local AI" action. */
  retryLocal(): Promise<ComputeCapability>;

  /** Full teardown. Honours `clear_on_logout`. */
  dispose(): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Factory
 * ------------------------------------------------------------------ */

export function createAiRuntime(options: AiRuntimeOptions = {}): AiRuntime {
  const policy: RuntimePolicy = { ...DEFAULT_RUNTIME_POLICY, ...(options.policy ?? {}) };
  let enterpriseOverride = options.enterpriseOverride;

  const machine: RuntimeStateMachine = createRuntimeStateMachine('unknown');
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>();

  let lastFallback: FallbackNotification | null = null;
  let lastWarning: string | null = null;
  let currentPhase: LifecyclePhase = 'idle';
  let disposed = false;

  const warn = (message: string): void => {
    lastWarning = message;
    try {
      options.onWarning?.(message);
    } catch {
      /* ignore */
    }
    emit();
  };

  const telemetry = new TelemetryCollector({
    initialBackend: 'server',
    ...(options.telemetryReporter === false
      ? {}
      : {
          reporter:
            options.telemetryReporter ??
            createApiTelemetryReporter({
              ...(options.apiBaseUrl ? { baseUrl: options.apiBaseUrl } : {}),
              ...(options.telemetryEndpoint ? { endpoint: options.telemetryEndpoint } : {}),
              ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
              ...(options.authHeaders ? { headers: options.authHeaders } : {}),
              onError: (message) => warn(message),
            }),
        }),
  });

  const registry: ManifestRegistry = createManifestRegistry({
    ...(options.modelBaseUrl ? { baseUrl: options.modelBaseUrl } : {}),
    ...(options.modelMirrors ? { mirrors: options.modelMirrors } : {}),
    ...(options.manifests ?? {}),
  });

  const cache = new ModelCache({
    policy,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    onWarning: (message) => warn(message),
  });

  /**
   * The derived-embedding memo. Gated by `allow_sensitive_data_cache` inside
   * `ModelCache`, in-memory only, and never persisted (§61).
   */
  const memo: EmbeddingMemo = {
    recall: (key) => cache.recallDerived(key),
    remember: (key, vector) => cache.rememberDerived(key, vector),
    keyFor: (modelId, role, text) => derivedMemoKey(modelId, role, text),
  };

  const lifecycleOptions: RuntimeLifecycleOptions = {
    policy,
    ...(enterpriseOverride ? { enterpriseOverride } : {}),
    registry,
    cache,
    telemetry,
    enableLocal: options.enableLocal ?? false,
    ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
    ...(options.releaseOnHidden === undefined
      ? {}
      : { releaseOnHidden: options.releaseOnHidden }),
    ...(options.worker ? { worker: options.worker } : {}),
    ...(options.ort ? { ort: options.ort } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    server: {
      ...(options.server ?? {}),
      ...(options.apiBaseUrl ? { baseUrl: options.apiBaseUrl } : {}),
      ...(options.authHeaders ? { headers: options.authHeaders } : {}),
    },
    onState: (event: RuntimeEvent) => {
      machine.send(event);
      emit();
    },
    onPhase: (phase) => {
      currentPhase = phase;
      emit();
    },
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    onWarning: (message) => warn(message),
    onWorkerStatus: () => emit(),
  };

  const lifecycle = new RuntimeLifecycle(lifecycleOptions);

  const controller = new FallbackController({
    chain: ['server'],
    acquire: (tier, task) => lifecycle.acquire(tier, task),
    telemetry,
    onFallback: (notification) => {
      lastFallback = notification;
      // §92: a step-down that still has a local tier below it is `degraded`;
      // landing on the server floor is `fallback`.
      machine.send(notification.to === 'server' ? 'fallback' : 'degrade');
      try {
        options.onFallback?.(notification);
      } catch {
        /* ignore */
      }
      emit();
    },
    onTierChange: () => emit(),
    onWarning: (message) => warn(message),
  });

  const runner: TaskRunner = {
    runTask: (task, op, opts) => controller.runTask(task, op, opts),
  };

  /* -------------------- snapshot / subscription -------------------- */

  function snapshot(): RuntimeSnapshot {
    return {
      state: machine.state,
      phase: currentPhase,
      capability: lifecycle.capability ? lifecycle.computeCapability() : null,
      capabilityDetail: lifecycle.capability,
      backend: controller.currentBackend,
      chain: controller.activeChain,
      policy: { ...policy },
      localEnabled: lifecycle.localEnabled,
      workerStatus: lifecycle.workerStatus,
      telemetry: telemetry.snapshot(),
      lastFallback,
      lastWarning,
    };
  }

  function emit(): void {
    if (disposed) return;
    const value = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch {
        // A throwing subscriber (a React setState after unmount, say) must never
        // break the inference path.
      }
    }
  }

  // Keep the machine in step when telemetry changes the reported backend.
  const unsubscribeTelemetry = telemetry.subscribe(() => emit());

  /* -------------------- detect -------------------- */

  async function detect(): Promise<ComputeCapability> {
    const caps = await lifecycle.detect();
    controller.setChain(lifecycle.chain);
    telemetry.update({ backend: caps.selectedBackend });
    emit();
    return lifecycle.computeCapability();
  }

  /** Detection is idempotent and cached; every task path funnels through this. */
  async function ensureDetected(): Promise<void> {
    if (lifecycle.capability) return;
    try {
      await detect();
    } catch (error) {
      // `detect()` is written not to reject; this is pure belt and braces so a
      // task call can never fail because of detection.
      warn(`Capability detection failed: ${errorText(error)}`);
    }
  }

  /* -------------------- tasks -------------------- */

  async function embed(
    texts: readonly string[],
    taskOptions: EmbedTaskOptions = {},
  ): Promise<TaskOutcome<EmbedResult>> {
    await ensureDetected();
    const outcome = await embedTexts(runner, texts, { memo, ...taskOptions });
    recordOutcome(outcome);
    return outcome;
  }

  async function embedOne(
    text: string,
    taskOptions: EmbedTaskOptions = {},
  ): Promise<TaskOutcome<EmbedResult>> {
    await ensureDetected();
    const outcome = await embedQuery(runner, text, { memo, ...taskOptions });
    recordOutcome(outcome);
    return outcome;
  }

  async function classifyIntent(
    text: string,
    taskOptions: IntentTaskOptions = {},
  ): Promise<TaskOutcome<IntentResult>> {
    await ensureDetected();
    const outcome = await classifyIntentTask(runner, text, taskOptions);
    recordOutcome(outcome);
    return outcome;
  }

  async function rerank(
    query: string,
    docs: readonly RerankDocument[],
    taskOptions: RerankTaskOptions = {},
  ): Promise<TaskOutcome<RerankResult>> {
    await ensureDetected();
    const outcome = await rerankTask(runner, query, docs, taskOptions);
    recordOutcome(outcome);
    return outcome;
  }

  /**
   * Safety pre-check runs synchronously in place — no worker hop, no network, no
   * model (§55). It therefore cannot fail, which is why it returns the result
   * directly instead of a `TaskOutcome`.
   */
  async function safetyPrecheck(text: string): Promise<SafetyResult> {
    const started = nowMs();
    const result = safetyPrecheckLocal(text, controller.currentBackend);
    telemetry.recordInference({ backend: controller.currentBackend, ms: nowMs() - started });
    return result;
  }

  function recordOutcome(outcome: TaskOutcome<unknown>): void {
    telemetry.recordInference({ backend: outcome.backend, ms: outcome.elapsed_ms });
    if (!outcome.ok) {
      const reason: FallbackReason = outcome.error.reason;
      telemetry.update({ fallback_reason: `${reason}: ${outcome.error.message}` });
    }
    lifecycle.touch();
    emit();
  }

  /* -------------------- lifecycle controls -------------------- */

  const WARMUP_DEFAULT: readonly LocalTask[] = ['embedding', 'intent_classification'];

  /**
   * §96: this is the "Persona / Simulation page preload" hook. Resolves whatever
   * happens — a warmup failure is a step-down, not an error the page must handle.
   */
  async function warmup(tasks: readonly LocalTask[] = WARMUP_DEFAULT): Promise<void> {
    await ensureDetected();
    if (!lifecycle.localEnabled) return;
    const chain = controller.activeChain.filter((tier) => tier !== 'server');
    if (chain.length === 0) return;

    for (const task of tasks) {
      if (task === 'safety_precheck') continue; // no model to warm
      const outcome = await controller.runTask(
        task,
        async () => true,
        { label: `warmup:${task}`, localOnly: true },
      );
      if (!outcome.ok) {
        // Expected on a device that cannot run this model; the tier is already
        // cooling down and the server floor will serve the real calls.
        warn(`Local warmup for "${task}" did not complete: ${outcome.error.message}`);
      }
    }
    emit();
  }

  async function release(): Promise<void> {
    await lifecycle.releaseIdle();
    emit();
  }

  async function setPolicy(next: Partial<RuntimePolicy>): Promise<void> {
    Object.assign(policy, next);
    cache.setPolicy(policy);
    await lifecycle.setPolicy({ ...policy }, enterpriseOverride);
    controller.setChain(lifecycle.chain);
    controller.resetCooldowns();
    emit();
  }

  async function setLocalEnabled(enabled: boolean): Promise<void> {
    await lifecycle.setLocalEnabled(enabled);
    controller.setChain(lifecycle.chain);
    controller.resetCooldowns();
    emit();
  }

  async function retryLocal(): Promise<ComputeCapability> {
    controller.resetCooldowns();
    // Force a fresh probe: the user may have enabled the browser flag, or plugged
    // in an external GPU.
    machine.send('detect');
    await lifecycle.setPolicy({ ...policy }, enterpriseOverride);
    const caps = await detect();
    return caps;
  }

  async function clearCache(): Promise<void> {
    await cache.clearAll();
    emit();
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    await telemetry.flush();
    await lifecycle.dispose();
    unsubscribeTelemetry();
    telemetry.dispose();
    disposed = true;
    listeners.clear();
  }

  return {
    get capability() {
      return lifecycle.capability ? lifecycle.computeCapability() : null;
    },
    get capabilityDetail() {
      return lifecycle.capability;
    },
    get state() {
      return machine.state;
    },
    get backend() {
      return controller.currentBackend;
    },
    get policy() {
      return { ...policy };
    },

    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(snapshot());
      } catch {
        /* ignore */
      }
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,

    detect,
    embed,
    embedQuery: embedOne,
    classifyIntent,
    rerank,
    safetyPrecheck,
    warmup,
    release,

    telemetry: () => telemetry.snapshot(),
    telemetryDetail: () => telemetry.detail(),

    setPolicy,
    setLocalEnabled,
    clearCache,
    cacheStats: () => cache.stats(),
    retryLocal,
    dispose,
  };
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
