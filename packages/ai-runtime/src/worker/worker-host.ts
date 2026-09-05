/**
 * The main-thread side of the worker — spec §58, §62, §96.
 *
 * Responsibilities: spawn the worker, correlate one promise per request, time every
 * request out, and restart the worker (a bounded number of times) if it dies.
 *
 * ---------------------------------------------------------------------------
 * How the worker is spawned, and the tradeoff
 * ---------------------------------------------------------------------------
 * The obvious spelling is
 *
 *     new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })
 *
 * which is *correct* but couples this package to the consumer's bundler: Next.js
 * only emits a worker chunk for that pattern under specific webpack/turbopack
 * settings, and a monorepo package published as raw TypeScript (this one is —
 * `main` points at `src/index.ts`) has no build step of its own to produce the
 * chunk. A package that silently needs `next.config.js` changes is a package that
 * breaks the app it is dropped into.
 *
 * So the default path is a **Blob bootstrap**: we build a tiny ES module at
 * runtime, turn it into an object URL, and start a module worker from it. The
 * bootstrap does nothing but `import()` the real worker module and call
 * `startInferenceWorker()`.
 *
 * What that buys:
 *   + Zero bundler configuration in the consuming app.
 *   + The worker module (and, through it, ONNX Runtime Web) is fetched only when
 *     local acceleration is actually used, which is exactly the §96 requirement
 *     that the ML package never enters the initial bundle.
 *
 * What it costs, stated plainly:
 *   - A blob: module has an opaque origin, so **relative** specifiers inside the
 *     bootstrap cannot resolve. The worker module must therefore be reachable at an
 *     absolute URL (`options.workerModuleUrl`).
 *   - The CSP must allow `worker-src blob:`. Many enterprise CSPs do; some do not.
 *   - One extra network round trip versus an inlined chunk.
 *
 * All three are handled rather than assumed:
 *   1. `options.workerFactory` — if the consuming app *can* produce a worker with
 *      its own bundler, it passes a factory and none of the above applies. This is
 *      the preferred path and the one the web app should use in production.
 *   2. `options.workerModuleUrl` — the Blob bootstrap path.
 *   3. Neither available, or spawning throws (CSP, Safari quirk, no `Worker`) —
 *      `start()` reports `worker_unavailable` and the fallback controller drops
 *      straight to the server tier. No local inference is ever attempted on the
 *      main thread (§95).
 */
import { detectWorker, errorText } from '../capability';
import { BackendFailure } from '../backends/types';
import {
  BOOT_ID,
  TERMINAL_RESPONSE_KIND,
  createRequestId,
  isErrorResponse,
  isProgressResponse,
  parseWorkerResponse,
  type DetectedResponse,
  type DisposedResponse,
  type LoadedResponse,
  type ProgressResponse,
  type ReleasedResponse,
  type ResultResponse,
  type WorkerRequest,
  type WorkerRequestKind,
  type WorkerResponse,
} from './protocol';

export type WorkerStatus = 'idle' | 'starting' | 'alive' | 'crashed' | 'unavailable';

export interface WorkerHostOptions {
  /**
   * Preferred: let the consuming app create the worker with its own bundler, e.g.
   *   () => new Worker(new URL('@ai-coach/ai-runtime/src/worker/inference.worker.ts', import.meta.url), { type: 'module' })
   */
  workerFactory?: () => Worker;
  /** Absolute URL of the built worker module, for the Blob bootstrap path. */
  workerModuleUrl?: string;
  /** Per-request timeout. Long enough for a cold session creation. */
  requestTimeoutMs?: number;
  /** Timeout for the initial `boot` message. */
  bootTimeoutMs?: number;
  /** Bounded restarts after a crash. Defaults to 2. */
  maxRestarts?: number;
  onStatus?: (status: WorkerStatus) => void;
  onCrash?: (message: string) => void;
  onProgress?: (progress: ProgressResponse['payload']) => void;
  onWarning?: (message: string) => void;
}

interface Pending {
  id: string;
  kind: WorkerRequestKind;
  resolve: (response: WorkerResponse) => void;
  reject: (error: BackendFailure) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Maps a request kind to the response type that settles it. */
export interface TerminalResponseMap {
  detect: DetectedResponse;
  load: LoadedResponse;
  infer: ResultResponse;
  release: ReleasedResponse;
  dispose: DisposedResponse;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_BOOT_TIMEOUT_MS = 15_000;

export class WorkerHost {
  private worker: Worker | null = null;
  private objectUrl: string | null = null;
  private statusValue: WorkerStatus = 'idle';
  private startPromise: Promise<void> | null = null;
  private restarts = 0;
  private disposed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly options: WorkerHostOptions;

  constructor(options: WorkerHostOptions = {}) {
    this.options = options;
  }

  get status(): WorkerStatus {
    return this.statusValue;
  }

  get alive(): boolean {
    return this.statusValue === 'alive';
  }

  /** How many times the worker has been restarted after a crash this session. */
  get restartCount(): number {
    return this.restarts;
  }

  private setStatus(status: WorkerStatus): void {
    if (this.statusValue === status) return;
    this.statusValue = status;
    try {
      this.options.onStatus?.(status);
    } catch {
      /* ignore */
    }
  }

  /**
   * Start the worker. Never throws in the ordinary sense — it rejects with a typed
   * `BackendFailure(worker_unavailable | worker_crashed)` so the fallback
   * controller can treat "no worker" as just another step-down reason.
   */
  async start(): Promise<void> {
    if (this.disposed) {
      throw new BackendFailure({
        reason: 'worker_unavailable',
        backend: 'server',
        fatal: true,
        message: 'The runtime worker host has been disposed.',
      });
    }
    if (this.worker && this.statusValue === 'alive') return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.spawn().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async spawn(): Promise<void> {
    // `detectWorker()` checks `Worker` *plus* `Blob` and `URL.createObjectURL`,
    // because those are what the Blob bootstrap path needs. A consumer-supplied
    // factory does not use any of them, so it is only gated on its own success —
    // over-strict pre-checks would refuse a perfectly good bundler-built worker.
    if (!this.options.workerFactory && !detectWorker()) {
      this.setStatus('unavailable');
      throw new BackendFailure({
        reason: 'worker_unavailable',
        backend: 'server',
        fatal: true,
        message: 'This browser does not support Web Workers, so local inference is disabled.',
      });
    }

    this.setStatus('starting');

    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch (error) {
      this.setStatus('unavailable');
      throw new BackendFailure({
        reason: 'worker_unavailable',
        backend: 'server',
        fatal: true,
        message: `The inference worker could not be started: ${errorText(error)}`,
        cause: error,
      });
    }

    this.worker = worker;
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleError);
    worker.addEventListener('messageerror', this.handleMessageError);

    // Wait for the worker's own `boot` message. A blob bootstrap that fails to
    // import (CSP, 404, wrong URL) produces no boot and no error event, so the
    // timeout is the only reliable signal.
    await new Promise<void>((resolve, reject) => {
      const timeoutMs = this.options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        cleanup();
        this.teardown();
        this.setStatus('unavailable');
        reject(
          new BackendFailure({
            reason: 'worker_unavailable',
            backend: 'server',
            fatal: true,
            message: `The inference worker did not start within ${timeoutMs}ms.`,
          }),
        );
      }, timeoutMs);

      const onMessage = (event: MessageEvent<unknown>): void => {
        const response = parseWorkerResponse(event.data);
        if (!response) return;
        if (response.kind === 'boot' && response.id === BOOT_ID) {
          cleanup();
          this.setStatus('alive');
          resolve();
          return;
        }
        if (response.kind === 'error' && response.id === BOOT_ID) {
          cleanup();
          this.teardown();
          this.setStatus('unavailable');
          reject(
            new BackendFailure({
              reason: response.payload.reason,
              backend: 'server',
              fatal: true,
              message: response.payload.message,
            }),
          );
        }
      };
      const onError = (): void => {
        cleanup();
        this.teardown();
        this.setStatus('unavailable');
        reject(
          new BackendFailure({
            reason: 'worker_unavailable',
            backend: 'server',
            fatal: true,
            message: 'The inference worker failed while starting.',
          }),
        );
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
    });
  }

  private createWorker(): Worker {
    const factory = this.options.workerFactory;
    if (factory) return factory();

    const moduleUrl = this.options.workerModuleUrl;
    if (!moduleUrl) {
      throw new Error(
        'No workerFactory and no workerModuleUrl were provided, so the inference worker cannot be created.',
      );
    }
    const absolute = toAbsoluteUrl(moduleUrl);

    // The bootstrap is intentionally three lines: anything more would need to be
    // maintained as a string, which is where blob workers usually go wrong.
    const bootstrap = [
      `import(${JSON.stringify(absolute)})`,
      `  .then((m) => { if (m && typeof m.startInferenceWorker === 'function') m.startInferenceWorker(); })`,
      `  .catch((e) => { self.postMessage({ kind: 'error', id: '${BOOT_ID}', payload: { reason: 'worker_unavailable', message: 'Worker module import failed: ' + (e && e.message ? e.message : String(e)), backend: 'server', fatal: true } }); });`,
    ].join('\n');

    const blob = new Blob([bootstrap], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    try {
      return new Worker(url, { type: 'module', name: 'ai-coach-inference' });
    } catch (error) {
      this.revokeObjectUrl();
      throw error;
    }
  }

  private revokeObjectUrl(): void {
    const url = this.objectUrl;
    this.objectUrl = null;
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  /* -------------------- request correlation -------------------- */

  /**
   * Send a request and resolve with the response that settles it.
   *
   * Every request is bounded by a timeout: §62 lists `timeout` as a fallback
   * trigger, and a hung worker must never leave a caller's promise pending — the
   * whole runtime contract is that the caller always settles.
   */
  async request<K extends WorkerRequestKind>(
    request: Extract<WorkerRequest, { kind: K }>,
    options: { timeoutMs?: number; transfer?: Transferable[] } = {},
  ): Promise<TerminalResponseMap[K]> {
    await this.start();
    const worker = this.worker;
    if (!worker) {
      throw new BackendFailure({
        reason: 'worker_unavailable',
        backend: 'server',
        fatal: true,
        message: 'The inference worker is not running.',
      });
    }

    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    return new Promise<TerminalResponseMap[K]>((resolve, reject) => {
      const entry: Pending = {
        id: request.id,
        kind: request.kind,
        resolve: (response) => resolve(response as TerminalResponseMap[K]),
        reject,
        timer: null,
      };
      entry.timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(
          new BackendFailure({
            reason: 'timeout',
            backend: 'server',
            message: `The worker did not answer "${request.kind}" within ${timeoutMs}ms.`,
          }),
        );
      }, timeoutMs);
      this.pending.set(request.id, entry);

      try {
        if (options.transfer && options.transfer.length > 0) {
          worker.postMessage(request, options.transfer);
        } else {
          worker.postMessage(request);
        }
      } catch (error) {
        this.settleReject(
          request.id,
          new BackendFailure({
            reason: 'worker_crashed',
            backend: 'server',
            message: `The request could not be sent to the worker: ${errorText(error)}`,
            cause: error,
          }),
        );
      }
    });
  }

  private readonly handleMessage = (event: Event): void => {
    const data = (event as MessageEvent<unknown>).data;
    const response = parseWorkerResponse(data);
    if (!response) return;

    if (isProgressResponse(response)) {
      try {
        this.options.onProgress?.(response.payload);
      } catch {
        /* ignore */
      }
      return;
    }
    if (response.kind === 'boot') return;

    const entry = this.pending.get(response.id);
    if (!entry) return; // late reply to a timed-out or cancelled request

    if (isErrorResponse(response)) {
      this.settleReject(
        response.id,
        new BackendFailure({
          reason: response.payload.reason,
          backend: response.payload.backend,
          fatal: response.payload.fatal,
          ...(response.payload.task ? { task: response.payload.task } : {}),
          message: response.payload.message,
        }),
      );
      return;
    }

    if (response.kind !== TERMINAL_RESPONSE_KIND[entry.kind]) {
      // A response of the wrong kind for this id means the protocol drifted.
      this.settleReject(
        response.id,
        new BackendFailure({
          reason: 'worker_crashed',
          backend: 'server',
          message: `The worker answered "${entry.kind}" with an unexpected "${response.kind}" message.`,
        }),
      );
      return;
    }

    this.clearPending(response.id);
    entry.resolve(response);
  };

  private readonly handleError = (event: Event): void => {
    const message =
      (event as ErrorEvent).message || 'The inference worker stopped unexpectedly.';
    this.onWorkerDeath(message);
  };

  private readonly handleMessageError = (): void => {
    // A message that could not be deserialised. The worker itself is probably
    // fine, but the request it belongs to is unidentifiable, so fail everything
    // pending rather than leave a promise hanging.
    this.onWorkerDeath('A message from the inference worker could not be deserialised.');
  };

  /**
   * Crash handling: reject everything pending with `worker_crashed`, then restart
   * up to `maxRestarts` times. The restart budget is what stops a worker that
   * crashes on load from becoming an infinite respawn loop (§62).
   */
  private onWorkerDeath(message: string): void {
    this.setStatus('crashed');
    try {
      this.options.onCrash?.(message);
    } catch {
      /* ignore */
    }

    const failure = new BackendFailure({
      reason: 'worker_crashed',
      backend: 'server',
      message,
    });
    for (const id of [...this.pending.keys()]) {
      this.settleReject(id, failure);
    }

    this.teardown();

    const budget = this.options.maxRestarts ?? 2;
    if (this.disposed || this.restarts >= budget) {
      if (!this.disposed && this.restarts >= budget) {
        this.setStatus('unavailable');
        try {
          this.options.onWarning?.(
            `The inference worker crashed ${this.restarts} times; local acceleration is disabled for this session.`,
          );
        } catch {
          /* ignore */
        }
      }
      return;
    }
    this.restarts += 1;
    // Lazy restart: do not respawn eagerly, wait for the next request. A crash
    // during an idle period should not cost the user a fresh model load.
    this.setStatus('idle');
  }

  private settleReject(id: string, failure: BackendFailure): void {
    const entry = this.pending.get(id);
    this.clearPending(id);
    entry?.reject(failure);
  }

  private clearPending(id: string): void {
    const entry = this.pending.get(id);
    if (entry && entry.timer !== null) clearTimeout(entry.timer);
    this.pending.delete(id);
  }

  private teardown(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      try {
        worker.removeEventListener('message', this.handleMessage);
        worker.removeEventListener('error', this.handleError);
        worker.removeEventListener('messageerror', this.handleMessageError);
      } catch {
        /* ignore */
      }
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    }
    this.revokeObjectUrl();
  }

  /** Stop the worker and reject anything outstanding. Safe to call twice. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // Give the worker a chance to release GPU resources cleanly, but never block
    // teardown on it.
    if (this.worker && this.statusValue === 'alive') {
      try {
        await Promise.race([
          this.request({ kind: 'dispose', id: createRequestId('dispose'), payload: {} }, { timeoutMs: 2000 }),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        /* the worker may already be gone */
      }
    }
    const failure = new BackendFailure({
      reason: 'aborted',
      backend: 'server',
      message: 'The runtime was disposed.',
    });
    for (const id of [...this.pending.keys()]) this.settleReject(id, failure);
    this.teardown();
    this.setStatus('idle');
  }
}

/**
 * Blob modules have an opaque origin, so the bootstrap's `import()` needs an
 * absolute URL. Resolve against the document base when a relative path is given.
 */
function toAbsoluteUrl(url: string): string {
  if (/^[a-z]+:/i.test(url)) return url;
  try {
    const base =
      typeof document !== 'undefined' && document.baseURI
        ? document.baseURI
        : typeof location !== 'undefined'
          ? location.href
          : undefined;
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}
