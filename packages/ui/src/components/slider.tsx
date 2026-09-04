/**
 * Slider — Radix Slider + 玻璃 skin。
 * spec §35 Persona Personality Sliders：track 4px、selected gradient、soft glow。
 *
 * 這個元件只提供「數值滑桿」的通用行為與外觀，
 * 具體是哪些人格維度（price sensitivity / trust…）由 apps/web 提供 label，
 * 這裡不放任何業務語意。
 */
import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus-ring';

export interface SliderProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
    'children' | 'value' | 'defaultValue' | 'onValueChange'
  > {
  /**
   * 單一數值或多 thumb 陣列。Radix 只吃陣列，但 §35 的 personality sliders
   * 全部是單值，所以這裡兩種都接，回呼形狀跟著輸入形狀走。
   */
  value?: number | number[];
  defaultValue?: number | number[];
  /** 傳入單值時回單值，傳入陣列時回陣列。 */
  onValueChange?: ((value: number) => void) | ((value: number[]) => void);
  /** 左上角標籤。也會自動連到 thumb 的 aria-label。 */
  label?: React.ReactNode;
  /** 右上角顯示目前數值（§35 要求看得到數字）。 */
  showValue?: boolean;
  /** 自訂數值顯示，例如 `(v) => \`${v}%\``。 */
  formatValue?: (value: number) => string | number;
  /** label 下方的補充說明（§35 sliders 常要解釋這個維度的意思）。 */
  hint?: React.ReactNode;
  /** 軌道兩端的說明文字，例如 low / high。 */
  minLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  /** 給 screen reader 的 thumb 名稱；沒給時用 label 的字串值。 */
  thumbLabel?: string;
  className?: string;
  /** 外層 wrapper class。 */
  wrapperClassName?: string;
}

export const Slider = React.forwardRef<React.ElementRef<typeof SliderPrimitive.Root>, SliderProps>(
  function Slider(
    {
      label,
      hint,
      showValue = true,
      formatValue,
      minLabel,
      maxLabel,
      thumbLabel,
      className,
      wrapperClassName,
      min = 0,
      max = 100,
      step = 1,
      value,
      defaultValue,
      onValueChange,
      disabled,
      ...props
    },
    ref,
  ) {
    // 記住呼叫端是用單值還是陣列，回呼要用同一種形狀還回去。
    const isScalar = typeof value === 'number' || typeof defaultValue === 'number';
    const valueArray = value === undefined ? undefined : Array.isArray(value) ? value : [value];
    const defaultArray =
      defaultValue === undefined
        ? undefined
        : Array.isArray(defaultValue)
          ? defaultValue
          : [defaultValue];
    const handleValueChange = React.useCallback(
      (next: number[]) => {
        if (onValueChange === undefined) return;
        if (isScalar) (onValueChange as (v: number) => void)(next[0] ?? 0);
        else (onValueChange as (v: number[]) => void)(next);
      },
      [onValueChange, isScalar],
    );
    const [uncontrolled, setUncontrolled] = React.useState<number[]>(
      () => defaultArray ?? [min],
    );
    const current = valueArray ?? uncontrolled;

    const handleChange = React.useCallback(
      (next: number[]) => {
        if (valueArray === undefined) setUncontrolled(next);
        handleValueChange(next);
      },
      // valueArray 每次 render 都是新陣列，用它的第一個值當依賴避免無意義重建。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [valueArray === undefined, handleValueChange],
    );

    const accessibleName =
      thumbLabel ?? (typeof label === 'string' ? label : undefined);

    return (
      <div className={cn('flex w-full flex-col gap-2', wrapperClassName)}>
        {label != null || showValue ? (
          <div className="flex items-baseline justify-between gap-3">
            {label != null ? (
              <span className="text-body-sm font-medium text-text-secondary">{label}</span>
            ) : (
              <span />
            )}
            {showValue ? (
              <span className="tabular-nums text-body-sm font-semibold text-text-primary">
                {current.map((v) => (formatValue ? formatValue(v) : v)).join(' – ')}
              </span>
            ) : null}
          </div>
        ) : null}

        <SliderPrimitive.Root
          ref={ref}
          min={min}
          max={max}
          step={step}
          value={current}
          onValueChange={handleChange}
          disabled={disabled}
          className={cn(
            'relative flex w-full touch-none select-none items-center py-2.5',
            disabled === true && 'opacity-60',
            className,
          )}
          {...props}
        >
          {/* §35 track 4px */}
          <SliderPrimitive.Track
            className={cn(
              'relative h-1 w-full grow overflow-hidden rounded-pill',
              'bg-[color:color-mix(in_srgb,var(--text-tertiary)_20%,transparent)]',
            )}
          >
            <SliderPrimitive.Range
              className={cn(
                'absolute h-full rounded-pill',
                '[background-image:linear-gradient(90deg,var(--accent-indigo),var(--accent-blue)_58%,var(--accent-mint))]',
              )}
            />
          </SliderPrimitive.Track>

          {current.map((_, index) => (
            <SliderPrimitive.Thumb
              key={index}
              aria-label={
                accessibleName != null
                  ? current.length > 1
                    ? `${accessibleName} ${index + 1}`
                    : accessibleName
                  : undefined
              }
              className={cn(
                'block size-4 rounded-pill border border-border-glass bg-white',
                // §35 soft glow
                '[box-shadow:0_2px_8px_color-mix(in_srgb,var(--accent-indigo)_28%,transparent),0_0_0_5px_color-mix(in_srgb,var(--accent-blue)_10%,transparent)]',
                'transition-transform duration-[var(--dur-hover)] ease-out-soft motion-reduce:transition-none',
                'hover:scale-105 motion-reduce:hover:scale-100',
                'disabled:pointer-events-none',
                focusRing,
              )}
            />
          ))}
        </SliderPrimitive.Root>

        {minLabel != null || maxLabel != null ? (
          <div className="flex items-center justify-between text-tiny text-text-tertiary">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        ) : null}
      </div>
    );
  },
);
