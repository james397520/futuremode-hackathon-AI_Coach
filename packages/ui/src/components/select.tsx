/**
 * Select — Radix Select（行為）+ 自訂玻璃 skin（spec §3.2/§3.3, §9, §47）。
 *
 * 下拉面板使用 overlay 玻璃（strong surface + floating shadow），
 * 確保選項文字可讀（§99），並用 radius-card-sm、細描邊，不做 heavy border。
 */
import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRing, focusRingTight } from '../lib/focus-ring';
import { glassSurface } from './glass-card';

export const SelectRoot = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  /** 與 Input 對齊的三種高度。 */
  triggerSize?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
}

const triggerSizeClass: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-3.5 text-body',
  lg: 'h-12 px-4 text-body',
};

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ triggerSize = 'md', invalid = false, className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-input border bg-glass-strong',
        'text-text-primary transition-[box-shadow,border-color] duration-[var(--dur-hover)] ease-out-soft',
        'motion-reduce:transition-none',
        'data-[placeholder]:text-text-tertiary',
        'disabled:cursor-not-allowed disabled:opacity-60',
        triggerSizeClass[triggerSize],
        invalid
          ? 'border-[color:color-mix(in_srgb,var(--danger-ink)_55%,transparent)]'
          : 'border-border-soft hover:border-[color:color-mix(in_srgb,var(--text-tertiary)_45%,transparent)]',
        focusRing,
        className,
      )}
      aria-invalid={invalid ? true : undefined}
      {...props}
    >
      <span className="min-w-0 truncate text-left">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-text-tertiary" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

const scrollButtonClass =
  'flex h-6 cursor-default items-center justify-center text-text-tertiary';

export const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton ref={ref} className={cn(scrollButtonClass, className)} {...props}>
      <ChevronUp aria-hidden className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
});

export const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      ref={ref}
      className={cn(scrollButtonClass, className)}
      {...props}
    >
      <ChevronDown aria-hidden className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
});

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', sideOffset = 6, ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        className={cn(
          'relative z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]',
          'overflow-hidden rounded-card-sm p-1.5',
          glassSurface.overlay,
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-0.5">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn('px-2.5 pb-1 pt-2 text-meta uppercase tracking-wide text-text-tertiary', className)}
      {...props}
    />
  );
});

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex min-h-8 w-full cursor-pointer select-none items-center gap-2 rounded-button',
        'py-1.5 pl-2.5 pr-8 text-body text-text-secondary',
        'transition-colors duration-[var(--dur-hover)] motion-reduce:transition-none',
        'data-[highlighted]:bg-glass-card data-[highlighted]:text-text-primary',
        'data-[state=checked]:text-text-primary',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        focusRingTight,
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center">
        <Check aria-hidden className="size-4 text-accent-ink" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn('my-1 h-px bg-border-soft', className)}
      {...props}
    />
  );
});

/* ────────────────────────────────────────────────────────────────────────────
 * Select — 便利包裝
 *
 * 上面是 Radix 組合式 primitives（需要自訂 item 內容時用）。絕大多數呼叫端
 * 只需要「一個 value + 一份選項」，所以 `Select` 直接吃 `options`，
 * 對齊 apps/web 與 simulation 兩個接縫檔的契約。
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  /** 放寬成 `(value: string) => void`，讓呼叫端可以直接接窄化過的 setState。 */
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  invalid?: boolean;
  className?: string;
  /** trigger 的無障礙名稱（沒有可見 label 時必填，§47）。 */
  ariaLabel?: string;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled,
  name,
  id,
  invalid,
  className,
  ariaLabel,
}: SelectProps) {
  return (
    <SelectRoot
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectTrigger id={id} invalid={invalid} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
}
