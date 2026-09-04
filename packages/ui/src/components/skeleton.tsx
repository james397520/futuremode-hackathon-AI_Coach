/**
 * Skeleton — spec §44 Loading States（"Skeleton 必須與 glass style 一致"）。
 *
 * 決策：不用灰色實心方塊。骨架是「玻璃上的一層極淡漸層」+ 柔和呼吸，
 * 這樣放在 glass card 裡不會像 material design 的 placeholder。
 * 一律遵守 prefers-reduced-motion（§47）。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';

export const skeletonVariants = cva(
  [
    'block shrink-0 animate-pulse motion-reduce:animate-none',
    '[background-image:linear-gradient(100deg,color-mix(in_srgb,var(--text-tertiary)_12%,transparent),color-mix(in_srgb,var(--text-tertiary)_20%,transparent)_45%,color-mix(in_srgb,var(--text-tertiary)_12%,transparent))]',
  ].join(' '),
  {
    variants: {
      shape: {
        line: 'h-3.5 w-full rounded-pill',
        text: 'h-4 w-full rounded-pill',
        block: 'h-24 w-full rounded-card-sm',
        card: 'h-40 w-full rounded-card',
        pill: 'h-6 w-20 rounded-pill',
        avatar: 'size-10 rounded-avatar',
        circle: 'size-10 rounded-pill',
      },
    },
    defaultVariants: { shape: 'line' },
  },
);

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof skeletonVariants> {}

export const Skeleton = React.forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { shape, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden
      className={cn(skeletonVariants({ shape }), className)}
      {...props}
    />
  );
});

export interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 行數。最後一行會自動縮短，看起來像真的段落。 */
  lines?: number;
}

export const SkeletonText = React.forwardRef<HTMLDivElement, SkeletonTextProps>(
  function SkeletonText({ lines = 3, className, ...props }, ref) {
    const count = Math.max(1, lines);

    return (
      <div ref={ref} className={cn('flex w-full flex-col gap-2', className)} {...props}>
        {Array.from({ length: count }, (_, index) => (
          <Skeleton
            key={index}
            shape="line"
            className={index === count - 1 && count > 1 ? 'w-3/5' : undefined}
          />
        ))}
      </div>
    );
  },
);

export interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 顯示頭像佔位（persona / user 卡片）。 */
  withAvatar?: boolean;
  lines?: number;
}

/** 一整張 glass 卡片的載入狀態，外觀與 GlassCard 對齊。 */
export const SkeletonCard = React.forwardRef<HTMLDivElement, SkeletonCardProps>(
  function SkeletonCard({ withAvatar = false, lines = 3, className, ...props }, ref) {
    return (
      <div
        role="status"
        aria-busy
        aria-live="polite"
        ref={ref}
        className={cn(
          'flex flex-col gap-4 rounded-card border border-border-glass bg-glass-card p-5 backdrop-blur-card',
          '[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
          className,
        )}
        {...props}
      >
        <div className="flex items-center gap-3">
          {withAvatar ? <Skeleton shape="avatar" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton shape="line" className="h-4 w-1/3" />
            <Skeleton shape="line" className="h-3 w-1/5" />
          </div>
          <Skeleton shape="pill" />
        </div>
        <SkeletonText lines={lines} />
        <span className="sr-only">Loading</span>
      </div>
    );
  },
);
