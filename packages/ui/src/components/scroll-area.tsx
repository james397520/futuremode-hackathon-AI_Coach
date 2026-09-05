/**
 * ScrollArea — Radix ScrollArea + §84 極細 scrollbar。
 *
 * §84：width 5px、thumb 為低透明度藍灰、radius 999px；dark mode 亮度更低。
 * 這裡用 color-mix 從 --text-secondary 推導 thumb 顏色，
 * 因此 light/dark 自動跟著 token 走，不 hardcode rgba（§99）。
 *
 * transcript / chunk list / 通知面板等長清單都應該套這個，
 * 避免出現作業系統預設的粗 scrollbar 破壞玻璃質感。
 */
import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '../lib/cn';

export const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(function ScrollBar({ className, orientation = 'vertical', ...props }, ref) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none p-0.5 transition-opacity duration-[var(--dur-hover)]',
        'motion-reduce:transition-none',
        orientation === 'vertical' ? 'h-full w-[9px] flex-col' : 'h-[9px] w-full flex-row',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className={cn(
          'relative flex-1 rounded-pill',
          'bg-[color:color-mix(in_srgb,var(--text-secondary)_24%,transparent)]',
          'hover:bg-[color:color-mix(in_srgb,var(--text-secondary)_36%,transparent)]',
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});

export interface ScrollAreaProps
  extends React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** 套在 Viewport 上的 class（例如 `p-4`）。 */
  viewportClassName?: string;
}

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  ScrollAreaProps
>(function ScrollArea(
  { className, viewportClassName, orientation = 'vertical', children, type = 'hover', ...props },
  ref,
) {
  return (
    <ScrollAreaPrimitive.Root
      ref={ref}
      type={type}
      className={cn('relative overflow-hidden', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn('size-full rounded-[inherit] [&>div]:!block', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== 'horizontal' ? <ScrollBar orientation="vertical" /> : null}
      {orientation !== 'vertical' ? <ScrollBar orientation="horizontal" /> : null}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
});
