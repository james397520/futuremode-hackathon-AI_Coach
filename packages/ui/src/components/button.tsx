/**
 * Button — spec §9 Radius（small button 12px）/ §43 Hover / §47 Accessibility。
 *
 * variant：
 *  - `primary` indigo → blue 柔和漸層（小面積，§86/§99）
 *  - `glass`   §3.3 strong surface，次要主操作
 *  - `ghost`   無底，用於工具列 / 表格列內操作
 *  - `danger`  destructive，單色不做滿版漸層
 *
 * 所有尺寸的高度 ≥ 32px（§47 hit target）。
 */
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2',
    'rounded-button font-medium tracking-[-0.005em]',
    'transition-[transform,box-shadow,background-color,color] duration-[var(--dur-hover)] ease-out-soft',
    'motion-reduce:transition-none',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    focusRing,
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'text-white',
          // Flat, not a gradient: the product owner asked for it, and a solid
          // fill also reads more clearly as one tappable target at small sizes.
          'bg-accent-indigo',
          '[box-shadow:0_10px_24px_color-mix(in_srgb,var(--accent-indigo)_24%,transparent)]',
          'hover:-translate-y-px',
          'hover:[box-shadow:0_14px_30px_color-mix(in_srgb,var(--accent-indigo)_30%,transparent)]',
          'motion-reduce:hover:translate-y-0',
        ].join(' '),
        glass: [
          'border border-border-glass bg-glass-strong text-text-primary backdrop-blur-card',
          '[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
          'hover:-translate-y-px hover:bg-glass-card',
          'motion-reduce:hover:translate-y-0',
        ].join(' '),
        ghost: 'bg-transparent text-text-secondary hover:bg-glass-card hover:text-text-primary',
        /** `secondary` 是 `glass` 的語意別名（兩個接縫檔都用這個名字）。 */
        secondary: [
          'border border-border-glass bg-glass-strong text-text-primary backdrop-blur-card',
          '[box-shadow:var(--shadow-soft),var(--shadow-inset-hi)]',
          'hover:-translate-y-px hover:bg-glass-card',
          'motion-reduce:hover:translate-y-0',
        ].join(' '),
        /** `subtle`：比 ghost 再輕一階，用於卡片內的低權重操作。 */
        subtle: [
          'bg-[color:color-mix(in_srgb,var(--text-tertiary)_10%,transparent)] text-text-secondary',
          'hover:bg-[color:color-mix(in_srgb,var(--text-tertiary)_16%,transparent)] hover:text-text-primary',
        ].join(' '),
        danger: [
          'bg-state-danger text-white',
          '[box-shadow:0_10px_24px_color-mix(in_srgb,var(--danger)_22%,transparent)]',
          'hover:-translate-y-px',
          'motion-reduce:hover:translate-y-0',
        ].join(' '),
      },
      size: {
        sm: 'h-8 px-3 text-body-sm',
        md: 'h-10 px-4 text-body',
        lg: 'h-12 px-5 text-body',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'glass', size: 'md', fullWidth: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 顯示 spinner、鎖住互動並設定 aria-busy（§44 Loading States）。 */
  loading?: boolean;
  /** loading 時給 screen reader 的說明。 */
  loadingLabel?: string;
  /** 前置 icon（§85 線性 icon）。 */
  leadingIcon?: React.ReactNode;
  /** 後置 icon。 */
  trailingIcon?: React.ReactNode;
  /**
   * Radix `asChild` 慣例（§48.2 要求使用 Radix primitives）：把 button skin 套到
   * 唯一的子元素上，例如渲染成真正的 `<Link>` anchor 而不是巢狀 button。
   *
   * 注意：asChild 時 `loading` / `leadingIcon` / `trailingIcon` 不生效——
   * Slot 只能有單一子元素，包 wrapper 會破壞 prop 合併。
   */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    fullWidth,
    loading = false,
    loadingLabel = 'Loading',
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    type = 'button',
    asChild = false,
    ...props
  },
  ref,
) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (asChild) {
    // Slot 需要單一子元素：不加 span / icon wrapper，也不下發 button-only 屬性。
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
          <span className="sr-only">{loadingLabel}</span>
        </>
      ) : (
        leadingIcon
      )}
      {children != null ? <span className="truncate">{children}</span> : null}
      {!loading && trailingIcon ? trailingIcon : null}
    </button>
  );
});
