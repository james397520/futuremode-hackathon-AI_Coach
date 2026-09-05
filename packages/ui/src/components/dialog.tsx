/**
 * Modal — Radix Dialog + 玻璃面板。spec §83 Modal / §3.3 / §9 / §47。
 *
 * §83：backdrop 為極淡的深色 + blur(10px)（dark mode 加深）。
 * 這裡不 hardcode rgba，改用 color-mix 從 --text-primary / --bg-canvas 推導，
 * 因此 light / dark 自動跟著 token 走（§99 禁止 hardcode 顏色）。
 *
 * 面板本身用 strong surface（表單、密集文字必須可讀）+ radius-card，
 * 描邊只有 1px、不做 heavy border。
 *
 * 進場動效不在這裡做：本 package 不含 keyframes，
 * 需要動效時由 apps/web 用 framer-motion + `motion.ts` 的 preset 包裹內容。
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';
import { glassSurface } from './glass-card';

export const ModalRoot = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalPortal = DialogPrimitive.Portal;
export const ModalClose = DialogPrimitive.Close;

export const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function ModalOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-40', glassSurface.scrim, className)}
      {...props}
    />
  );
});

const modalWidth: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface ModalContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 顯示右上角關閉鈕（預設 true）。 */
  showClose?: boolean;
  closeLabel?: string;
  /** 蓋在 overlay 之外的自訂 overlay class。 */
  overlayClassName?: string;
}

export const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ModalContentProps
>(function ModalContent(
  { size = 'md', showClose = true, closeLabel = '關閉', overlayClassName, className, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <ModalOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex w-[calc(100vw_-_2_*_var(--shell-safe-area))] -translate-x-1/2 -translate-y-1/2',
          'max-h-[calc(100vh_-_4_*_var(--shell-safe-area))] flex-col overflow-hidden rounded-card p-6',
          'text-text-primary outline-none',
          glassSurface.overlay,
          modalWidth[size],
          className,
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className={cn(
              'absolute right-4 top-4 inline-flex size-8 items-center justify-center rounded-button',
              'text-text-tertiary transition-colors duration-[var(--dur-hover)]',
              'hover:bg-glass-card hover:text-text-primary motion-reduce:transition-none',
              focusRing,
            )}
          >
            <X aria-hidden className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const ModalHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ModalHeader({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex flex-col gap-1.5 pb-4 pr-10', className)}
        {...props}
      />
    );
  },
);

export const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function ModalTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-section text-text-primary', className)}
      {...props}
    />
  );
});

export const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function ModalDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-body text-text-secondary', className)}
      {...props}
    />
  );
});

export const ModalBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ModalBody({ className, ...props }, ref) {
    return <div ref={ref} className={cn('min-h-0 flex-1 overflow-y-auto', className)} {...props} />;
  },
);

export const ModalFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function ModalFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('flex flex-wrap items-center justify-end gap-2 pt-5', className)}
        {...props}
      />
    );
  },
);

/* ────────────────────────────────────────────────────────────────────────────
 * Modal — 便利包裝（§83）
 *
 * 上面是組合式 primitives。兩個 consumer 接縫檔都約定 `Modal` 是
 * `{ open, onClose, title, children }` 的單一元件，所以這裡提供這個形狀，
 * 組合式仍以 `ModalRoot` / `ModalContent` … 對外。
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ModalProps {
  open: boolean;
  /** 任一關閉路徑（Esc、點擊 overlay、關閉鈕）都會呼叫。 */
  onClose?: () => void;
  /** Radix 原生形式；與 `onClose` 可同時給。 */
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalContentProps['size'];
  children?: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  onOpenChange,
  title,
  description,
  footer,
  size,
  children,
  className,
}: ModalProps) {
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (!next) onClose?.();
    },
    [onOpenChange, onClose],
  );

  return (
    <ModalRoot open={open} onOpenChange={handleOpenChange}>
      <ModalContent size={size} className={className}>
        {title != null || description != null ? (
          <ModalHeader>
            {title != null ? <ModalTitle>{title}</ModalTitle> : null}
            {description != null ? <ModalDescription>{description}</ModalDescription> : null}
          </ModalHeader>
        ) : null}
        <ModalBody>{children}</ModalBody>
        {footer != null ? <ModalFooter>{footer}</ModalFooter> : null}
      </ModalContent>
    </ModalRoot>
  );
}
