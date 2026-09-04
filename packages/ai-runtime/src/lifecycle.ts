/**
 * The model lifecycle — spec §60.
 *
 *   Detect → Select backend → Download manifest → Cache model → Warmup
 *         → Inference → Idle timeout → Release GPU resources
 *
 * The last two steps are the ones that are easy to skip and expensive to omit:
 * a page that holds a `GPUDevice` and a loaded session forever keeps GPU memory
 * allocated for as long as the tab is open, which on a shared enterprise laptop
 * shows up as everything else getting slower. So this class runs an idle timer, and
 * releases on `visibilitychange` / `pagehide` too — a backgrounded tab has no
 * business holding the GPU.
 *
 * SSR-safe: the constructor registers nothing and touches no browser API. Listeners
 * are attached on the first `ensureReady()`, which only ever runs in the browser.
 */
import type { ComputeBackend, LocalTask, RuntimePolicy } from '@ai-coach/shared-types';

import {
  DEFAULT_RUNTIME_POLICY,
  detectCapability,
  errorText,
  hasNavigator,
  isBrowser,
  selectBackend,
  serverOnlyCapability,
  toComputeCapability,
  type DetailedComputeCapability,
  type EnterpriseWebgpuOverride,
  type RuntimeEvent,
} from './capability';
import { ModelCache } from './cache';
import { MODEL_FREE_TASKS, createManifestRegistry, type ManifestRegistry } from './manifest';
import {
  BackendFailure,
  type InferenceBackend,
  type LoadProgress,
  type ResolvedManifest,
} from './backends/types';
import { ServerBackend, type ServerBackendOptions } from './backends/server-backend';
import type { OrtLoadConfig } from './worker/protocol';
import { WorkerHost, type WorkerHostOptions, type WorkerStatus } from './worker/worker-host';
import { WorkerBackend, type ModelFileBytes } from './worker/worker-backend';
import type { TelemetryCollector } from './telemetry';

export type LifecyclePhase =
  | 'idle'
  | 'detecting'
  | 'selecting'
  | 'downloading'
  | 'warming'
  | 'ready'
  | 'releasing';

export interface RuntimeLifecycleOptions {
  policy?: RuntimePolicy;
  enterpriseOverride?: EnterpriseWebgpuOverride;
  registry?: ManifestRegistry;
  cache?: ModelCache;
  telemetry?: TelemetryCollector;
  server?: ServerBackendOptions;
  worker?: WorkerHostOptions;
  ort?: OrtLoadConfig;
  /**
   * §97 consent gate. Local acceleration stays off until the user (or an admin
   * forcing `on`) enables it, so no model is downloaded behind their back.
   */
  enableLocal?: boolean;
  /** Milliseconds of inactivity before GPU resources are released. Default 120s. */
  idleTimeoutMs?: number;
  /** Release when the tab is hidden. Default true. */
  releaseOnHidden?: boolean;
  onState?: (event: RuntimeEvent) => void;
  onPhase?: (phase: LifecyclePhase) => void;
  onProgress?: (progress: LoadProgress) => void;
  onWarning?: (message: string) => void;
  onWorkerStatus?: (status: WorkerStatus) => void;
  fetchImpl?: typeof fetch;
  modelBaseUrl?: string;
  modelMirrors?: readonly string[];
}

const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

export class RuntimeLifecycle {
  private policy: RuntimePolicy;
  private override: EnterpriseWebgpuOverride;
  private enableLocal: boolean;

  private readonly options: RuntimeLifecycleOptions;
  private readonly registry: ManifestRegistry;
  private readonly cache: ModelCache;
  private readonly server: ServerBackend;

  private host: WorkerHost | null = null;
  private readonly localBackends = new Map<ComputeBackend, WorkerBackend>();

  private capabilityValue: DetailedComputeCapability | null = null;
  private detectPromise: Promise<DetailedComputeCapability> | null = null;
  private chainValue: readonly ComputeBackend[] = ['server'];

  private phaseValue: LifecyclePhase = 'idle';
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private listenersAttached = false;
  private disposed = false;

  constructor(options: RuntimeLifecycleOptions = {}) {
    this.options = options;
    this.policy = options.policy ?? DEFAULT_RUNTIME_POLICY;
    this.override = options.enterpriseOverride;
    this.enableLocal = options.enableLocal ?? true;
    this.registry =
      options.registry ??
      createManifestRegistry({
        ...(options.modelBaseUrl ? { baseUrl: options.modelBaseUrl } : {}),
        ...(options.modelMirrors ? { mirrors: options.modelMirrors } : {}),
      });
    this.cache =
      options.cache ??
      new ModelCache({
        policy: this.policy,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        onWarning: (message) => this.warn(message),
      });
    this.server = new ServerBackend({
      ...(options.server ?? {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  /* -------------------- accessors -------------------- */

  get phase(): LifecyclePhase {
    return this.phaseValue;
  }

  get capability(): DetailedComputeCapability | null {
    return this.capabilityValue;
  }

  get chain(): readonly ComputeBackend[] {
    return this.chainValue;
  }

  get serverBackend(): ServerBackend {
    return this.server;
  }

  get modelCache(): ModelCache {
    return this.cache;
  }

  get manifests(): ManifestRegistry {
    return this.registry;
  }

  get workerStatus(): WorkerStatus {
    return this.host?.status ?? 'idle';
  }

  /* -------------------- policy -------------------- */

  /**
   * Apply a new policy. Turning acceleration off takes effect immediately: local
   * sessions are released, the chain collapses to `['server']`, and (if the cache
   * switch also went off) the cached weights are deleted.
   */
  async setPolicy(policy: RuntimePolicy, override?: EnterpriseWebgpuOverride): Promise<void> {
    const previous = this.policy;
    this.policy = policy;
    if (override !== undefined) this.override = override;
    this.cache.setPolicy(policy);

    const nowOff = policy.webgpu === 'off' || this.override === 'off';
    const wasOff = previous.webgpu === 'off';
    if (nowOff && !wasOff) {
      await this.releaseLocal('policy_off');
      this.chainValue = ['server'];
      this.emitState('fallback');
      return;
    }
    if (!nowOff && wasOff) {
      // Re-detect: the device may support acceleration that policy was hiding.
      this.capabilityValue = null;
      this.detectPromise = null;
      await this.detect();
    }
  }

  /** §97 first-run consent. `false` releases anything already loaded. */
  async setLocalEnabled(enabled: boolean): Promise<void> {
    if (this.enableLocal === enabled) return;
    this.enableLocal = enabled;
    if (!enabled) {
      await this.releaseLocal('policy_off');
      this.chainValue = ['server'];
      this.emitState('fallback');
    } else {
      this.capabilityValue = null;
      this.detectPromise = null;
      await this.detect();
    }
  }

  get localEnabled(): boolean {
    return this.enableLocal;
  }

  /* -------------------- step 1: detect -------------------- */

  /**
   * Detect once and cache the result. Concurrent callers share the same promise so
   * two features mounting at the same time do not both request a GPU adapter.
   */
  async detect(): Promise<DetailedComputeCapability> {
    if (this.capabilityValue) return this.capabilityValue;
    if (this.detectPromise) return this.detectPromise;

    this.setPhase('detecting');
    this.emitState('detect');

    this.detectPromise = (async () => {
      if (!isBrowser() && !hasNavigator()) {
        // SSR: report the server tier without touching anything.
        const caps = serverOnlyCapability();
        this.capabilityValue = caps;
        this.chainValue = ['server'];
        this.setPhase('idle');
        this.emitState('detected_server_only');
        return caps;
      }

      const caps = await detectCapability({
        policy: this.policy,
        ...(this.override ? { enterpriseOverride: this.override } : {}),
      });

      // Step 2: select the backend chain.
      this.setPhase('selecting');
      const selection = selectBackend(
        {
          webgpu: caps.webgpu,
          wasmSimd: caps.wasmSimd,
          worker: caps.worker,
          memoryClass: caps.memoryClass,
          softwareAdapter: caps.softwareAdapter,
        },
        this.policy,
        this.override,
      );

      const effective: DetailedComputeCapability = this.enableLocal
        ? { ...caps, selectedBackend: selection.backend }
        : {
            // Consent not given (§97): report the device honestly, but select the
            // server tier so nothing is downloaded.
            ...caps,
            selectedBackend: 'server',
            webgpuUnavailableReason: 'Local acceleration has not been enabled for this device.',
          };

      this.capabilityValue = effective;
      this.chainValue = this.enableLocal ? selection.chain : ['server'];

      this.options.telemetry?.update({ backend: effective.selectedBackend });

      if (effective.selectedBackend === 'server') this.emitState('detected_server_only');
      else this.emitState('detected_local');

      this.setPhase('idle');
      return effective;
    })().catch((error: unknown) => {
      // Detection is written not to reject, but a policy hook could still throw.
      this.warn(`Capability detection failed: ${errorText(error)}`);
      const caps = serverOnlyCapability();
      this.capabilityValue = caps;
      this.chainValue = ['server'];
      this.setPhase('idle');
      this.emitState('detected_server_only');
      return caps;
    });

    try {
      return await this.detectPromise;
    } finally {
      this.detectPromise = null;
    }
  }

  /** The `shared-types` contract shape, for the UI. */
  computeCapability(): ReturnType<typeof toComputeCapability> {
    return toComputeCapability(this.capabilityValue ?? serverOnlyCapability());
  }

  /* -------------------- steps 3–5: manifest, cache, warmup -------------------- */

  /**
   * Return a backend that is ready to serve `task` on `tier`.
   *
   * This is the `acquire` hook the `FallbackController` calls. It throws typed
   * `BackendFailure`s, which is precisely how the controller learns to step down.
   */
  async acquire(tier: ComputeBackend, task: LocalTask): Promise<InferenceBackend> {
    this.touch();

    if (tier === 'server') return this.server;

    if (!this.enableLocal) {
      throw new BackendFailure({
        reason: 'policy_off',
        backend: tier,
        task,
        fatal: true,
        message: 'Local acceleration has not been enabled on this device.',
      });
    }
    if (this.policy.webgpu === 'off' || this.override === 'off') {
      throw new BackendFailure({
        reason: 'policy_off',
        backend: tier,
        task,
        fatal: true,
        message: 'Local acceleration is disabled by policy.',
      });
    }

    // §55 has no model, so it never needs a session; any tier can serve it.
    const backend = await this.ensureLocalBackend(tier);
    if (MODEL_FREE_TASKS.includes(task)) return backend;

    if (backend.isReady(task)) return backend;

    const manifest = this.resolveManifest(task);
    if (!manifest) {
      throw new BackendFailure({
        reason: 'not_supported_for_task',
        backend: tier,
        task,
        fatal: true,
        message: `No local model is registered for "${task}" on a ${
          this.capabilityValue?.memoryClass ?? 'medium'
        }-memory device.`,
      });
    }

    await this.guardQuota(manifest, tier, task);

    this.setPhase('downloading');
    this.emitState('load');
    try {
      // Steps 3–5 happen inside `WorkerBackend.load`: download (through the
      // cache), transfer, create the session, warm it up.
      await backend.load(manifest, (progress) => {
        if (progress.phase === 'warmup') this.setPhase('warming');
        this.options.onProgress?.(progress);
      });
      this.setPhase('ready');
      this.emitState('loaded');
      return backend;
    } catch (error) {
      this.setPhase('idle');
      throw error;
    }
  }

  private resolveManifest(task: LocalTask): ResolvedManifest | null {
    const memoryClass = this.capabilityValue?.memoryClass ?? 'medium';
    return this.registry.resolve(task, memoryClass);
  }

  /**
   * Refuse a download that plainly will not fit. Better a clean step-down to the
   * server than a half-written cache entry and a `QuotaExceededError` mid-load.
   */
  private async guardQuota(
    manifest: ResolvedManifest,
    tier: ComputeBackend,
    task: LocalTask,
  ): Promise<void> {
    if (!this.cache.persistenceEnabled) return; // streaming; nothing is stored
    const room = await this.cache.hasRoomFor(manifest.hints.approxDownloadBytes);
    if (room) return;
    throw new BackendFailure({
      reason: 'memory_exceeded',
      backend: tier,
      task,
      fatal: true,
      message: 'There is not enough local storage for the on-device model.',
    });
  }

  private async ensureLocalBackend(tier: ComputeBackend): Promise<WorkerBackend> {
    const existing = this.localBackends.get(tier);
    if (existing) return existing;

    if (tier !== 'webgpu' && tier !== 'wasm') {
      throw new BackendFailure({
        reason: 'not_supported_for_task',
        backend: tier,
        fatal: true,
        message: `"${tier}" is not a local execution tier.`,
      });
    }

    const host = this.ensureHost();
    // Starting the worker is what surfaces `worker_unavailable`.
    await host.start();

    const backend = new WorkerBackend({
      kind: tier,
      host,
      fetchFiles: (manifest, onProgress) => this.fetchModelFiles(manifest, onProgress),
      ...(this.options.ort ? { ort: this.options.ort } : {}),
      ...(this.options.onProgress ? { onProgress: this.options.onProgress } : {}),
      onLoaded: (info) => {
        this.options.telemetry?.recordLoad({
          backend: tier,
          model_id: info.model_id,
          load_ms: info.load_ms,
        });
      },
    });
    this.localBackends.set(tier, backend);
    this.attachVisibilityListeners();
    return backend;
  }

  private ensureHost(): WorkerHost {
    if (this.host) return this.host;
    this.host = new WorkerHost({
      ...(this.options.worker ?? {}),
      onStatus: (status) => {
        this.options.telemetry?.recordWorker(status);
        try {
          this.options.onWorkerStatus?.(status);
        } catch {
          /* ignore */
        }
        try {
          this.options.worker?.onStatus?.(status);
        } catch {
          /* ignore */
        }
      },
      onCrash: (message) => {
        // Every loaded session died with the worker; forget them so the next
        // acquire re-loads rather than inferring against a dead session.
        for (const backend of this.localBackends.values()) void backend.release();
        this.localBackends.clear();
        this.warn(`The inference worker crashed: ${message}`);
        this.emitState('degrade');
        try {
          this.options.worker?.onCrash?.(message);
        } catch {
          /* ignore */
        }
      },
      onWarning: (message) => this.warn(message),
    });
    return this.host;
  }

  /**
   * Step 3 + 4: resolve every manifest file through the cache, reporting combined
   * progress. Integrity checking lives in `ModelCache`.
   */
  private async fetchModelFiles(
    manifest: ResolvedManifest,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<ModelFileBytes[]> {
    const total = manifest.files.reduce((sum, f) => sum + (f.bytes || 0), 0);
    const perFile = new Map<string, number>();
    const out: ModelFileBytes[] = [];

    for (const file of manifest.files) {
      const bytes = await this.cache.fetchFile(manifest, file, {
        mirrors: this.registry.mirrorsFor(manifest, file.url).slice(1),
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        onProgress: (loaded) => {
          perFile.set(file.url, loaded);
          let sum = 0;
          for (const value of perFile.values()) sum += value;
          onProgress?.(sum, total);
        },
      });
      out.push({ name: basename(file.url), url: file.url, bytes });
    }
    return out;
  }

  /* -------------------- steps 7–8: idle timeout, release -------------------- */

  /** Mark activity. Restarts the idle countdown. */
  touch(): void {
    if (this.disposed) return;
    const timeout = this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    if (timeout <= 0) return; // idle release disabled
    if (this.localBackends.size === 0) return; // nothing holds the GPU
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.releaseIdle();
    }, timeout);
    const handle = this.idleTimer as unknown as { unref?: () => void };
    if (typeof handle.unref === 'function') handle.unref();
  }

  /**
   * §60 "Idle timeout → Release GPU resources".
   *
   * Sessions and the `GPUDevice` are dropped; the *capability* result and the
   * downloaded weights are kept, so the next call re-loads from cache in a
   * fraction of the original time and does not re-probe the adapter.
   */
  async releaseIdle(): Promise<void> {
    if (this.localBackends.size === 0) return;
    this.setPhase('releasing');
    for (const backend of this.localBackends.values()) {
      try {
        await backend.release();
      } catch (error) {
        this.warn(`Releasing local resources failed: ${errorText(error)}`);
      }
    }
    this.localBackends.clear();
    this.setPhase('idle');
    // Back to 'supported': the device can still do it, nothing is loaded.
    this.emitState('release');
  }

  private async releaseLocal(_reason: string): Promise<void> {
    void _reason;
    await this.releaseIdle();
    const host = this.host;
    this.host = null;
    if (host) await host.dispose();
  }

  /** Full teardown. Also used by "clear on logout" (§61). */
  async dispose(options: { clearCache?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.detachVisibilityListeners();
    await this.releaseLocal('dispose');
    if (options.clearCache || this.policy.clear_on_logout) {
      await this.cache.clearAll();
    }
  }

  /* -------------------- tab visibility -------------------- */

  private readonly onVisibilityChange = (): void => {
    try {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') {
        // A background tab holding a GPU device is pure waste.
        void this.releaseIdle();
      }
    } catch {
      /* ignore */
    }
  };

  private readonly onPageHide = (): void => {
    void this.releaseIdle();
  };

  private attachVisibilityListeners(): void {
    if (this.listenersAttached) return;
    if (this.options.releaseOnHidden === false) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    try {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('pagehide', this.onPageHide);
      this.listenersAttached = true;
    } catch {
      /* ignore */
    }
  }

  private detachVisibilityListeners(): void {
    if (!this.listenersAttached) return;
    this.listenersAttached = false;
    try {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('pagehide', this.onPageHide);
    } catch {
      /* ignore */
    }
  }

  /* -------------------- helpers -------------------- */

  private setPhase(phase: LifecyclePhase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    try {
      this.options.onPhase?.(phase);
    } catch {
      /* ignore */
    }
  }

  private emitState(event: RuntimeEvent): void {
    try {
      this.options.onState?.(event);
    } catch {
      /* ignore */
    }
  }

  private warn(message: string): void {
    try {
      this.options.onWarning?.(message);
    } catch {
      /* ignore */
    }
  }
}

function basename(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  const tail = withoutQuery.split('/').pop();
  return tail && tail.length > 0 ? tail : url;
}
