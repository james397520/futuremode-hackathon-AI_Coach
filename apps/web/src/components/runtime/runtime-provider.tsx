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
} from '@ai-coach/shared';
import { RUNTIME_LABEL } from '@ai-coach/design-tokens';
import {
  createAiRuntime,
  type AiRuntime,
  type DetailedComputeCapability,
  type EnterpriseWebgpuOverride,
  type RuntimeSnapshot,
  type RuntimeTelemetryDetail,
} from '@ai-coach/ai-runtime';
import { API_BASE_URL } from '@/lib/api-client';

/**
 * Wraps `@ai-coach/ai-runtime` capability detection and publishes it through
 * context. Renders nothing of its own — §91 puts it between ThemeProvider and
 * AuthProvider purely as a provider.
 *
 * The runtime is created once per browser session and is *usable immediately*:
 * with `enableLocal: false` it answers every task through the server tier, so
 * nothing waits on WebGPU and no model file is downloaded before the user
 * accepts the §97 prompt. WebGPU is an acceleration layer only (§51 / §62).
 */
const LOCAL_AI_CONSENT_KEY = 'ai-coach:local-ai-consent';

export type LocalAiConsent = 'unknown' | 'granted' | 'declined';

export interface ComputeRuntimeValue {
  /** The `shared` contract shape. Null until detection has run. */
  capability: ComputeCapability | null;
  /** Extra diagnostics for the admin runtime page (§93). */
  capabilityDetail: DetailedComputeCapability | null;
  state: RuntimeState;
  telemetry: RuntimeTelemetry;
  telemetryDetail: RuntimeTelemetryDetail | null;
  /** Outward-facing label — learners never see engineering detail (§93). */
  label: string;
  backend: ComputeBackend;
  /** The tiers that will be tried, best first. */
  chain: readonly ComputeBackend[];
  policy: RuntimePolicy;
  workerStatus: RuntimeSnapshot['workerStatus'];
  /** Why the runtime last stepped down a tier, if it has (§94 copy source). */
  fallbackReason: string | null;
  /** §97 first-run consent for local acceleration. */
  consent: LocalAiConsent;
  setConsent: (next: Exclude<LocalAiConsent, 'unknown'>) => void;
  /** Clear the fallback cooldowns and re-detect — the "Retry local AI" action. */
  refresh: () => void;
  /** Escape hatch for features that need to run a local task directly. */
  runtime: AiRuntime | null;
}

const RuntimeContext = createContext<ComputeRuntimeValue | null>(null);

/**
 * `NEXT_PUBLIC_ENABLE_WEBGPU` is the deployment-level switch (§61 enterprise
 * mode). `auto` lets the device decide, `on` requires local acceleration, `off`
 * pins everything to the server.
 */
function readEnvOverride(): { override: EnterpriseWebgpuOverride; policy: Partial<RuntimePolicy> } {
  const raw = process.env.NEXT_PUBLIC_ENABLE_WEBGPU;
  const webgpu: RuntimePolicy['webgpu'] = raw === 'on' || raw === 'off' ? raw : 'auto';
  return {
    override: webgpu === 'auto' ? 'automatic' : webgpu,
    policy: {
      webgpu,
      allow_local_model_cache: true,
      // §61 / §100 — no sensitive browser cache by default.
      allow_sensitive_data_cache: false,
      clear_on_logout: true,
    },
  };
}

function readStoredConsent(): LocalAiConsent {
  try {
    const raw = window.localStorage.getItem(LOCAL_AI_CONSENT_KEY);
    return raw === 'granted' || raw === 'declined' ? raw : 'unknown';
  } catch {
    // Storage blocked (private mode / enterprise policy) — ask again next visit.
    return 'unknown';
  }
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const { override, policy: policyOverrides } = useMemo(readEnvOverride, []);
  const runtimeRef = useRef<AiRuntime | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [telemetryDetail, setTelemetryDetail] = useState<RuntimeTelemetryDetail | null>(null);
  const [consent, setConsentState] = useState<LocalAiConsent>('unknown');

  // Read consent before the runtime is created so no model is fetched early.
  const [consentLoaded, setConsentLoaded] = useState(false);
  useEffect(() => {
    setConsentState(readStoredConsent());
    setConsentLoaded(true);
  }, []);

  useEffect(() => {
    if (!consentLoaded) return;

    const runtime = createAiRuntime({
      policy: policyOverrides,
      enterpriseOverride: override,
      // §97: local weights are only fetched after an explicit yes, unless the
      // workspace forces acceleration on.
      enableLocal: override === 'on' || consent === 'granted',
      apiBaseUrl: API_BASE_URL,
      onWarning: (message) => {
        // Not user-facing: §94 says the learner sees "your session will continue".
        console.warn('[ai-runtime]', message);
      },
    });
    runtimeRef.current = runtime;

    const unsubscribe = runtime.subscribe((next) => {
      setSnapshot(next);
      setTelemetryDetail(runtime.telemetryDetail());
    });

    // Detection is fire-and-forget: the server tier already works.
    void runtime.detect().catch(() => undefined);

    return () => {
      unsubscribe();
      runtimeRef.current = null;
      void runtime.dispose().catch(() => undefined);
    };
    // Re-creating on consent change is intentional: `enableLocal` is a
    // construction-time gate for the model cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentLoaded, consent, override]);

  const setConsent = useCallback((next: Exclude<LocalAiConsent, 'unknown'>) => {
    setConsentState(next);
    try {
      window.localStorage.setItem(LOCAL_AI_CONSENT_KEY, next);
    } catch {
      /* not persisted — the prompt will appear again next visit. */
    }
    void runtimeRef.current?.setLocalEnabled(next === 'granted').catch(() => undefined);
  }, []);

  const refresh = useCallback(() => {
    void runtimeRef.current?.retryLocal().catch(() => undefined);
  }, []);

  const value = useMemo<ComputeRuntimeValue>(() => {
    const backend: ComputeBackend = snapshot?.backend ?? 'server';
    return {
      capability: snapshot?.capability ?? null,
      capabilityDetail: snapshot?.capabilityDetail ?? null,
      state: snapshot?.state ?? 'unknown',
      telemetry: snapshot?.telemetry ?? { backend, worker_alive: false },
      telemetryDetail,
      label: RUNTIME_LABEL[backend],
      backend,
      chain: snapshot?.chain ?? ['server'],
      policy:
        snapshot?.policy ?? {
          webgpu: policyOverrides.webgpu ?? 'auto',
          allow_local_model_cache: true,
          allow_sensitive_data_cache: false,
          clear_on_logout: true,
        },
      workerStatus: snapshot?.workerStatus ?? 'idle',
      fallbackReason: snapshot?.telemetry.fallback_reason ?? snapshot?.lastWarning ?? null,
      consent,
      setConsent,
      refresh,
      runtime: runtimeRef.current,
    };
  }, [snapshot, telemetryDetail, consent, setConsent, refresh, policyOverrides.webgpu]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useComputeCapability(): ComputeRuntimeValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error('useComputeCapability must be used inside <RuntimeProvider>');
  return ctx;
}
