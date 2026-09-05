/**
 * Capability detection and backend selection — spec §59, §62, §92, §97.
 *
 * The governing rule (§51): WebGPU is an **acceleration layer, not a dependency**.
 * Everything in this file is written so that a missing, throwing, or hostile browser
 * API produces a *lower* capability object rather than a rejected promise. There is
 * exactly one way for `detectCapability()` to end: resolved.
 *
 * It is also SSR-safe. Importing this module runs no browser code, and calling
 * `detectCapability()` during Next.js server rendering resolves to the
 * server-backend capability instead of throwing.
 */
import type {
  ComputeBackend,
  ComputeCapability,
  RuntimePolicy,
} from '@ai-coach/shared';
import { RUNTIME_STATES, type RuntimeState } from '@ai-coach/shared';

import type { MemoryClass } from './backends/types';

/* ------------------------------------------------------------------ *
 * Environment guards
 * ------------------------------------------------------------------ */

/** True in a window context (not SSR, not a worker). */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined';
}

/** True inside a DedicatedWorkerGlobalScope. */
export function isWorkerScope(): boolean {
  return (
    typeof self !== 'undefined' &&
    typeof window === 'undefined' &&
    typeof (globalThis as { importScripts?: unknown }).importScripts === 'function'
  );
}

/** True in any browser-like scope (window or worker). */
export function hasNavigator(): boolean {
  return typeof navigator !== 'undefined' && navigator !== null;
}

/** §61 / §97 default policy: automatic acceleration, caching allowed, clear on logout. */
export const DEFAULT_RUNTIME_POLICY: RuntimePolicy = {
  webgpu: 'auto',
  allow_local_model_cache: true,
  allow_sensitive_data_cache: false,
  clear_on_logout: true,
};

/** §97: an enterprise admin may force the behaviour for the whole workspace. */
export type EnterpriseWebgpuOverride = 'on' | 'off' | 'automatic' | undefined;

/**
 * The capability object with the extra diagnostic fields the admin Runtime page
 * (§93) wants. `ComputeCapability` itself is the frozen cross-language contract,
 * so the extras live in a superset type rather than in `shared`.
 */
export interface DetailedComputeCapability extends ComputeCapability {
  /** Cross-origin isolated → `SharedArrayBuffer` → multi-threaded WASM. */
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  /** Threads we are willing to give the WASM EP. 1 when not isolated. */
  wasmThreads: number;
  /** navigator.hardwareConcurrency, clamped. */
  cores: number;
  /** navigator.deviceMemory in GB when exposed (Chromium only). */
  deviceMemoryGb?: number;
  /** Selected adapter limits we care about, when readable. */
  gpuLimits?: {
    maxBufferSize?: number;
    maxStorageBufferBindingSize?: number;
    maxComputeWorkgroupStorageSize?: number;
  };
  /** True when the adapter reported itself as a software/fallback adapter. */
  softwareAdapter: boolean;
  /** Why WebGPU was not selected, when it was not. */
  webgpuUnavailableReason?: string;
  detectedAt: string;
}

export interface DetectOptions {
  policy?: RuntimePolicy;
  enterpriseOverride?: EnterpriseWebgpuOverride;
  /** Milliseconds to wait for `requestAdapter()`. Some drivers hang. */
  adapterTimeoutMs?: number;
}

/* ------------------------------------------------------------------ *
 * WASM SIMD probe
 * ------------------------------------------------------------------ */

/**
 * A 29-byte WebAssembly module that exists purely to be *validated*.
 *
 * Decoded:
 *   00 61 73 6d          magic  "\0asm"
 *   01 00 00 00          version 1
 *   01 04 01 60 00 00    type section: one type, `() -> ()`
 *   03 02 01 00          function section: one function, type #0
 *   0a 09 01 07 00       code section: one body, 7 bytes, no locals
 *      41 00                i32.const 0
 *      fd 0f                i8x16.splat      <-- the SIMD opcode under test
 *      1a                   drop
 *      0b                   end
 *
 * `WebAssembly.validate` returns false (rather than throwing) on an engine that
 * does not implement the fixed-width SIMD proposal, because `0xfd` is then an
 * unknown opcode prefix. Validation is synchronous and does not compile or run any
 * code, so this is safe under strict CSP and costs microseconds.
 */
const WASM_SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03,
  0x02, 0x01, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

export function detectWasmSimd(): boolean {
  try {
    if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') {
      return false;
    }
    return WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    // A CSP that forbids wasm entirely can throw here. No SIMD, no WASM tier.
    return false;
  }
}

/** WebAssembly at all — if this is false the WASM tier is impossible. */
export function detectWasm(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && typeof WebAssembly.validate === 'function';
  } catch {
    return false;
  }
}

export function detectSharedArrayBuffer(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined';
  } catch {
    return false;
  }
}

export function detectCrossOriginIsolated(): boolean {
  try {
    const flag = (globalThis as { crossOriginIsolated?: unknown }).crossOriginIsolated;
    return flag === true;
  } catch {
    return false;
  }
}

/**
 * Worker support. §95 requires "no main-thread AI inference", so a browser without
 * workers is not allowed to run a local tier at all — it goes straight to server.
 */
export function detectWorker(): boolean {
  try {
    if (typeof Worker === 'undefined') return false;
    // Blob + object URL are how `worker-host.ts` spawns the worker without asking
    // the consuming Next.js app for bundler configuration, so both must exist.
    if (typeof Blob === 'undefined') return false;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * WebGPU probe
 * ------------------------------------------------------------------ */

interface GpuProbeResult {
  webgpu: boolean;
  reason?: string;
  adapterInfo?: { vendor?: string; architecture?: string };
  limits?: DetailedComputeCapability['gpuLimits'];
  software: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Probe `navigator.gpu`. Works in both window and worker scope (§58: detection may
 * happen in the worker). Never rejects.
 */
export async function probeWebgpu(adapterTimeoutMs = 4000): Promise<GpuProbeResult> {
  if (!hasNavigator()) {
    return { webgpu: false, reason: '沒有 navigator（伺服器端算繪）。', software: false };
  }
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return { webgpu: false, reason: 'navigator.gpu is not exposed.', software: false };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await withTimeout(
      Promise.resolve(gpu.requestAdapter({ powerPreference: 'high-performance' })),
      adapterTimeoutMs,
      'requestAdapter',
    );
  } catch (error) {
    // Some drivers reject or hang on the high-performance hint; retry unhinted.
    try {
      adapter = await withTimeout(
        Promise.resolve(gpu.requestAdapter()),
        adapterTimeoutMs,
        'requestAdapter',
      );
    } catch (retryError) {
      return {
        webgpu: false,
        reason: `requestAdapter failed: ${errorText(retryError) || errorText(error)}`,
        software: false,
      };
    }
  }

  if (!adapter) {
    return { webgpu: false, reason: '找不到可用的 GPU 介面卡。', software: false };
  }

  let adapterInfo: { vendor?: string; architecture?: string } | undefined;
  let software = false;
  try {
    // `adapter.info` is the current shape; `requestAdapterInfo()` is the older one.
    const info =
      (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info ??
      (await tryRequestAdapterInfo(adapter));
    if (info) {
      adapterInfo = {
        ...(info.vendor ? { vendor: info.vendor } : {}),
        ...(info.architecture ? { architecture: info.architecture } : {}),
      };
      const haystack = `${info.vendor ?? ''} ${info.architecture ?? ''} ${
        (info as { description?: string }).description ?? ''
      }`.toLowerCase();
      software = /swiftshader|software|llvmpipe|basic render|microsoft basic/.test(haystack);
    }
  } catch {
    /* adapter info is a nice-to-have; never fail detection over it */
  }

  try {
    if ((adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter === true) {
      software = true;
    }
  } catch {
    /* ignore */
  }

  let limits: DetailedComputeCapability['gpuLimits'];
  try {
    const l = adapter.limits;
    if (l) {
      limits = {
        ...(typeof l.maxBufferSize === 'number' ? { maxBufferSize: l.maxBufferSize } : {}),
        ...(typeof l.maxStorageBufferBindingSize === 'number'
          ? { maxStorageBufferBindingSize: l.maxStorageBufferBindingSize }
          : {}),
        ...(typeof l.maxComputeWorkgroupStorageSize === 'number'
          ? { maxComputeWorkgroupStorageSize: l.maxComputeWorkgroupStorageSize }
          : {}),
      };
    }
  } catch {
    /* ignore */
  }

  return {
    webgpu: true,
    ...(adapterInfo ? { adapterInfo } : {}),
    ...(limits ? { limits } : {}),
    software,
  };
}

async function tryRequestAdapterInfo(adapter: GPUAdapter): Promise<GPUAdapterInfo | undefined> {
  const legacy = (
    adapter as GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo> }
  ).requestAdapterInfo;
  if (typeof legacy !== 'function') return undefined;
  try {
    return await legacy.call(adapter);
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ *
 * Memory classification
 * ------------------------------------------------------------------ */

const MB = 1024 * 1024;

/**
 * Classify the device into the three §59 buckets from `navigator.deviceMemory`,
 * core count, and the GPU adapter's buffer limits.
 *
 * `deviceMemory` is Chromium-only and deliberately coarse (0.25 … 8). When it is
 * missing we lean on core count, and when *that* is missing we assume `medium` —
 * pessimistic enough to pick a small model, optimistic enough to still try.
 */
export function classifyMemory(input: {
  deviceMemoryGb?: number;
  cores: number;
  webgpu: boolean;
  softwareAdapter: boolean;
  gpuLimits?: DetailedComputeCapability['gpuLimits'];
}): MemoryClass {
  const { deviceMemoryGb, cores, webgpu, softwareAdapter, gpuLimits } = input;
  const maxBuffer = gpuLimits?.maxBufferSize;

  // A software rasteriser reports GPU support but performs like a slow CPU.
  if (softwareAdapter) return 'low';

  if (deviceMemoryGb !== undefined) {
    if (deviceMemoryGb <= 2) return 'low';
    if (deviceMemoryGb >= 8 && cores >= 8) {
      if (!webgpu) return 'medium';
      if (maxBuffer === undefined || maxBuffer >= 1024 * MB) return 'high';
      return 'medium';
    }
    if (deviceMemoryGb >= 4) return 'medium';
    return 'low';
  }

  // No deviceMemory (Safari, Firefox): infer from cores + GPU limits.
  if (cores <= 2) return 'low';
  if (cores >= 8 && webgpu && (maxBuffer === undefined || maxBuffer >= 1024 * MB)) {
    return 'high';
  }
  if (cores >= 4) return 'medium';
  return 'low';
}

function readDeviceMemory(): number | undefined {
  if (!hasNavigator()) return undefined;
  const value = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readCores(): number {
  if (!hasNavigator()) return 1;
  const value = navigator.hardwareConcurrency;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 32);
}

/* ------------------------------------------------------------------ *
 * Backend selection
 * ------------------------------------------------------------------ */

export interface BackendSelectionInput {
  webgpu: boolean;
  wasmSimd: boolean;
  worker: boolean;
  memoryClass: MemoryClass;
  softwareAdapter?: boolean;
}

export interface BackendSelection {
  backend: ComputeBackend;
  /** Ordered chain the fallback controller will walk. Always ends in 'server'. */
  chain: readonly ComputeBackend[];
  reason: string;
}

/**
 * Choose the top of the chain, honouring `RuntimePolicy.webgpu` and the enterprise
 * override (§97: admin may force on / off / automatic).
 *
 * Invariants:
 *   - `policy.webgpu === 'off'` (or override 'off') forces **server**, full stop.
 *     No local model is downloaded, nothing is cached, nothing touches the GPU.
 *   - 'on' is a *preference*, not a guarantee: if the device cannot do WebGPU we
 *     still step down rather than break the feature (§51).
 *   - No worker ⇒ no local tier, because §95 forbids main-thread inference.
 *   - The chain always terminates at 'server', which is the always-available floor.
 */
export function selectBackend(
  caps: BackendSelectionInput,
  policy: RuntimePolicy = DEFAULT_RUNTIME_POLICY,
  enterpriseOverride?: EnterpriseWebgpuOverride,
): BackendSelection {
  // The admin override wins over the (user-scoped) policy value.
  const effective: RuntimePolicy['webgpu'] =
    enterpriseOverride === 'on'
      ? 'on'
      : enterpriseOverride === 'off'
        ? 'off'
        : enterpriseOverride === 'automatic'
          ? 'auto'
          : policy.webgpu;

  if (effective === 'off') {
    return {
      backend: 'server',
      chain: ['server'],
      reason: '政策已停用本機加速。',
    };
  }

  if (!caps.worker) {
    return {
      backend: 'server',
      chain: ['server'],
      reason: '無法使用 Web Worker，而 AI 推論不得在主執行緒執行。',
    };
  }

  const local: ComputeBackend[] = [];
  if (caps.webgpu && !caps.softwareAdapter) local.push('webgpu');
  if (caps.wasmSimd) local.push('wasm');
  const chain: readonly ComputeBackend[] = [...local, 'server'];

  const head = chain[0] ?? 'server';

  if (effective === 'on' && head !== 'webgpu') {
    return {
      backend: head,
      chain,
      reason: caps.webgpu
        ? 'WebGPU was requested but only a software adapter is available, so the CPU tier is used.'
        : 'WebGPU was requested but is unavailable on this device.',
    };
  }

  if (head === 'webgpu') {
    return { backend: 'webgpu', chain, reason: 'WebGPU 可用且已啟用。' };
  }
  if (head === 'wasm') {
    return {
      backend: 'wasm',
      chain,
      reason: '無法使用 WebGPU，改用 WASM SIMD 層級。',
    };
  }
  return {
    backend: 'server',
    chain,
    reason: '這台裝置沒有可用的本機執行層級。',
  };
}

/* ------------------------------------------------------------------ *
 * detectCapability
 * ------------------------------------------------------------------ */

/** The capability object for a context with no browser at all (SSR). */
export function serverOnlyCapability(): DetailedComputeCapability {
  return {
    webgpu: false,
    wasmSimd: false,
    worker: false,
    memoryClass: 'medium',
    selectedBackend: 'server',
    crossOriginIsolated: false,
    sharedArrayBuffer: false,
    wasmThreads: 1,
    cores: 1,
    softwareAdapter: false,
    webgpuUnavailableReason: '不是在瀏覽器中執行。',
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Probe the device. Resolves always — every individual probe is guarded, and a
 * catastrophic failure still produces `serverOnlyCapability()`.
 */
export async function detectCapability(
  options: DetectOptions = {},
): Promise<DetailedComputeCapability> {
  const policy = options.policy ?? DEFAULT_RUNTIME_POLICY;
  const override = options.enterpriseOverride;

  if (!hasNavigator()) {
    const base = serverOnlyCapability();
    return { ...base, selectedBackend: 'server' };
  }

  try {
    const cores = readCores();
    const deviceMemoryGb = readDeviceMemory();
    const wasm = detectWasm();
    const wasmSimd = wasm && detectWasmSimd();
    const worker = detectWorker();
    const sharedArrayBuffer = detectSharedArrayBuffer();
    const coi = detectCrossOriginIsolated();

    // §61/§97: when policy forces WebGPU off we do not even ask for an adapter.
    // Probing creates a GPU device handle, which is exactly what a locked-down
    // deployment is trying to avoid.
    const forcedOff = policy.webgpu === 'off' || override === 'off';
    const gpu: GpuProbeResult = forcedOff
      ? { webgpu: false, reason: '政策已停用本機加速。', software: false }
      : await probeWebgpu(options.adapterTimeoutMs ?? 4000);

    const memoryClass = classifyMemory({
      ...(deviceMemoryGb === undefined ? {} : { deviceMemoryGb }),
      cores,
      webgpu: gpu.webgpu,
      softwareAdapter: gpu.software,
      ...(gpu.limits ? { gpuLimits: gpu.limits } : {}),
    });

    // Multi-threaded WASM needs SharedArrayBuffer, which needs cross-origin
    // isolation (COOP/COEP). Without it we run single-threaded rather than fail.
    const threadsAvailable = sharedArrayBuffer && coi;
    const wasmThreads = threadsAvailable
      ? Math.max(1, Math.min(4, cores - 1 > 0 ? cores - 1 : 1))
      : 1;

    const selection = selectBackend(
      {
        webgpu: gpu.webgpu,
        wasmSimd,
        worker,
        memoryClass,
        softwareAdapter: gpu.software,
      },
      policy,
      override,
    );

    return {
      webgpu: gpu.webgpu,
      wasmSimd,
      worker,
      memoryClass,
      selectedBackend: selection.backend,
      ...(gpu.adapterInfo ? { adapterInfo: gpu.adapterInfo } : {}),
      crossOriginIsolated: coi,
      sharedArrayBuffer,
      wasmThreads,
      cores,
      ...(deviceMemoryGb === undefined ? {} : { deviceMemoryGb }),
      ...(gpu.limits ? { gpuLimits: gpu.limits } : {}),
      softwareAdapter: gpu.software,
      ...(gpu.reason ? { webgpuUnavailableReason: gpu.reason } : {}),
      detectedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Truly unexpected. Degrade rather than reject — §51/§62.
    const base = serverOnlyCapability();
    return {
      ...base,
      webgpuUnavailableReason: `Capability detection failed: ${errorText(error)}`,
    };
  }
}

/** Narrow a detailed capability back down to the shared contract shape. */
export function toComputeCapability(caps: DetailedComputeCapability): ComputeCapability {
  return {
    webgpu: caps.webgpu,
    wasmSimd: caps.wasmSimd,
    worker: caps.worker,
    memoryClass: caps.memoryClass,
    selectedBackend: caps.selectedBackend,
    ...(caps.adapterInfo ? { adapterInfo: caps.adapterInfo } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The §92 runtime state machine
 * ------------------------------------------------------------------ */

/**
 * §92 WebGPU state machine:
 *   unknown → detecting → supported → loading → ready → degraded → fallback
 *
 * `RuntimeState` comes from `shared` (the UI may only display these states).
 * The events and the transition table are local.
 */
export type RuntimeEvent =
  | 'detect'
  | 'detected_local'
  | 'detected_server_only'
  | 'load'
  | 'loaded'
  | 'degrade'
  | 'fallback'
  | 'release'
  | 'reset';

const TRANSITIONS: Record<RuntimeState, Partial<Record<RuntimeEvent, RuntimeState>>> = {
  unknown: { detect: 'detecting', fallback: 'fallback', reset: 'unknown' },
  detecting: {
    detected_local: 'supported',
    detected_server_only: 'fallback',
    fallback: 'fallback',
    reset: 'unknown',
  },
  supported: {
    load: 'loading',
    degrade: 'degraded',
    fallback: 'fallback',
    detect: 'detecting',
    reset: 'unknown',
  },
  loading: {
    loaded: 'ready',
    degrade: 'degraded',
    fallback: 'fallback',
    reset: 'unknown',
  },
  ready: {
    // A release drops GPU resources but keeps the device classified as supported,
    // so the next call re-loads instead of re-detecting (§60 idle timeout).
    release: 'supported',
    load: 'loading',
    degrade: 'degraded',
    fallback: 'fallback',
    reset: 'unknown',
  },
  degraded: {
    // Degraded means "running, but on a lower tier than selected". It can recover
    // by loading again, or drop all the way to the server floor.
    load: 'loading',
    loaded: 'ready',
    fallback: 'fallback',
    release: 'supported',
    reset: 'unknown',
  },
  fallback: {
    // The server floor. Re-detection is the only way back up, which is what the
    // "Retry local acceleration" admin action triggers.
    detect: 'detecting',
    reset: 'unknown',
    fallback: 'fallback',
  },
};

/** Pure transition function. Unknown transitions are ignored, never thrown. */
export function nextRuntimeState(current: RuntimeState, event: RuntimeEvent): RuntimeState {
  const row = TRANSITIONS[current];
  const next = row[event];
  return next ?? current;
}

export function isRuntimeState(value: unknown): value is RuntimeState {
  return typeof value === 'string' && (RUNTIME_STATES as readonly string[]).includes(value);
}

export interface RuntimeStateMachine {
  readonly state: RuntimeState;
  send(event: RuntimeEvent): RuntimeState;
  subscribe(listener: (state: RuntimeState, event: RuntimeEvent) => void): () => void;
}

export function createRuntimeStateMachine(
  initial: RuntimeState = 'unknown',
): RuntimeStateMachine {
  let state: RuntimeState = isRuntimeState(initial) ? initial : 'unknown';
  const listeners = new Set<(state: RuntimeState, event: RuntimeEvent) => void>();
  return {
    get state() {
      return state;
    },
    send(event) {
      const next = nextRuntimeState(state, event);
      if (next !== state) {
        state = next;
        for (const listener of [...listeners]) {
          try {
            listener(state, event);
          } catch {
            /* a broken subscriber must not stall the runtime */
          }
        }
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(error);
    } catch {
      return 'unknown error';
    }
  }
  return String(error ?? 'unknown error');
}
