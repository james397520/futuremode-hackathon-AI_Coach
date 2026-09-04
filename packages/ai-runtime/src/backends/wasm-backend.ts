/**
 * Tier 2 — ONNX Runtime Web on the **WASM execution provider**.
 *
 * Spec §51, §57, §62.
 *
 * Runs the *same* ONNX graphs as the WebGPU tier, so a step-down costs accuracy
 * nothing — only latency. Two configurations:
 *
 *   - **SIMD + threads**, when the page is cross-origin isolated (COOP/COEP set)
 *     and `SharedArrayBuffer` exists. ORT then uses a thread pool.
 *   - **SIMD, single-threaded**, otherwise. Enterprise deployments frequently
 *     cannot set COOP/COEP (third-party embeds, legacy SSO iframes), so this is
 *     the common case and must remain fully functional — it is just slower.
 *
 * Without SIMD at all the tier is refused at selection time (`capability.ts`), so
 * we never end up here on an engine that would run scalar WASM at unusable speed.
 *
 * Runs inside the inference worker (§58).
 */
import type { LocalTask } from '@ai-coach/shared-types';

import { detectCrossOriginIsolated, detectSharedArrayBuffer, detectWasmSimd } from '../capability';
import { OrtBackend, type OrtBackendOptions } from './ort-backend';
import { BackendFailure } from './types';
import type { LocalBackendKind } from '../worker/protocol';

export interface WasmBackendOptions extends OrtBackendOptions {
  /**
   * Threads to give ORT. Clamped to 1 unless the scope is cross-origin isolated,
   * because `SharedArrayBuffer` is a hard requirement for the threaded build and
   * asking for more would make session creation fail instead of degrade.
   */
  threads?: number;
  /** Bypass the SIMD gate. Only useful in tests. */
  allowScalar?: boolean;
}

export class WasmBackend extends OrtBackend {
  readonly kind: LocalBackendKind = 'wasm';

  private readonly wasmOptions: WasmBackendOptions;
  private readonly threaded: boolean;
  private readonly threads: number;

  constructor(options: WasmBackendOptions = {}) {
    const threadsAvailable = detectSharedArrayBuffer() && detectCrossOriginIsolated();
    const requested = Math.max(1, Math.floor(options.threads ?? 1));
    const threads = threadsAvailable ? Math.min(requested, 4) : 1;
    super({
      ...options,
      ort: {
        ...(options.ort ?? {}),
        numThreads: threads,
        simd: options.ort?.simd ?? detectWasmSimd(),
      },
      // The CPU tier is several times slower than the GPU tier, so it gets a
      // longer budget before `timeout` triggers a step-down to the server.
      inferenceTimeoutMs: options.inferenceTimeoutMs ?? 25_000,
      // Smaller batches: peak memory here is main-heap memory, shared with the app.
      maxBatchSize: options.maxBatchSize ?? (threadsAvailable ? 8 : 4),
    });
    this.wasmOptions = options;
    this.threaded = threadsAvailable && threads > 1;
    this.threads = threads;
  }

  protected executionProviders(): ReadonlyArray<
    string | { name: string; [key: string]: unknown }
  > {
    return ['wasm'];
  }

  protected sessionThreads(): number {
    return this.threads;
  }

  /** True when a `SharedArrayBuffer`-backed thread pool is in use. */
  get multiThreaded(): boolean {
    return this.threaded;
  }

  get threadCount(): number {
    return this.threads;
  }

  protected override async prepare(): Promise<void> {
    if (this.wasmOptions.allowScalar === true) return;
    if (!detectWasmSimd()) {
      // Scalar WASM would run a 33M-parameter encoder at roughly a tenth of the
      // SIMD speed, which is worse for the user than a server round trip.
      throw new BackendFailure({
        reason: 'not_supported_for_task',
        backend: 'wasm',
        fatal: true,
        message: 'WebAssembly SIMD is unavailable, so the CPU tier would be too slow.',
      });
    }
  }

  protected override assertHealthy(task?: LocalTask): void {
    void task;
    // The WASM tier has no device to lose. The only unrecoverable state is a
    // failed module load, which `prepare()`/`loadWithFiles()` already report.
  }
}
