/**
 * GradientPill — spec §86 / §82 / §87（"Status 使用 pastel gradient pill"）。
 *
 * 設計約束：
 *  - **只做小面積漸層**。§99 禁止大面積 purple gradient 與 gradient text，
 *    所以這個元件刻意沒有 lg / block 尺寸，也不吃 children 以外的版面。
 *  - `ai` / `success` 使用 indigo → cyan → mint 漸層（§82）。
 *  - `warning` / `danger` 依 §82 使用「淡 amber / 淡紅」的低透明度 tint + 有色文字，
 *    不做滿版紅，維持 AA 對比。
 *  - `neutral` 落回 glass strong surface，避免「每張卡片不同顏色」（§99）。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';
import { AiSparkle } from './sparkle';

export type GradientPillTone = 'ai' | 'success' | 'warning' | 'danger' | 'neutral';

export const gradientPillVariants = cva(
  'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-pill align-middle',
  {
    variants: {
      tone: {
        ai:
          'text-white [background-image:linear-gradient(120deg,var(--accent-indigo),var(--accent-cyan)_54%,var(--accent-mint))] ' +
          '[box-shadow:0_6px_16px_color-mix(in_srgb,var(--accent-indigo)_22%,transparent)]',
        success:
          'text-white [background-image:linear-gradient(120deg,var(--accent-mint),var(--accent-cyan))] ' +
          '[box-shadow:0_6px_16px_color-mix(in_srgb,var(--accent-mint)_22%,transparent)]',
        warning:
          'border text-[color:var(--warning)] ' +
          'bg-[color:color-mix(in_srgb,var(--warning)_16%,transparent)] ' +
          'border-[color:color-mix(in_srgb,var(--warning)_30%,transparent)]',
        danger:
          'border text-[color:var(--danger)] ' +
          'bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)] ' +
          'border-[color:color-mix(in_srgb,var(--danger)_28%,transparent)]',
        neutral: 'border border-border-soft bg-glass-strong text-text-secondary',
      },
      size: {
        xs: 'h-5 px-2 text-tiny',
        sm: 'h-6 px-2.5 text-meta',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'sm' },
  },
);

export interface GradientPillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof gradientPillVariants> {
  /** §86 前置 ✦，用於 AI 產生的狀態（Transcript ready / AI insight…）。 */
  sparkle?: boolean;
  /** 自訂前置 icon（§85：線性 icon、18–20px；pill 內建議 12–14px）。 */
  icon?: React.ReactNode;
  /**
   * §47「no color-only status」：狀態不能只靠顏色傳達。
   * 這裡的 children 就是文字標籤，另外可補一段只給 screen reader 的說明。
   */
  srLabel?: string;
}

export const GradientPill = React.forwardRef<HTMLSpanElement, GradientPillProps>(
  function GradientPill({ tone, size, sparkle, icon, srLabel, className, children, ...props }, ref) {
    const sparkleTone = tone === 'ai' || tone === 'success' ? 'current' : 'gradient';

    return (
      <span
        ref={ref}
        className={cn(gradientPillVariants({ tone, size }), className)}
        {...props}
      >
        {sparkle ? <AiSparkle size={size === 'xs' ? 11 : 12} tone={sparkleTone} /> : null}
        {icon ? (
          <span aria-hidden className="inline-flex shrink-0 items-center [&_svg]:size-3">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
        {srLabel ? <span className="sr-only">{srLabel}</span> : null}
      </span>
    );
  },
);
