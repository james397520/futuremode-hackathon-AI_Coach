/**
 * Tabs — Radix Tabs（行為）+ pill 型 tab strip。
 * spec §3.3 / §9 / §47（ARIA tabs 由 Radix 提供）。
 *
 * 設計決策：**沒有底線 indicator**。參考圖的分頁是「玻璃凹槽 + 選取藥丸」，
 * 底線 tab 太像一般 SaaS / shadcn 預設（§48.2 要求不套預設 theme）。
 */
import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '../lib/cn';
import { focusRingTight } from '../lib/focus-ring';

export const TabsRoot = TabsPrimitive.Root;

export interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** `inset` 是玻璃凹槽（預設）；`bare` 只留間距，用在卡片標題列。 */
  appearance?: 'inset' | 'bare';
}

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(function TabsList({ appearance = 'inset', className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto',
        appearance === 'inset' &&
          'rounded-pill border border-border-soft bg-glass-strong p-1 backdrop-blur-card',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-8 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap',
        'rounded-pill px-3.5 text-body-sm font-medium text-text-secondary',
        'transition-[background-color,color,box-shadow] duration-[var(--dur-hover)] ease-out-soft',
        'motion-reduce:transition-none',
        'hover:text-text-primary',
        'data-[state=active]:bg-glass-card data-[state=active]:text-text-primary',
        'data-[state=active]:[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        focusRingTight,
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('outline-none focus-visible:outline-none', className)}
      {...props}
    />
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 * Tabs — 便利包裝
 *
 * 上面是組合式（需要 TabsContent 分頁內容時用 `TabsRoot`）。這裡的 `Tabs`
 * 只渲染 tab strip 本身：多數頁面是用 tab 切換同一塊區域的 filter，
 * 內容自己在外面 render。對齊 apps/web 接縫檔的 `items` 契約。
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TabItem {
  value: string;
  label: React.ReactNode;
  /** 右側計數 pill（例如 filter 命中數）。 */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  /** 放寬成 string，呼叫端可安全接窄化過的 setState。 */
  onValueChange?: (value: string) => void;
  items: TabItem[];
  className?: string;
  /** tablist 的無障礙名稱（§47）。 */
  ariaLabel?: string;
  /** 分頁內容；省略時只渲染 tab strip。 */
  children?: React.ReactNode;
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  items,
  className,
  ariaLabel,
  children,
}: TabsProps) {
  return (
    <TabsRoot value={value} defaultValue={defaultValue} onValueChange={onValueChange}>
      <TabsList className={className} aria-label={ariaLabel}>
        {items.map((it) => (
          <TabsTrigger key={it.value} value={it.value} disabled={it.disabled}>
            {it.label}
            {it.count !== undefined ? (
              <span className="ml-1.5 rounded-pill bg-[color:color-mix(in_srgb,var(--text-tertiary)_16%,transparent)] px-1.5 text-tiny text-text-secondary">
                {it.count}
              </span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </TabsRoot>
  );
}
