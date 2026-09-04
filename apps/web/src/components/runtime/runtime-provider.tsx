'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  ComputeBackend,
  ComputeCapability,
  RuntimePolicy,
  RuntimeState,
  RuntimeTelemetry,
} from '@ai-coach/shared-types';
import { RUNTIME_LABEL } from '@ai-coach/design-tokens';

/**
 * ── ASSUMPTION about `@ai-coach/ai-runtime` ─────────────────────────────────
 * That package is written by a different owner in parallel. We import it
 * optimistically as a namespace and probe for two entry points at runtime:
 *
 *   detectCapability(policy?) => ComputeCapability | Promise<ComputeCapability>
 *   createAiRuntime(options?) => {
 *     capability?, telemetry?(), state?(), subscribe?(cb), warmup?(), dispose?()
 *   }
 *
 * If neither is present (package still empty, or a different export name), we
 * fall back to the local `detectCapabilityFallback()` below so the shell still
 * boots and the rail badge still says something truthful. WebGPU is an
 * acceleration layer only — nothing may break without it (§51 / §62).
 * ────────────────────────────────────────────────────────────────────────────
 */
import * as AiRuntime from '@ai-coach/ai-runtime';

const LOCAL_AI_CONSENT_KEY = 'ai-coach:local-ai-consent';

export type LocalAiConsent = 'unknown' | 'granted' | 'declined';

export interface ComputeRuntimeValue {
  capability: ComputeCapability | null;
  state: RuntimeState;
  telemetry: RuntimeTelemetry | null;
  /** Outward-facing label — students never see engineering detail (§93). */
  label: string;
  backend: ComputeBackend;
  policy: RuntimePolicy;
  /** §97 first-run privacy prompt. */
  consent: LocalAiConsent;
  setConsent: (next: Exclude<LocalAiConsent, 'unknown'>) => void;
  /** True when we had to use the built-in detector instead of the runtime package. */
  usingFallbackDetector: boolean;
  refresh: () => void;
}

const RuntimeContext = createContext<ComputeRuntimeValue | null>(null);

function readEnvPolicy(): RuntimePolicy {
  const raw = process.env.NEXT_PUBLIC_ENABLE_WEBGPU;
  const webgpu: RuntimePolicy['webgpu'] = raw === 'on' || raw === 'off' ? raw : 'auto';
  return {
    webgpu,
    allow_local_model_cache: true,
    // §61 / §100 — no sensitive browser cache by default.
    allow_sensitive_data_cache: false,
    clear_on_logout: true,
  };
}

/** Dependency-free detection used when the runtime package is unavailable (§59). */
async function detectCapabilityFallback(policy: RuntimePolicy): Promise<ComputeCapability> {
  const worker = typeof Worker !== 'undefined';
  const wasmSimd = typeof WebAssembly !== 'undefined';

  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memoryClass: ComputeCapability['memoryClass'] =
    (deviceMemory ?? 0) >= 8 || cores >= 12 ? 'high' : cores >= 6 ? 'medium' : 'low';

  let webgpu = false;
  let adapterInfo: ComputeCapability['adapterInfo'];

  if (policy.webgpu !== 'off') {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (gpu) {
      try {
        const adapter = (await gpu.requestAdapter()) as
          | { info?: { vendor?: string; architecture?: string } }
          | null;
        webgpu = Boolean(adapter);
        adapterInfo = adapter?.info
          ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture }
          : undefined;
      } catch {
        webgpu = false;
      }
    }
  }

  const selectedBackend: ComputeBackend = webgpu && worker ? 'webgpu' : wasmSimd && worker ? 'wasm' : 'server';

  return { webgpu, wasmSimd, worker, memoryClass, selectedBackend, adapterInfo };
}

type RuntimeModule = Record<string, unknown>;

interface RuntimeHandle {
  telemetry?: () => RuntimeTelemetry;
  state?: () => RuntimeState;
  subscribe?: (listener: (next: { state?: RuntimeState; telemetry?: RuntimeTelemetry }) => void) => () => void;
  dispose?: () => void;
}

/**
 * Renders nothing of its own (§91 puts it between ThemeProvider and AuthProvider);
 * it only detects capability once and publishes it through context.
 */
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const policy = useMemo(readEnvPolicy, []);
  const [capability, setCapability] = useState<ComputeCapability | null>(null);
  const [state, setState] = useState<RuntimeState>('unknown');
  const [telemetry, setTelemetry] = useState<RuntimeTelemetry | null>(null);
  const [consent, setConsentState] = useState<LocalAiConsent>('unknown');
  const [usingFallbackDetector, setUsingFallbackDetector] = useState(false);
  const [nonce, setNonce] = useState(0);
  const handleRef = useRef<RuntimeHandle | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_AI_CONSENT_KEY);
      if (raw === 'granted' || raw === 'declined') setConsentState(raw);
    } catch {
      /* storage blocked — treat as unknown, prompt again next visit. */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function boot() {
      setState('detecting');

      const mod = AiRuntime as unknown as RuntimeModule;
      const detect = mod.detectCapability;
      const create = mod.createAiRuntime;

      let detected: ComputeCapability | null = null;

      if (typeof detect === 'function') {
        try {
          detected = (await (detect as (p: RuntimePolicy) => Promise<ComputeCapability>)(policy)) ?? null;
        } catch {
          detected = null;
        }
      }

      if (!detected) {
        setUsingFallbackDetector(true);
        detected = await detectCapabilityFallback(policy);
      }

      if (cancelled) return;
      setCapability(detected);
      setState(detected.selectedBackend === 'server' ? 'fallback' : 'supported');

      if (typeof create === 'function') {
        try {
          const handle = (await (create as (o: unknown) => Promise<RuntimeHandle> | RuntimeHandle)({
            policy,
            capability: detected,
            // Model download / caching only after the user opts in (§97).
            enabled: policy.webgpu !== 'off' && consent !== 'declined',
          })) as RuntimeHandle;
          if (cancelled) {
            handle?.dispose?.();
            return;
          }
          handleRef.current = handle;
          if (typeof handle?.telemetry === 'function') setTelemetry(handle.telemetry());
          if (typeof handle?.state === 'function') setState(handle.state());
          if (typeof handle?.subscribe === 'function') {
            unsubscribe = handle.subscribe((next) => {
              if (next.state) setState(next.state);
              if (next.telemetry) setTelemetry(next.telemetry);
            });
          }
        } catch {
          // Local acceleration failed to initialise — server path still works (§62).
          setState('fallback');
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      unsubscribe?.();
      handleRef.current?.dispose?.();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy, consent, nonce]);

  const setConsent = useCallback((next: Exclude<LocalAiConsent, 'unknown'>) => {
    setConsentState(next);
    try {
      window.localStorage.setItem(LOCAL_AI_CONSENT_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const backend: ComputeBackend = capability?.selectedBackend ?? 'server';

  const value = useMemo<ComputeRuntimeValue>(
    () => ({
      capability,
      state,
      telemetry:
        telemetry ??
        (capability
          ? {
              backend,
              worker_alive: capability.worker,
              ...(backend === 'server'
                ? { fallback_reason: capability.webgpu ? 'worker unavailable' : 'WebGPU adapter unavailable' }
                : {}),
            }
          : null),
      label: RUNTIME_LABEL[backend],
      backend,
      policy,
      consent,
      setConsent,
      usingFallbackDetector,
      refresh: () => setNonce((n) => n + 1),
    }),
    [capability, state, telemetry, backend, policy, consent, setConsent, usingFallbackDetector],
  );

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useComputeCapability(): ComputeRuntimeValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error('useComputeCapability must be used inside <RuntimeProvider>');
  return ctx;
}
