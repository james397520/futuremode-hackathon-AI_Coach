/**
 * Pill / Badge — spec §86 小面積漸層狀態 pill。
 *
 * 與 `GradientPill` 的分工：
 *  - `GradientPill` 只有 AI/狀態漸層那一種強調樣式。
 *  - `Pill` 是通用狀態標籤，`tone` 涵蓋 gradient + 各語意色的低飽和 tint。
 *  - `Badge` 是 `Pill` 的小尺寸別名（計數、標籤用）。
 *
 * §99：只在小面積用漸層；不做每張卡片不同顏色、不用實心高飽和色塊。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';

export type PillTone =
  | 'gradient'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent';

/** 語意色一律走 color-mix tint + 同色文字，避免實心色塊（§99）。 */
const tint = (token: string) =>
  [
    `bg-[color:color-mix(in_srgb,var(${token})_16%,transparent)]`,
    `text-[color:color-mix(in_srgb,var(${token})_82%,var(--text-primary))]`,
    `border-[color:color-mix(in_srgb,var(${token})_28%,transparent)]`,
  ].join(' ');

export const pillVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-pill border font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        gradient:
          'border-transparent text-white [background-image:linear-gradient(120deg,var(--accent-blue),var(--accent-cyan)_48%,var(--accent-mint))]',
        neutral:
          'border-border-soft bg-[color:color-mix(in_srgb,var(--text-tertiary)_12%,transparent)] text-text-secondary',
        success: tint('--success'),
        warning: tint('--warning'),
        danger: tint('--danger'),
        info: tint('--info'),
        accent: tint('--accent-indigo'),
      },
      size: {
        sm: 'h-5 px-2 text-tiny',
        md: 'h-6 px-2.5 text-meta',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {
  /** 前置 icon（§85 線性 icon）。 */
  icon?: React.ReactNode;
  /**
   * 狀態不可只靠顏色傳達（§47）。當 pill 的文字本身沒說出語意時，
   * 用這個補一段只給 screen reader 的說明。
   */
  srLabel?: string;
}

export const Pill = React.forwardRef<HTMLSpanElement, PillProps>(function Pill(
  { tone, size, icon, srLabel, className, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(pillVariants({ tone, size }), className)} {...props}>
      {icon != null ? (
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
      {srLabel != null ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
});

/** `Pill` 的小尺寸別名 —— 計數、tag、版本號等。 */
export const Badge = React.forwardRef<HTMLSpanElement, PillProps>(function Badge(
  { size = 'sm', ...props },
  ref,
) {
  return <Pill ref={ref} size={size} {...props} />;
});
