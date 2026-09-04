/**
 * SegmentedControl — spec §6 Theme Mode（Light / Dark / System）與各種二三選一切換。
 *
 * 用 radiogroup 語意 + 鍵盤方向鍵操作；選中的段是小面積柔和漸層（§86），
 * 不用實心高飽和色塊（§99）。
 */
import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRingTight } from '../lib/focus-ring';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** 只給 screen reader 的完整名稱（label 是縮寫時用）。 */
  srLabel?: string;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: 'sm' | 'md';
  /** icon-only 模式：不顯示文字，label 只進 aria-label。 */
  iconOnly?: boolean;
  /** radiogroup 的無障礙名稱。 */
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  size = 'md',
  iconOnly = false,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const enabled = options.filter((o) => o.disabled !== true);

  const move = (dir: 1 | -1) => {
    if (enabled.length === 0) return;
    const idx = enabled.findIndex((o) => o.value === value);
    const next = enabled[(idx + dir + enabled.length) % enabled.length];
    if (next) onValueChange(next.value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-pill border border-border-soft p-0.5',
        'bg-[color:color-mix(in_srgb,var(--text-tertiary)_8%,transparent)]',
        className,
      )}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.srLabel ?? (iconOnly && typeof o.label === 'string' ? o.label : undefined)}
            disabled={o.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            className={cn(
              'inline-flex select-none items-center justify-center gap-1.5 rounded-pill font-medium',
              'transition-colors duration-[var(--dur-hover)] ease-out-soft motion-reduce:transition-none',
              'disabled:pointer-events-none disabled:opacity-50',
              '[&_svg]:size-4 [&_svg]:shrink-0',
              size === 'sm' ? 'h-7 text-body-sm' : 'h-8 text-body',
              iconOnly ? (size === 'sm' ? 'w-7' : 'w-8') : 'px-3',
              selected
                ? [
                    'text-white',
                    '[background-image:linear-gradient(120deg,var(--accent-indigo),var(--accent-blue))]',
                    '[box-shadow:0_4px_12px_color-mix(in_srgb,var(--accent-indigo)_22%,transparent)]',
                  ].join(' ')
                : 'text-text-secondary hover:bg-glass-card hover:text-text-primary',
              focusRingTight,
            )}
          >
            {o.icon != null ? (
              <span aria-hidden className="inline-flex">
                {o.icon}
              </span>
            ) : null}
            {iconOnly ? null : o.label}
            {iconOnly && o.srLabel == null && typeof o.label !== 'string' ? (
              <span className="sr-only">{o.label}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
