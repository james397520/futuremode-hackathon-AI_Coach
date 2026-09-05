/**
 * StatTile — spec §13.3 KPI。
 *
 * §13.3：「不用傳統 8 張小方塊，改成大卡片 + 內部分割」。
 * 因此預設 `surface="plain"`：StatTile 是**大 GlassCard 內的一個分割區塊**，
 * 用細分隔線相鄰即可（`divider` prop），不是每個 KPI 一張獨立彩色卡（§99）。
 *
 * §99 禁止 pie chart / gauge，所以這裡只留 `sparkline` 插槽（折線 / bar 由呼叫端傳入），
 * 沒有任何圓餅或儀表外觀。
 * §47「no color-only status」：delta 一定同時有方向箭頭與文字。
 */
import * as React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '../lib/cn';
import { glassSurface } from './glass-card';

export type StatDeltaDirection = 'up' | 'down' | 'flat';
export type StatDeltaTone = 'positive' | 'negative' | 'neutral';

export interface StatDelta {
  /** 已格式化的字串，例如 `+4.2%`、`-3 pts`。 */
  value: React.ReactNode;
  direction: StatDeltaDirection;
  /**
   * 語意色。省略時 up → positive、down → negative。
   * 有些指標「上升是壞事」（例如 compliance 風險），這時要顯式指定。
   */
  tone?: StatDeltaTone;
  /** 比較基準說明，例如 `vs last week`。 */
  label?: React.ReactNode;
}

/* ink, not the display colour: --success as 13px text on light glass is 1.8:1 */
const deltaToneClass: Record<StatDeltaTone, string> = {
  positive: 'text-state-success-ink',
  negative: 'text-state-danger-ink',
  neutral: 'text-text-tertiary',
};

/** 把字串形式的 delta 正規化成 StatDelta；方向由正負號推導。 */
function normalizeDelta(delta: StatDelta | string): StatDelta {
  if (typeof delta !== 'string') return delta;
  const trimmed = delta.trim();
  const direction: StatDeltaDirection = trimmed.startsWith('+')
    ? 'up'
    : trimmed.startsWith('-') || trimmed.startsWith('\u2212')
      ? 'down'
      : 'flat';
  return { value: delta, direction };
}

function resolveTone(delta: StatDelta): StatDeltaTone {
  if (delta.tone != null) return delta.tone;
  if (delta.direction === 'up') return 'positive';
  if (delta.direction === 'down') return 'negative';
  return 'neutral';
}

function DeltaIcon({ direction }: { direction: StatDeltaDirection }): React.ReactElement {
  if (direction === 'up') return <ArrowUpRight aria-hidden className="size-3.5" />;
  if (direction === 'down') return <ArrowDownRight aria-hidden className="size-3.5" />;
  return <Minus aria-hidden className="size-3.5" />;
}

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  /** 單位 / 分母，例如 `%`、`/ 100`、`hrs`。以較小字級跟在數值後面。 */
  unit?: React.ReactNode;
  /**
   * 結構化 delta，或直接給已格式化的字串（如 `"+4.2%"` / `"-3 pts"`）。
   * 給字串時方向從正負號推導，符號不明時視為 flat。
   */
  delta?: StatDelta | string;
  /** 指標的補充說明，顯示在數值下方（小字、次要色）。 */
  hint?: React.ReactNode;
  /** 極簡趨勢圖插槽（折線 / bar）。禁止 pie / gauge（§99）。 */
  sparkline?: React.ReactNode;
  /** 右上角線性 icon。 */
  icon?: React.ReactNode;
  footer?: React.ReactNode;
  /** `plain` = 大卡片內的分割區塊（預設）；`card` = 自帶玻璃卡。 */
  surface?: 'plain' | 'card';
  /** 在左側加一條細分隔線，用於水平排列多個 tile（§13.3 內部分割）。 */
  divider?: boolean;
  size?: 'sm' | 'md';
}

export const StatTile = React.forwardRef<HTMLDivElement, StatTileProps>(function StatTile(
  {
    label,
    value,
    unit,
    delta: deltaProp,
    hint,
    sparkline,
    icon,
    footer,
    surface = 'plain',
    divider = false,
    size = 'md',
    className,
    ...props
  },
  ref,
) {
  const delta = deltaProp != null ? normalizeDelta(deltaProp) : undefined;
  const tone = delta != null ? resolveTone(delta) : 'neutral';

  return (
    <div
      ref={ref}
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-2',
        size === 'sm' ? 'p-3' : 'p-4',
        surface === 'card' && 'rounded-card border border-border-soft bg-glass-strong',
        divider && 'border-l border-border-soft',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-meta uppercase tracking-wide text-text-tertiary">
          {label}
        </span>
        {icon != null ? (
          <span aria-hidden className="shrink-0 text-text-tertiary [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span
          className={cn(
            'tabular-nums text-text-primary',
            size === 'sm' ? 'text-section' : 'text-page-title',
          )}
        >
          {value}
        </span>
        {unit != null ? <span className="text-body-sm text-text-tertiary">{unit}</span> : null}
      </div>

      {delta != null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 text-body-sm font-medium',
              deltaToneClass[tone],
            )}
          >
            <DeltaIcon direction={delta.direction} />
            {delta.value}
            <span className="sr-only">{delta.direction}</span>
          </span>
          {delta.label != null ? (
            <span className="text-meta text-text-tertiary">{delta.label}</span>
          ) : null}
        </div>
      ) : null}

      {hint != null ? <p className="text-meta text-text-tertiary">{hint}</p> : null}

      {sparkline != null ? <div className="mt-1 min-w-0">{sparkline}</div> : null}
      {footer != null ? <div className="mt-1 text-meta text-text-tertiary">{footer}</div> : null}
    </div>
  );
});
