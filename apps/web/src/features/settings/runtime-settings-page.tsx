'use client';

import { Cpu, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile, Switch } from '@/components/ui';
import { RuntimeBadge, useComputeCapability } from '@/components/runtime';
import { useCan } from '@/lib/auth-context';
import { titleize } from '@/lib/utils';
import { SettingsShell } from './settings-shell';

/**
 * §93 Runtime Status UI (admin view) + §97 privacy controls + §61 cache policy.
 *
 * A learner only ever sees the outward label in the rail. This page is the one
 * place backend, model, load time, inference milliseconds, worker status and the
 * fallback reason are exposed — and it is gated on `runtime.view_telemetry`.
 */
export function RuntimeSettingsPage() {
  const canView = useCan('runtime.view_telemetry');
  const { capability, state, telemetry, backend, label, policy, consent, setConsent, usingFallbackDetector, refresh } =
    useComputeCapability();

  if (!canView) {
    return (
      <SettingsShell
        title="AI Runtime"
        description="Local inference acceleration for this device."
      >
        <GlassCard className="p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} strokeWidth={1.8} aria-hidden className="mt-0.5 text-accent-mint" />
            <div>
              <h2 className="text-card-title">{label}</h2>
              <p className="mt-1 max-w-xl text-body-sm text-text-secondary">
                Some supported AI tasks can run locally on this device to reduce latency. The server always
                produces the authoritative result, so nothing changes about your scores or transcripts.
                Detailed runtime diagnostics are available to workspace administrators.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant={consent === 'granted' ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => setConsent(consent === 'granted' ? 'declined' : 'granted')}
                >
                  {consent === 'granted' ? 'Disable local acceleration' : 'Enable local acceleration'}
                </Button>
                <RuntimeBadge />
              </div>
            </div>
          </div>
        </GlassCard>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      title="AI Runtime"
      description="WebGPU → WASM → server. WebGPU is an acceleration layer only; every feature must work without it."
      meta={
        <>
          <RuntimeBadge />
          <Pill tone="neutral" size="sm">State: {titleize(state)}</Pill>
          {usingFallbackDetector ? (
            <Pill tone="warning" size="sm">Built-in detector</Pill>
          ) : null}
        </>
      }
      actions={
        <Button variant="secondary" size="sm" onClick={refresh}>
          <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
          Re-detect
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Backend" value={titleize(backend)} hint="selected for this device" />
        <StatTile label="Worker" value={telemetry?.worker_alive ? 'Alive' : 'Not running'} hint="dedicated inference worker" />
        <StatTile label="Model load" value={telemetry?.load_ms !== undefined ? `${telemetry.load_ms} ms` : '—'} hint="cold start" />
        <StatTile label="Last inference" value={telemetry?.last_inference_ms !== undefined ? `${telemetry.last_inference_ms} ms` : '—'} hint="most recent local task" />
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <Cpu size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
          <h2 className="text-card-title">Detected capability</h2>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['WebGPU adapter', capability?.webgpu ? 'Available' : 'Not available'],
              ['WASM SIMD', capability?.wasmSimd ? 'Available' : 'Not available'],
              ['Web Worker', capability?.worker ? 'Available' : 'Not available'],
              ['Memory class', capability ? titleize(capability.memoryClass) : '—'],
              ['GPU vendor', capability?.adapterInfo?.vendor ?? 'Not reported'],
              ['GPU architecture', capability?.adapterInfo?.architecture ?? 'Not reported'],
              ['Selected backend', capability ? titleize(capability.selectedBackend) : '—'],
              ['Model', telemetry?.model_id ?? 'None loaded'],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex items-center justify-between gap-3 text-body-sm">
              <dt className="text-text-tertiary">{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {telemetry?.fallback_reason ? (
          <p className="mt-4 rounded-card-sm border border-border-soft px-3.5 py-3 text-body-sm">
            <span className="meta-label mr-2 text-state-warning">Fallback reason</span>
            <span className="text-text-secondary">{telemetry.fallback_reason}</span>
          </p>
        ) : null}

        {usingFallbackDetector ? (
          <p className="mt-3 text-tiny text-text-tertiary">
            Capability was detected by the built-in probe rather than the ai-runtime package — either the
            package is not installed yet or it did not expose a detector.
          </p>
        ) : null}
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Local tasks</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          These may run on the client when the device allows it. The server result is always authoritative —
          a local answer is a latency optimisation, never the source of truth.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {[
            ['Embedding', 'Query embedding for retrieval preview'],
            ['Intent classification', 'Fast intent hint sent alongside the turn'],
            ['Reranking', 'Local re-order of retrieved chunks'],
            ['Safety pre-check', 'Client-side screen before the turn is sent'],
          ].map(([task, detail]) => (
            <li key={task} className="glass-strong flex items-start justify-between gap-3 rounded-card-sm p-4">
              <div className="min-w-0">
                <p className="text-body-sm font-medium">{task}</p>
                <p className="mt-0.5 text-tiny text-text-tertiary">{detail}</p>
              </div>
              <Pill tone={backend === 'server' ? 'neutral' : 'success'} size="sm">
                {backend === 'server' ? 'Server' : titleize(backend)}
              </Pill>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Policy & privacy</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Administrators can force local acceleration on or off for the whole workspace. Sensitive data is
          never cached in the browser by default, and all local caches are cleared on sign-out.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="meta-label mb-2">WebGPU policy</p>
            <Select
              value={policy.webgpu}
              onValueChange={() => undefined}
              aria-label="WebGPU policy"
              options={[
                { value: 'auto', label: 'Automatic — use it where supported' },
                { value: 'on', label: 'On — required' },
                { value: 'off', label: 'Off — server only' },
              ]}
            />
            <p className="mt-1.5 text-tiny text-text-tertiary">
              Set by <code>NEXT_PUBLIC_ENABLE_WEBGPU</code> in this deployment.
            </p>
          </div>

          <div className="space-y-3">
            <Switch checked={policy.allow_local_model_cache} onCheckedChange={() => undefined} label="Cache model files locally" />
            <Switch checked={policy.allow_sensitive_data_cache} onCheckedChange={() => undefined} label="Cache sensitive data locally" />
            <Switch checked={policy.clear_on_logout} onCheckedChange={() => undefined} label="Clear all local caches on sign-out" />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Pill tone={consent === 'granted' ? 'success' : consent === 'declined' ? 'neutral' : 'warning'} size="sm">
            This device: {consent === 'unknown' ? 'not asked yet' : consent}
          </Pill>
          <Button variant="ghost" size="sm" onClick={() => setConsent(consent === 'granted' ? 'declined' : 'granted')}>
            {consent === 'granted' ? 'Turn off for this device' : 'Turn on for this device'}
          </Button>
        </div>
      </GlassCard>
    </SettingsShell>
  );
}
