'use client';

import { Sparkles } from 'lucide-react';
import { Button, GlassCard } from '@/components/ui';
import { useComputeCapability } from './runtime-provider';

/**
 * §97 WebGPU Security / Privacy UX — shown once, only when the device could
 * actually accelerate locally and the workspace policy is `auto`.
 */
export function LocalAiConsent() {
  const { consent, setConsent, capability, policy } = useComputeCapability();

  if (consent !== 'unknown') return null;
  if (policy.webgpu !== 'auto') return null;
  if (!capability || capability.selectedBackend === 'server') return null;

  return (
    <GlassCard
      tone="strong"
      className="fixed bottom-6 right-6 z-40 w-[min(360px,calc(100vw-48px))] p-5 animate-card-enter"
      role="dialog"
      aria-labelledby="local-ai-consent-title"
    >
      <div className="flex items-start gap-3">
        <span
          className="gradient-pill flex h-9 w-9 shrink-0 items-center justify-center"
          aria-hidden
        >
          <Sparkles size={17} strokeWidth={1.8} />
        </span>
        <div className="space-y-2">
          <h2 id="local-ai-consent-title" className="text-card-title">
            Local AI acceleration
          </h2>
          <p className="text-body-sm text-text-secondary">
            Some supported AI tasks can run locally on this device. Enterprise data policies
            still apply, and nothing sensitive is cached by default.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setConsent('declined')}>
          Not now
        </Button>
        <Button variant="primary" size="sm" onClick={() => setConsent('granted')}>
          Enable
        </Button>
      </div>
    </GlassCard>
  );
}
