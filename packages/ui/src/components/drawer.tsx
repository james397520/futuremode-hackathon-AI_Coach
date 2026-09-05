/**
 * Drawer — 側邊滑出面板（spec §81 Notification panel / §46 Responsive）。
 *
 * 建在 Radix Dialog 之上（拿到 focus trap、Esc、scroll lock、a11y），
 * 但視覺是貼邊的玻璃長條，不是居中 modal。
 *
 * §46：1024–1199 時右側 Persona 欄改為可收合 drawer，就用這個元件。
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../lib/cn';
import { glassSurface } from './glass-card';
import { IconButton } from './icon-button';

export const DrawerRoot = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export interface DrawerProps {
  open: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
  /** 貼哪一邊滑出。 */
  side?: 'right' | 'left';
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  /** 面板寬度；預設 380px，小螢幕自動改為滿寬。 */
  width?: number | string;
  children?: React.ReactNode;
  className?: string;
  /** 關閉鈕的無障礙名稱。 */
  closeLabel?: string;
}

export function Drawer({
  open,
  onClose,
  onOpenChange,
  side = 'right',
  title,
  description,
  footer,
  width = 380,
  children,
  className,
  closeLabel = '關閉面板',
}: DrawerProps) {
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (!next) onClose?.();
    },
    [onOpenChange, onClose],
  );

  return (
    <DrawerRoot open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* same scrim as Modal (was a hardcoded #000 mix); lighter blur so the page behind a side panel stays readable */}
        <DialogPrimitive.Overlay
          className={cn('fixed inset-0 z-50', glassSurface.scrim, 'backdrop-blur-[4px]')}
        />
        <DialogPrimitive.Content
          style={{ width: typeof width === 'number' ? `${width}px` : width }}
          className={cn(
            'fixed z-50 flex max-w-full flex-col gap-4 p-5',
            'inset-y-safe',
            side === 'right' ? 'right-safe rounded-panel' : 'left-safe rounded-panel',
            glassSurface.overlay,
            'max-sm:inset-x-safe max-sm:!w-auto',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              {title != null ? (
                <DialogPrimitive.Title className="text-card-title text-text-primary">
                  {title}
                </DialogPrimitive.Title>
              ) : (
                // Radix 要求 Content 內必有 Title 才不會發 a11y 警告。
                <DialogPrimitive.Title className="sr-only">{closeLabel}</DialogPrimitive.Title>
              )}
              {description != null ? (
                <DialogPrimitive.Description className="text-body-sm text-text-secondary">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} variant="ghost" size="sm" icon={<X />} />
            </DialogPrimitive.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer != null ? (
            <div className="flex items-center justify-end gap-2 border-t border-border-soft pt-4">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DrawerRoot>
  );
}
