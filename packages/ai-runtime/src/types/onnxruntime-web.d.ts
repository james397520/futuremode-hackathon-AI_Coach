/**
 * Minimal ambient declaration for `onnxruntime-web`.
 *
 * Why this file exists
 * --------------------
 * ONNX Runtime Web is an **optional, lazily loaded** dependency (spec §96: the ML
 * package must never enter the initial bundle). We therefore only ever reach it
 * through `await import('onnxruntime-web')` inside the worker, behind a try/catch,
 * and a failure to load is just another fallback reason — not a build error.
 *
 * Declaring the narrow surface we actually use here means:
 *   1. `tsc --noEmit` succeeds in a checkout where the optional runtime dependency
 *      has not been installed (CI installs it, but the package must not hard-fail
 *      typecheck when it is absent).
 *   2. We are forced to state, in one place, exactly which ORT APIs this package
 *      couples to. If ORT changes, only this file and `backends/ort-session.ts`
 *      have to move.
 *
 * Tradeoff: for a non-relative specifier TypeScript prefers an ambient module
 * declaration, so this shadows the real (much richer) `onnxruntime-web` types when
 * the package *is* installed. Keep the shapes below conservative and accurate, and
 * only widen them when we start using a new API.
 */
declare module 'onnxruntime-web' {
  export type OrtTypedData =
    | Float32Array
    | Float64Array
    | Int8Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | BigInt64Array
    | BigUint64Array;

  export class Tensor {
    constructor(
      type: string,
      data: OrtTypedData | readonly number[] | readonly bigint[] | readonly string[],
      dims?: readonly number[],
    );
    readonly type: string;
    readonly data: OrtTypedData | readonly string[];
    readonly dims: readonly number[];
    readonly size: number;
    dispose?(): void;
    getData?(release?: boolean): Promise<OrtTypedData | readonly string[]>;
  }

  export type ExecutionProviderName = 'webgpu' | 'wasm' | 'webnn' | 'webgl' | 'cpu';

  export interface ExecutionProviderConfig {
    name: ExecutionProviderName | string;
    [key: string]: unknown;
  }

  export interface SessionOptions {
    executionProviders?: ReadonlyArray<ExecutionProviderName | string | ExecutionProviderConfig>;
    graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
    executionMode?: 'sequential' | 'parallel';
    enableMemPattern?: boolean;
    enableCpuMemArena?: boolean;
    freeDimensionOverrides?: Readonly<Record<string, number>>;
    preferredOutputLocation?: string | Readonly<Record<string, string>>;
    logSeverityLevel?: 0 | 1 | 2 | 3 | 4;
    intraOpNumThreads?: number;
    interOpNumThreads?: number;
  }

  export interface RunOptions {
    logSeverityLevel?: 0 | 1 | 2 | 3 | 4;
    terminate?: boolean;
  }

  export class InferenceSession {
    static create(
      model: ArrayBufferLike | Uint8Array | string,
      options?: SessionOptions,
    ): Promise<InferenceSession>;
    run(feeds: Record<string, Tensor>, options?: RunOptions): Promise<Record<string, Tensor>>;
    release(): Promise<void>;
    readonly inputNames: readonly string[];
    readonly outputNames: readonly string[];
  }

  export interface OrtEnv {
    wasm: {
      numThreads?: number;
      simd?: boolean;
      proxy?: boolean;
      wasmPaths?: string | Record<string, string>;
    };
    webgpu?: {
      device?: unknown;
      powerPreference?: 'low-power' | 'high-performance' | undefined;
      forceFallbackAdapter?: boolean;
      profiling?: unknown;
    };
    logLevel?: 'verbose' | 'info' | 'warning' | 'error' | 'fatal';
    debug?: boolean;
  }

  export const env: OrtEnv;
}
