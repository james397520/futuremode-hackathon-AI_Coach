'use client';

/**
 * The §14.1 layout decision, and nothing else.
 *
 *   training / voice   ┌── conversation ──┬── persona stack ──┐
 *   stage-left         ┌── persona ───────┬── conversation ───┐
 *
 * `stage-left` is the product decision that the virtual human is the subject of
 * the screen, not a sidebar: the persona column takes roughly two thirds on the
 * left and the conversation reads down a 36% column on the right (it was 42/58
 * at first, which still read as a sidebar with a big picture in it).
 *
 * The swap is done with CSS `order`, not by reordering the DOM: the conversation
 * stays first in source, so a screen reader and keyboard tab order still meet
 * the task before the scenery. Below `xl` the columns stack in source order for
 * the same reason.
 */
import type { ReactNode } from 'react';

import { cn } from './kit';

export interface TrainingGridProps {
  left: ReactNode;
  right: ReactNode;
  /** Voice mode gives the persona column more room (§24). */
  variant?: 'training' | 'voice' | 'stage-left';
  className?: string;
}

export function TrainingGrid({ left, right, variant = 'training', className }: TrainingGridProps) {
  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 gap-4 xl:gap-6',
        variant === 'voice'
          ? 'xl:grid-cols-[minmax(0,1fr)_minmax(420px,34%)]'
          : variant === 'stage-left'
            ? 'xl:grid-cols-[minmax(0,1fr)_minmax(400px,36%)]'
            : 'xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]',
        className,
      )}
    >
      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden',
          variant === 'stage-left' && 'xl:order-2',
        )}
      >
        {left}
      </div>

      {/* 8–16px float-out on large screens (§14.1). */}
      {/* The persona column scrolls itself (`overflow-y-auto` inside), so this
          wrapper only needs to establish the height chain. It used to add
          negative margins for the §14.1 "card floats past the container" depth,
          together with `overflow-hidden` on the same element — which clipped
          exactly the bleed it was creating, cutting the bottom card off. */}
      <div
        className={cn('h-full min-h-0 min-w-0', variant === 'stage-left' && 'xl:order-1')}
      >
        {right}
      </div>
    </div>
  );
}
