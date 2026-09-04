/**
 * Switch — Radix Switch + 玻璃 skin（spec §9 Radius / §43 Motion / §47）。
 *
 * 開啟時 track 使用 indigo → blue 小面積漸層；關閉時是低對比的 token tint，
 * 不用純灰色塊。thumb 帶柔和陰影，符合參考圖的 depth。
 */
import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /** sm = 32×18、md = 40×22（外層命中區仍 ≥ 32px，§47）。 */
  switchSize?: 'sm' | 'md';
  /**
   * 給定時渲染成 `<label>` 包住 switch，文字與控件正確關聯（§47）——
   * 不需要呼叫端自己配 id/htmlFor。整個 label 都是命中區。
   */
  label?: React.ReactNode;
  /** label 下方的補充說明。 */
  hint?: React.ReactNode;
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ switchSize = 'md', label, hint, className, ...props }, ref) {
  const sm = switchSize === 'sm';

  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'group relative inline-flex shrink-0 cursor-pointer items-center rounded-pill border border-border-soft',
        'transition-colors duration-[var(--dur-hover)] ease-out-soft motion-reduce:transition-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=unchecked]:bg-[color:color-mix(in_srgb,var(--text-tertiary)_22%,transparent)]',
        'data-[state=checked]:border-transparent',
        'data-[state=checked]:[background-image:linear-gradient(120deg,var(--accent-indigo),var(--accent-blue))]',
        sm ? 'h-[18px] w-8' : 'h-[22px] w-10',
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block rounded-pill bg-white',
          '[box-shadow:0_2px_6px_color-mix(in_srgb,var(--text-primary)_18%,transparent)]',
          'transition-transform duration-[var(--dur-hover)] ease-out-soft motion-reduce:transition-none',
          sm
            ? 'size-3.5 translate-x-0.5 data-[state=checked]:translate-x-[15px]'
            : 'size-[18px] translate-x-0.5 data-[state=checked]:translate-x-[19px]',
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (label == null) return control;

  return (
    <label className="flex min-h-8 cursor-pointer items-center justify-between gap-4">
      <span className="flex flex-col gap-0.5">
        <span className="text-body text-text-primary">{label}</span>
        {hint != null ? <span className="text-meta text-text-tertiary">{hint}</span> : null}
      </span>
      {control}
    </label>
  );
});
