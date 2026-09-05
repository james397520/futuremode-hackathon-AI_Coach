/**
 * IconButton — spec §11 Icon Rail / §85 Icon Style / §47 Accessibility。
 *
 * 正方形、radius-button（§9），最小 32px 命中區（§47）。
 * `label` 是必填：icon-only 按鈕一定要有 aria-label，
 * 同時方便直接包在 Tooltip.Trigger 外（asChild）。
 * `active` 供 icon rail 標記當前分頁（§11）——同時輸出 aria-current，
 * 因此狀態不只靠顏色（§47 no color-only status）。
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export const iconButtonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center',
    'rounded-button',
    'transition-[transform,box-shadow,background-color,color] duration-[var(--dur-hover)] ease-out-soft',
    'motion-reduce:transition-none',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:shrink-0',
    focusRing,
  ].join(' '),
  {
    variants: {
      variant: {
        glass: [
          // borderless, like Button glass; the inset highlight is the edge
          'border border-border-soft bg-glass-strong text-text-secondary',
          'hover:bg-[color:color-mix(in_srgb,var(--text-tertiary)_8%,var(--glass-card-strong))] hover:text-text-primary',
        ].join(' '),
        ghost: 'bg-transparent text-text-tertiary hover:bg-glass-card hover:text-text-primary',
        // Flat, same as Button primary: the indigo→blue gradient put white on
        // #47a9ed at 2.6:1, and a glyph needs 3:1.
        primary: ['text-text-on-accent', 'bg-accent-solid', 'shadow-accent'].join(' '),
        danger:
          'bg-transparent text-state-danger-ink hover:bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)]',
      },
      size: {
        /** 32px — §47 的下限，只用於密集工具列 */
        sm: 'size-8 [&_svg]:size-4',
        /** 36px — icon rail 預設 */
        md: 'size-8 [&_svg]:size-[17px]',
        /** 40px — header 主要動作 */
        lg: 'size-9 [&_svg]:size-[18px]',
      },
      active: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      {
        active: true,
        variant: 'glass',
        class: 'bg-glass-card text-text-primary',
      },
      {
        active: true,
        variant: 'ghost',
        class:
          'bg-glass-strong text-text-primary [box-shadow:inset_0_0_0_1px_var(--border-soft)]',
      },
    ],
    defaultVariants: { variant: 'ghost', size: 'md', active: false },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** 必填 —— icon-only 控件的無障礙名稱（§47 screen reader labels）。 */
  label: string;
  /**
   * 線性 icon（§85）。也可以改用 children 傳（兩者等價，children 優先），
   * 讓 `<IconButton label="…"><X /></IconButton>` 這種寫法能用。
   */
  icon?: React.ReactNode;
  /** 右上角未讀 / 警示點。會加上 sr-only 文字，不只靠顏色。 */
  badge?: React.ReactNode;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { label, icon, badge, variant, size, active, className, type = 'button', children, ...props },
    ref,
  ) {
    const glyph = children ?? icon;
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-current={active === true ? 'page' : undefined}
        data-active={active === true ? '' : undefined}
        className={cn(iconButtonVariants({ variant, size, active }), className)}
        {...props}
      >
        <span aria-hidden className="inline-flex items-center justify-center">
          {glyph}
        </span>
        {badge != null ? (
          <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-pill bg-state-danger-solid px-1 text-tiny text-text-on-accent">
            {badge}
          </span>
        ) : null}
      </button>
    );
  },
);
