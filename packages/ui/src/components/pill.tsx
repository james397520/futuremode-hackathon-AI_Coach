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

/**
 * 語意色一律走 tint + ink，避免實心色塊（§99）。
 *
 * 文字用 `--*-ink`，不是 `color-mix(tone 82%, text-primary)`：display 色是 pastel，
 * 混完在淺色玻璃上只有 2.0–3.1:1（12px 字需要 4.5）。ink 是同色系、可讀的那一階。
 * 沒有描邊 —— 產品方向是 borderless chips，tint 底本身就是邊界。
 */
const tint = (tone: 'success' | 'warning' | 'danger' | 'info') =>
  `bg-[color:color-mix(in_srgb,var(--${tone})_16%,transparent)] text-state-${tone}-ink`;

export const pillVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-pill font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        // pastel gradient → navy ink; white on these stops measured 1.9–2.6:1
        gradient:
          'bg-[color:color-mix(in_srgb,var(--accent-indigo)_14%,transparent)] text-accent-ink',
        neutral:
          'bg-[color:color-mix(in_srgb,var(--text-tertiary)_12%,transparent)] text-text-secondary',
        success: tint('success'),
        warning: tint('warning'),
        danger: tint('danger'),
        info: tint('info'),
        accent:
          'bg-[color:color-mix(in_srgb,var(--accent-indigo)_16%,transparent)] text-accent-ink',
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
