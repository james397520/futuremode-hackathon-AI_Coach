/**
 * Popover — Radix Popover + 玻璃 skin。spec §3.3 / §9 / §81（右側 floating panel）。
 *
 * 通知面板、filter panel、persona quick-edit 都用這個。
 * 面板是 overlay 玻璃；密集清單放進 ScrollArea（§84）以取得極細 scrollbar。
 */
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';
import { glassSurface } from './glass-card';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export interface PopoverContentProps
  extends React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> {
  /** 右上角關閉鈕（floating panel 型 popover 建議開啟）。 */
  showClose?: boolean;
  closeLabel?: string;
  padding?: 'none' | 'sm' | 'md';
}

const paddingClass: Record<'none' | 'sm' | 'md', string> = {
  none: 'p-0',
  sm: 'p-2',
  md: 'p-4',
};

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(function PopoverContent(
  {
    className,
    align = 'end',
    sideOffset = 8,
    showClose = false,
    closeLabel = '關閉',
    padding = 'md',
    children,
    ...props
  },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'relative z-50 w-72 max-w-[calc(100vw_-_2_*_var(--shell-safe-area))] rounded-card',
          'text-text-primary outline-none',
          paddingClass[padding],
          glassSurface.overlay,
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <PopoverPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              'absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-button',
              'text-text-tertiary transition-colors duration-[var(--dur-hover)]',
              'hover:bg-glass-card hover:text-text-primary motion-reduce:transition-none',
              focusRing,
            )}
          >
            <X aria-hidden className="size-4" />
          </PopoverPrimitive.Close>
        ) : null}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
});
