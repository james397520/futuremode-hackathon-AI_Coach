/**
 * Progress / StepProgress — spec §29 Document Processing Visual、§17 9-step wizard、
 * §44 Loading States（`Embedding 68%` / `Preparing local AI 64%`）、§47（ARIA progressbar）。
 *
 * `Progress`      單一進度線，細軌 + 小面積漸層填充。
 * `StepProgress`  多段式流程：segmented bar + 步驟清單（✓ / ○），
 *                 vertical 給 document pipeline，horizontal 給 wizard。
 *
 * 這裡不放任何流程名稱（Validation / Embedding…）——那些字串屬於 apps/web。
 */
import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { Check, Circle, X } from 'lucide-react';

import { cn } from '../lib/cn';

/**
 * §46 quota / usage bar 需要「接近上限」的警示色，所以 tone 除了進度用的
 * ai / success 之外，也提供 warning / danger。`default` 是 `neutral` 的別名。
 * 警示色一律單色不做漸層（§99：漸層只用在小面積強調）。
 */
export type ProgressTone = 'ai' | 'success' | 'neutral' | 'default' | 'warning' | 'danger';

const toneFill: Record<ProgressTone, string> = {
  ai: '[background-image:linear-gradient(90deg,var(--accent-indigo),var(--accent-blue)_58%,var(--accent-mint))]',
  success: '[background-image:linear-gradient(90deg,var(--accent-mint),var(--accent-cyan))]',
  neutral: 'bg-[color:color-mix(in_srgb,var(--text-secondary)_55%,transparent)]',
  default: 'bg-[color:color-mix(in_srgb,var(--text-secondary)_55%,transparent)]',
  warning: 'bg-state-warning',
  danger: 'bg-state-danger',
};

const trackClass = 'relative w-full overflow-hidden rounded-pill bg-[color:color-mix(in_srgb,var(--text-tertiary)_20%,transparent)]';

export interface ProgressProps
  extends Omit<React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>, 'value' | 'max'> {
  /** 0–max。傳 `null` 表示 indeterminate（§44 AI thinking）。 */
  value?: number | null;
  max?: number;
  /** 左側標籤，例如 `Embedding`。 */
  label?: React.ReactNode;
  /** 右側數值，預設顯示百分比。 */
  valueLabel?: React.ReactNode;
  tone?: ProgressTone;
  size?: 'sm' | 'md';
  /** 沒有可見 label 時必填（§47 screen reader labels）。 */
  'aria-label'?: string;
}

export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(function Progress(
  { value = null, max = 100, label, valueLabel, tone = 'ai', size = 'sm', className, ...props },
  ref,
) {
  const safeMax = max > 0 ? max : 100;
  const indeterminate = value === null || value === undefined;
  const clamped =
    value === null || value === undefined ? 0 : Math.min(Math.max(value, 0), safeMax);
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label != null || valueLabel != null ? (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-body-sm font-medium text-text-secondary">{label}</span>
          <span className="tabular-nums text-meta text-text-tertiary">
            {valueLabel ?? (indeterminate ? null : `${percent}%`)}
          </span>
        </div>
      ) : null}

      <ProgressPrimitive.Root
        ref={ref}
        value={indeterminate ? null : clamped}
        max={safeMax}
        className={cn(trackClass, size === 'sm' ? 'h-1' : 'h-1.5')}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full w-full rounded-pill',
            toneFill[tone],
            indeterminate
              ? 'animate-pulse motion-reduce:animate-none'
              : 'transition-transform duration-500 ease-out-soft motion-reduce:transition-none',
          )}
          style={{ transform: indeterminate ? undefined : `translateX(-${100 - percent}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  );
});

export type StepStatus = 'complete' | 'active' | 'pending' | 'error';

export interface StepProgressStep {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  /**
   * 每步狀態。省略時由 `StepProgress` 的 `current` index 推導
   * （index < current → complete、= current → active、> current → pending），
   * 這樣 wizard（§17）只要給 `current` 就好，不必自己算每一步。
   */
  status?: StepStatus;
}

export interface StepProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  steps: readonly StepProgressStep[];
  /**
   * 目前所在步驟的 index（0-based）。用來推導沒有顯式 `status` 的步驟。
   * §17 的 9-step wizard 與 §33 的流程都只需要這一個數字。
   */
  current?: number;
  /** vertical = pipeline 清單（§29）；horizontal = wizard 步驟條（§17）。 */
  orientation?: 'vertical' | 'horizontal';
  /** 標題，例如 `Document Processing`。 */
  title?: React.ReactNode;
  /** 顯示 `4 / 6`（§29）。 */
  showCount?: boolean;
  /** 沒有可見 title 時必填。 */
  'aria-label'?: string;
}

const statusDot: Record<StepStatus, string> = {
  complete:
    'border-transparent text-white [background-image:linear-gradient(120deg,var(--accent-mint),var(--accent-cyan))]',
  active:
    'border-transparent text-white [background-image:linear-gradient(120deg,var(--accent-indigo),var(--accent-blue))] ' +
    '[box-shadow:0_0_0_4px_color-mix(in_srgb,var(--accent-blue)_14%,transparent)]',
  pending: 'border-border-soft bg-glass-strong text-text-tertiary',
  error:
    'border-[color:color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_12%,transparent)] text-[color:var(--danger)]',
};

const segmentFill: Record<StepStatus, string> = {
  complete: '[background-image:linear-gradient(90deg,var(--accent-mint),var(--accent-cyan))]',
  active: '[background-image:linear-gradient(90deg,var(--accent-indigo),var(--accent-blue))]',
  pending: 'bg-[color:color-mix(in_srgb,var(--text-tertiary)_18%,transparent)]',
  error: 'bg-[color:color-mix(in_srgb,var(--danger)_45%,transparent)]',
};

function StepIcon({ status }: { status: StepStatus }): React.ReactElement {
  if (status === 'complete') return <Check aria-hidden className="size-3" />;
  if (status === 'error') return <X aria-hidden className="size-3" />;
  if (status === 'active') return <Circle aria-hidden className="size-1.5 fill-current" />;
  return <Circle aria-hidden className="size-1.5" />;
}

export const StepProgress = React.forwardRef<HTMLDivElement, StepProgressProps>(
  function StepProgress(
    { steps, current, orientation = 'vertical', title, showCount = true, className, ...props },
    ref,
  ) {
    /**
     * 把 `status` 補齊：顯式給的優先，否則從 `current` 推導。
     * 兩者都沒有時全部視為 pending（呼叫端還沒開始這個流程）。
     */
    const resolved = React.useMemo(
      () =>
        steps.map((step, i) => {
          const status: StepStatus =
            step.status ??
            (current === undefined
              ? 'pending'
              : i < current
                ? 'complete'
                : i === current
                  ? 'active'
                  : 'pending');
          return { ...step, status };
        }),
      [steps, current],
    );
    const completed = resolved.filter((step) => step.status === 'complete').length;

    return (
      <div
        ref={ref}
        role="group"
        aria-label={props['aria-label'] ?? (typeof title === 'string' ? title : undefined)}
        className={cn('flex w-full flex-col gap-3', className)}
        {...props}
      >
        {title != null || showCount ? (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-card-title text-text-primary">{title}</span>
            {showCount ? (
              <span className="tabular-nums text-meta text-text-tertiary">
                {completed} / {steps.length}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* segmented bar — 取代單一長條，直接對映步驟數（§29） */}
        <div
          className="flex w-full items-center gap-1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={completed}
        >
          {resolved.map((step) => (
            <span
              key={step.id}
              className={cn('h-1 flex-1 rounded-pill', segmentFill[step.status])}
            />
          ))}
        </div>

        <ol
          className={cn(
            'flex list-none gap-x-4 gap-y-2 p-0',
            orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap items-start',
          )}
        >
          {resolved.map((step) => (
            <li
              key={step.id}
              aria-current={step.status === 'active' ? 'step' : undefined}
              className={cn(
                'flex items-start gap-2.5',
                orientation === 'horizontal' && 'min-w-[8rem] flex-1',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-pill border',
                  statusDot[step.status],
                )}
              >
                <StepIcon status={step.status} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn(
                    'text-body-sm',
                    step.status === 'pending' ? 'text-text-tertiary' : 'text-text-primary',
                    step.status === 'active' && 'font-semibold',
                  )}
                >
                  {step.label}
                </span>
                {step.description != null ? (
                  <span className="text-meta text-text-tertiary">{step.description}</span>
                ) : null}
                {/* §47 no color-only status */}
                <span className="sr-only">{step.status}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  },
);

/**
 * `Progress` 的別名。§29 的文件處理管線條在呼叫端習慣叫 `ProgressBar`，
 * 兩個名字指向同一個元件，避免同功能兩份實作。
 */
export const ProgressBar = Progress;
export type ProgressBarProps = ProgressProps;
