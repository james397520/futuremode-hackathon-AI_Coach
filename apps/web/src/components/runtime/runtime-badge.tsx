'use client';

import { Cpu, ShieldCheck, Sparkles } from 'lucide-react';
import { Pill, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useComputeCapability } from './runtime-provider';

/**
 * §93 Runtime Status UI — a learner only ever sees the outward label
 * (`Local AI · GPU accelerated` / `Local AI ready` / `Cloud AI`). Backend,
 * model, load time and fallback reason are admin-only, in Settings → AI Runtime.
 */
export function RuntimeBadge({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const { label, backend, state } = useComputeCapability();
  const Icon = backend === 'webgpu' ? Sparkles : backend === 'wasm' ? Cpu : ShieldCheck;
  const tone = backend === 'webgpu' ? 'gradient' : backend === 'wasm' ? 'info' : 'neutral';

  if (variant === 'compact') {
    return (
      <Tooltip content={label} side="right">
        <span
          className={cn('rail-item justify-center', className)}
          role="status"
          aria-label={`AI runtime: ${label}`}
          data-state={state}
        >
          <Icon size={18} strokeWidth={1.6} aria-hidden />
        </span>
      </Tooltip>
    );
  }

  return (
    <Pill tone={tone} size="sm" className={cn('gap-1.5', className)} role="status" aria-label={`AI runtime: ${label}`}>
      <Icon size={13} strokeWidth={1.8} aria-hidden />
      {label}
    </Pill>
  );
}
