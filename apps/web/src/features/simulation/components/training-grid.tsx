'use client';

/**
 * The §14.1 layout decision, and nothing else.
 *
 *   ┌──────────────────────────────────┬───────────────────────────┐
 *   │ LEFT: conversation / training    │ RIGHT: AI persona stack   │
 *   └──────────────────────────────────┴───────────────────────────┘
 *
 * Left is the wide conversation column. Right is a stack of floating cards that
 * is allowed to overflow the container by 8–16px on large screens, which is what
 * produces the reference layout's floating depth. Never a dashboard table (§99).
 *
 * Below `xl` the columns stack: conversation first, persona second, because on a
 * narrow screen the conversation is the task and the persona is context.
 */
import type { ReactNode } from 'react';

import { cn } from './kit';

export interface TrainingGridProps {
  left: ReactNode;
  right: ReactNode;
  /** Voice mode gives the persona column more room (§24). */
  variant?: 'training' | 'voice';
  className?: string;
}

export function TrainingGrid({ left, right, variant = 'training', className }: TrainingGridProps) {
  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 gap-4 xl:gap-6',
        variant === 'voice'
          ? 'xl:grid-cols-[minmax(0,1fr)_minmax(420px,34%)]'
          : 'xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]',
        className,
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-4">{left}</div>

      {/* 8–16px float-out on large screens (§14.1). */}
      <div className="min-h-0 min-w-0 xl:-mr-2 xl:-mt-2 2xl:-mr-4 2xl:-mt-3">{right}</div>
    </div>
  );
}
