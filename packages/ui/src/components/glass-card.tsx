/**
 * GlassCard — spec §3.1–§3.3 Glassmorphism / §9 Radius / §43 Hover。
 *
 * variant:
 *  - `card`     §3.2 內層玻璃卡（一般內容）
 *  - `strong`   §3.3 Strong surface（transcript / 表單 / 設定頁：必須保證文字可讀，§99）
 *  - `floating` §3.2 + shadow-floating，右側堆疊卡片用，可略微浮出容器（§14.1）
 *
 * 禁止：每張卡片不同顏色、material filled card、heavy border、8px radius（§99）。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

/**
 * 共用玻璃表面字串 —— dialog / popover / dropdown / toast 等
 * Radix portal 內容直接引用，確保所有浮層是同一套玻璃參數。
 */
export const glassSurface = {
  /** §3.2 */
  card:
    'bg-glass-card border border-border-glass backdrop-blur-card ' +
    '[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
  /** §3.3 — 密集文字一律用這層 */
  strong: 'bg-glass-strong border border-border-soft backdrop-blur-card',
  /** §3.2 + 更深的 depth */
  floating:
    'bg-glass-card border border-border-glass backdrop-blur-card ' +
    '[box-shadow:var(--shadow-floating),var(--shadow-inset-hi)]',
  /** 浮層（popover / dropdown / modal）— strong surface + floating shadow */
  overlay:
    'bg-glass-strong border border-border-glass backdrop-blur-card ' +
    '[box-shadow:var(--shadow-floating),var(--shadow-inset-hi)]',
} as const;

export const glassCardVariants = cva('relative text-text-primary', {
  variants: {
    variant: {
      card: glassSurface.card,
      strong: glassSurface.strong,
      floating: glassSurface.floating,
    },
    radius: {
      panel: 'rounded-panel',
      card: 'rounded-card',
      sm: 'rounded-card-sm',
    },
    padding: {
      none: 'p-0',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-5',
      xl: 'p-6',
    },
    /** §43 Hover：translateY -1px + shadow 微增，不做放大或變色 */
    interactive: {
      true:
        'cursor-pointer transition-[transform,box-shadow] duration-[var(--dur-hover)] ease-out-soft ' +
        'hover:-translate-y-px hover:[box-shadow:var(--shadow-floating),var(--shadow-inset-hi)] ' +
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      false: '',
    },
    /**
     * §14.1 — 大螢幕允許卡片浮出主容器 8–16px，製造參考圖右側的 depth。
     * 只在 xl 以上生效，小螢幕不做負邊界避免破版。
     */
    bleed: {
      none: '',
      right: 'z-10 xl:-mr-3 2xl:-mr-4',
      left: 'z-10 xl:-ml-3 2xl:-ml-4',
      top: 'z-10 xl:-mt-3 2xl:-mt-4',
    },
  },
  defaultVariants: {
    variant: 'card',
    radius: 'card',
    padding: 'lg',
    interactive: false,
    bleed: 'none',
  },
});

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  /** 卡片可點擊時渲染成 role=button 並帶 focus ring（§47）。 */
  asButton?: boolean;
  /**
   * `variant` 的語意別名。兩個 consumer 接縫檔都以 `tone` 稱呼這個維度
   * （見 apps/web/src/components/ui.ts），保留兩種寫法以免呼叫端到處改。
   * 同時給定時 `variant` 優先。
   */
  tone?: 'card' | 'strong' | 'floating';
  /** `tone="strong"` 的布林糖衣（§3.3 密集文字表面）。 */
  strong?: boolean;
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  {
    variant,
    tone,
    strong,
    radius,
    padding,
    interactive,
    bleed,
    asButton,
    className,
    role,
    tabIndex,
    onClick,
    ...props
  },
  ref,
) {
  const clickable = asButton === true || (interactive === true && onClick !== undefined);
  const resolvedVariant = variant ?? tone ?? (strong === true ? 'strong' : undefined);

  return (
    <div
      ref={ref}
      role={role ?? (clickable ? 'button' : undefined)}
      tabIndex={tabIndex ?? (clickable ? 0 : undefined)}
      onClick={onClick}
      className={cn(
        glassCardVariants({ variant: resolvedVariant, radius, padding, interactive, bleed }),
        clickable && focusRing,
        className,
      )}
      {...props}
    />
  );
});
