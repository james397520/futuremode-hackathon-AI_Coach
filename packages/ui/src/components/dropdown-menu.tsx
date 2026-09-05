/**
 * DropdownMenu — Radix DropdownMenu + 玻璃 skin。spec §3.3 / §9 / §47。
 *
 * 面板是 overlay 玻璃（strong surface + floating shadow），
 * item 用 radius-button、hover 為極淡的 glass tint，
 * 不使用 shadcn 預設的實心 accent 底色（§48.2）。
 */
import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRingTight } from '../lib/focus-ring';
import { glassSurface } from './glass-card';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const panelClass = 'z-50 min-w-[11rem] overflow-hidden rounded-card-sm p-1.5';

const itemClass = [
  'relative flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-button px-2.5 py-1.5',
  'text-body text-text-secondary',
  'transition-colors duration-[var(--dur-hover)] motion-reduce:transition-none',
  'data-[highlighted]:bg-glass-card data-[highlighted]:text-text-primary',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
].join(' ');

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(panelClass, glassSurface.overlay, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export interface DropdownMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
  /** destructive 動作用低透明度紅字，不用滿版紅（§82 精神）。 */
  tone?: 'default' | 'danger';
  icon?: React.ReactNode;
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem({ tone = 'default', icon, className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        itemClass,
        tone === 'danger' &&
          'text-state-danger-ink data-[highlighted]:bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)] data-[highlighted]:text-state-danger-ink',
        focusRingTight,
        className,
      )}
      {...props}
    >
      {icon != null ? (
        <span aria-hidden className="inline-flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </DropdownMenuPrimitive.Item>
  );
});

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn(itemClass, 'pl-8', focusRingTight, className)}
      {...props}
    >
      <span className="absolute left-2.5 inline-flex items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check aria-hidden className="size-4 text-accent-ink" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      className={cn(itemClass, 'pl-8', focusRingTight, className)}
      {...props}
    >
      <span className="absolute left-2.5 inline-flex items-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle aria-hidden className="size-2 fill-current text-accent-ink" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownMenuLabel({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      ref={ref}
      className={cn('px-2.5 pb-1 pt-2 text-meta uppercase tracking-wide text-text-tertiary', className)}
      {...props}
    />
  );
});

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn('my-1 h-px bg-border-soft', className)}
      {...props}
    />
  );
});

export const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(itemClass, 'data-[state=open]:bg-glass-card', focusRingTight, className)}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <ChevronRight aria-hidden className="size-4 text-text-tertiary" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      ref={ref}
      className={cn(panelClass, glassSurface.overlay, className)}
      {...props}
    />
  );
});

/** 右側鍵盤快捷鍵提示（§78）。 */
export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.ReactElement {
  return (
    <span
      className={cn('ml-auto shrink-0 text-tiny tabular-nums text-text-tertiary', className)}
      {...props}
    />
  );
}
