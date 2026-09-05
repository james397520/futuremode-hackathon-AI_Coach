/**
 * Textarea — spec §3.3 Strong Surface / §9 Radius / §47。
 *
 * 與 Input 同一套規則：strong surface 保證長文可讀（§99），
 * radius-input、低透明度 accent-blue focus ring。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export const textareaVariants = cva(
  [
    'w-full min-w-0 rounded-input border bg-glass-strong px-3.5 py-2.5',
    'text-body text-text-primary placeholder:text-text-tertiary',
    'transition-[box-shadow,border-color] duration-[var(--dur-hover)] ease-out-soft',
    'motion-reduce:transition-none',
    'disabled:cursor-not-allowed disabled:opacity-60',
    focusRing,
  ].join(' '),
  {
    variants: {
      resize: {
        none: 'resize-none',
        vertical: 'resize-y',
      },
      invalid: {
        true: 'border-[color:color-mix(in_srgb,var(--danger-ink)_55%,transparent)]',
        false: 'border-border-soft hover:border-[color:color-mix(in_srgb,var(--text-tertiary)_45%,transparent)]',
      },
    },
    defaultVariants: { resize: 'vertical', invalid: false },
  },
);

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {
  /** 右下角字數提示等輔助資訊。 */
  hint?: React.ReactNode;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { resize, invalid, hint, className, rows = 4, ...props },
  ref,
) {
  const field = (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid === true ? true : props['aria-invalid']}
      className={cn(textareaVariants({ resize, invalid }), className)}
      {...props}
    />
  );

  if (hint == null) return field;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {field}
      <span className="self-end text-meta text-text-tertiary">{hint}</span>
    </div>
  );
});
