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
    // `floating`, not `strong`: this is a card hovering over the page, so it
    // gets the card glass plus the one floating shadow the kit uses for every
    // overlay — the strong variant had no elevation and a near-opaque fill.
    <GlassCard
      tone="floating"
      className="fixed bottom-6 right-6 z-40 w-[min(360px,calc(100vw-48px))] p-5 animate-card-enter"
      role="dialog"
      aria-labelledby="local-ai-consent-title"
    >
      <div className="flex items-start gap-3">
        {/* A white icon on the gradient pill measured ~2:1; indigo on an indigo
            tint is 3.0:1 (non-text AA) in light and 4.5:1 in dark. */}
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-[color:color-mix(in_srgb,var(--accent-indigo)_14%,transparent)] text-accent-indigo"
          aria-hidden
        >
          <Sparkles size={17} strokeWidth={1.8} />
        </span>
        <div className="space-y-2">
          <h2 id="local-ai-consent-title" className="text-card-title">
            本機 AI 加速
          </h2>
          <p className="text-body-sm text-text-secondary">
            部分支援的 AI 工作可以直接在這台裝置上執行。企業資料政策仍然適用，預設也不會快取任何敏感內容。
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setConsent('declined')}>
          暫時不要
        </Button>
        <Button variant="primary" size="sm" onClick={() => setConsent('granted')}>
          啟用
        </Button>
      </div>
    </GlassCard>
  );
}
