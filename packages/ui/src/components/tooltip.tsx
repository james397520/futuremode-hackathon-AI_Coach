/**
 * Tooltip — Radix Tooltip + 玻璃 skin。spec §3.3 / §9 / §47。
 *
 * Icon rail 與所有 icon-only 控件都應該包一層 Tooltip（§11 / §85）。
 * `Tooltip` 是薄薄的便利封裝：`<Tooltip content="…"><IconButton …/></Tooltip>`。
 * 需要完全控制時直接用 TooltipRoot / TooltipTrigger / TooltipContent。
 */
import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '../lib/cn';
import { glassSurface } from './glass-card';

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 8, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-[18rem] rounded-card-sm px-2.5 py-1.5',
          'text-meta font-medium text-text-primary',
          glassSurface.overlay,
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

export interface TooltipProps
  extends Pick<
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>,
    'open' | 'defaultOpen' | 'onOpenChange' | 'delayDuration' | 'disableHoverableContent'
  > {
  /** Tooltip 內文。null / undefined 時直接渲染 children，不掛 tooltip。 */
  content?: React.ReactNode;
  side?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['side'];
  align?: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>['align'];
  sideOffset?: number;
  contentClassName?: string;
  children: React.ReactNode;
}

export function Tooltip({
  content,
  side = 'right',
  align = 'center',
  sideOffset = 8,
  contentClassName,
  children,
  ...rootProps
}: TooltipProps): React.ReactElement {
  if (content == null || content === '') return <>{children}</>;

  // Radix 的 Tooltip.Root 需要祖先有 Provider，否則 render 直接丟
  // `Tooltip must be used within TooltipProvider`（SSR prerender 也會炸）。
  // 這裡自帶一個 Provider，讓這個元件在任何地方都能單獨使用；
  // Provider 可安全嵌套，所以 app 若已在 root 掛了一個也不衝突
  // （app 層那個仍值得掛，它讓多個 tooltip 共用 delay/skip 行為）。
  return (
    <TooltipPrimitive.Provider delayDuration={rootProps.delayDuration ?? 200}>
      <TooltipPrimitive.Root {...rootProps}>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipContent
          side={side}
          align={align}
          sideOffset={sideOffset}
          className={contentClassName}
        >
          {content}
        </TooltipContent>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
