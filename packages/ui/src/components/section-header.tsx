/**
 * SectionHeader — spec §7 Typography scale / §8 Spacing。
 *
 * 頁面標題 / 卡片區塊標題的統一寫法：eyebrow + title + description + actions。
 * `level` 同時決定語意標籤（h1/h2/h3）與字級，避免各頁自己拼 font size（§7）。
 * 標題下方不畫分隔線（§87：沒有大量 hard divider）。
 */
import * as React from 'react';

import { cn } from '../lib/cn';

export type SectionHeaderLevel = 1 | 2 | 3;

const titleClass: Record<SectionHeaderLevel, string> = {
  1: 'text-page-title',
  2: 'text-section',
  3: 'text-card-title',
};

export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 標題上方的小字（區塊分類 / breadcrumb 尾段 / 狀態 pill）。 */
  eyebrow?: React.ReactNode;
  /** 右側動作區（Button / IconButton / GradientPill…）。 */
  actions?: React.ReactNode;
  /** 1 = 頁面標題（h1）、2 = 區塊（h2）、3 = 卡片內（h3）。 */
  level?: SectionHeaderLevel;
  /** 標題左側 icon 或 avatar。 */
  leading?: React.ReactNode;
  /** 小螢幕時 actions 換行到下一列（預設 true，§46）。 */
  wrapActions?: boolean;
}

export const SectionHeader = React.forwardRef<HTMLDivElement, SectionHeaderProps>(
  function SectionHeader(
    {
      title,
      description,
      eyebrow,
      actions,
      level = 2,
      leading,
      wrapActions = true,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const Heading: 'h1' | 'h2' | 'h3' = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';

    return (
      <div
        ref={ref}
        className={cn(
          'flex w-full items-start justify-between gap-4',
          wrapActions && 'flex-wrap',
          className,
        )}
        {...props}
      >
        <div className="flex min-w-0 items-start gap-3">
          {leading != null ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
          <div className="flex min-w-0 flex-col gap-1">
            {eyebrow != null ? (
              <div className="flex items-center gap-2 text-meta uppercase tracking-wide text-text-tertiary">
                {eyebrow}
              </div>
            ) : null}
            <Heading className={cn('min-w-0 text-text-primary', titleClass[level])}>
              {title}
            </Heading>
            {description != null ? (
              <p className="max-w-2xl text-body text-text-secondary">{description}</p>
            ) : null}
            {children}
          </div>
        </div>

        {actions != null ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    );
  },
);
