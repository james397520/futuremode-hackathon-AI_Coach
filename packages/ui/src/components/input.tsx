/**
 * Input — spec §3.3 Strong Surface / §9 Radius（input 16px）/ §47 Accessibility。
 *
 * 表單一律用 strong surface：§99 禁止「glass 卡片完全透明看不清字」，
 * 所以輸入框不是半透明玻璃，而是 --glass-card-strong。
 * Focus 用 accent-blue 低透明度 ring（見 lib/focus-ring），不做 neon outline（§99）。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export const inputVariants = cva(
  [
    'w-full min-w-0 rounded-input border bg-glass-strong text-text-primary',
    'placeholder:text-text-tertiary',
    'transition-[box-shadow,border-color] duration-[var(--dur-hover)] ease-out-soft',
    'motion-reduce:transition-none',
    'disabled:cursor-not-allowed disabled:opacity-60',
    focusRing,
  ].join(' '),
  {
    variants: {
      inputSize: {
        sm: 'h-8 px-3 text-body-sm',
        md: 'h-10 px-3.5 text-body',
        lg: 'h-12 px-4 text-body',
      },
      invalid: {
        true: 'border-[color:color-mix(in_srgb,var(--danger)_46%,transparent)]',
        false: 'border-border-soft hover:border-border-glass',
      },
    },
    defaultVariants: { inputSize: 'md', invalid: false },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** 前置線性 icon（§85），例如搜尋框的放大鏡。 */
  leadingIcon?: React.ReactNode;
  /** 後置插槽：清除鈕、單位、快捷鍵提示。 */
  trailingSlot?: React.ReactNode;
  /** 外層 wrapper class（有 icon 時才會產生 wrapper）。 */
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize, invalid, leadingIcon, trailingSlot, wrapperClassName, className, ...props },
  ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid === true ? true : props['aria-invalid']}
      className={cn(
        inputVariants({ inputSize, invalid }),
        leadingIcon != null && 'pl-10',
        trailingSlot != null && 'pr-10',
        className,
      )}
      {...props}
    />
  );

  if (leadingIcon == null && trailingSlot == null) return field;

  return (
    <div className={cn('relative flex w-full items-center', wrapperClassName)}>
      {leadingIcon != null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-3.5 inline-flex items-center text-text-tertiary [&_svg]:size-4"
        >
          {leadingIcon}
        </span>
      ) : null}
      {field}
      {trailingSlot != null ? (
        <span className="absolute right-2 inline-flex items-center text-text-tertiary [&_svg]:size-4">
          {trailingSlot}
        </span>
      ) : null}
    </div>
  );
});
