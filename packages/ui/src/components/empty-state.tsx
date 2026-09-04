/**
 * EmptyState — spec §45 Empty State / §2 Dot Matrix。
 *
 * §45 明確要求：**不要大插畫**。只要 outline icon + 一句話 + 一顆主要按鈕。
 * §2 允許 dot matrix 出現在 Knowledge Base 空狀態，因此背景用 design-tokens 的
 * `.dot-matrix`（已內含 mask 漸隱，不會整片鋪滿）。
 *
 * 前置條件：host app 需 import `@ai-coach/design-tokens/aurora.css`
 * 才會有 `.dot-matrix` 這個 class。
 */
import * as React from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** outline icon（§85 線性、18–20px；這裡容器會放大到 20px）。 */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** 一句話說明（§45）。 */
  description?: React.ReactNode;
  /** 主要動作（建議只有一顆）。 */
  action?: React.ReactNode;
  /** 次要動作（例如 "Learn more"）。 */
  secondaryAction?: React.ReactNode;
  /** `card` 自帶玻璃卡外框；`plain` 讓外層卡片自己處理。 */
  surface?: 'card' | 'plain';
  /** 是否顯示 dot matrix 背景（§2：禁止整頁鋪滿，只在空狀態這種局部使用）。 */
  dotMatrix?: boolean;
  size?: 'sm' | 'md';
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  {
    icon,
    title,
    description,
    action,
    secondaryAction,
    surface = 'card',
    dotMatrix = true,
    size = 'md',
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'relative flex w-full flex-col items-center justify-center overflow-hidden text-center',
        size === 'sm' ? 'gap-3 px-5 py-8' : 'gap-4 px-6 py-14',
        surface === 'card' &&
          'rounded-card border border-border-soft bg-glass-strong backdrop-blur-card',
        className,
      )}
      {...props}
    >
      {dotMatrix ? (
        <span
          aria-hidden
          className="dot-matrix pointer-events-none absolute inset-0 opacity-80"
        />
      ) : null}

      <div className="relative flex flex-col items-center gap-4">
        {icon != null ? (
          <span
            aria-hidden
            className={cn(
              'inline-flex items-center justify-center rounded-card-sm border border-border-glass bg-glass-card',
              'text-text-tertiary backdrop-blur-card',
              '[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
              size === 'sm' ? 'size-10 [&_svg]:size-[18px]' : 'size-12 [&_svg]:size-5',
            )}
          >
            {icon}
          </span>
        ) : null}

        <div className="flex max-w-md flex-col gap-1.5">
          <p className={cn('text-text-primary', size === 'sm' ? 'text-card-title' : 'text-section')}>
            {title}
          </p>
          {description != null ? (
            <p className="text-body text-text-secondary">{description}</p>
          ) : null}
        </div>

        {children}

        {action != null || secondaryAction != null ? (
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {action}
            {secondaryAction}
          </div>
        ) : null}
      </div>
    </div>
  );
});
