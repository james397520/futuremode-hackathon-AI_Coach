/**
 * Field — 表單欄位包裝（spec §47 Accessibility / §34 Persona Builder / §44 Settings）。
 *
 * 負責 label ↔ control 的 id 關聯、hint / error 的 aria-describedby，
 * 以及錯誤狀態的 aria-invalid，讓呼叫端不用每次自己配 id。
 *
 * 用法：
 * ```tsx
 * <Field label="Persona name" hint="學員會看到這個名字">
 *   <Input placeholder="陳先生" />
 * </Field>
 * ```
 * 子元素若是單一 React element，會自動注入 `id` / `aria-describedby` /
 * `aria-invalid`；多個子元素時請自行處理（此時只渲染 label 與訊息）。
 */
import * as React from 'react';

import { cn } from '../lib/cn';

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  label?: React.ReactNode;
  /** 輔助說明，永遠顯示。 */
  hint?: React.ReactNode;
  /** 錯誤訊息。給定時視為錯誤狀態並蓋掉 hint 的位置。 */
  error?: React.ReactNode;
  /** 右上角的次要資訊，例如 "Optional" 或字數。 */
  aside?: React.ReactNode;
  required?: boolean;
  /** 指定 control id；未給時自動產生。 */
  htmlFor?: string;
  children?: React.ReactNode;
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(function Field(
  { label, hint, error, aside, required, htmlFor, className, children, ...props },
  ref,
) {
  const rawId = React.useId();
  const domId = rawId.replace(/:/g, '');
  const controlId = htmlFor ?? `field-${domId}`;
  const hintId = hint != null ? `${controlId}-hint` : undefined;
  const errorId = error != null ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  // 單一 element 子節點：注入無障礙關聯，呼叫端不必自己配 id。
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: (children.props as Record<string, unknown>).id ?? controlId,
        'aria-describedby':
          (children.props as Record<string, unknown>)['aria-describedby'] ?? describedBy,
        'aria-invalid':
          (children.props as Record<string, unknown>)['aria-invalid'] ??
          (error != null ? true : undefined),
      })
    : children;

  return (
    <div ref={ref} className={cn('flex flex-col gap-1.5', className)} {...props}>
      {label != null || aside != null ? (
        <div className="flex items-baseline justify-between gap-3">
          {label != null ? (
            <label htmlFor={controlId} className="text-body-sm font-medium text-text-primary">
              {label}
              {required === true ? (
                <>
                  <span aria-hidden className="ml-0.5 text-state-danger">
                    *
                  </span>
                  <span className="sr-only"> (required)</span>
                </>
              ) : null}
            </label>
          ) : (
            <span />
          )}
          {aside != null ? <span className="text-meta text-text-tertiary">{aside}</span> : null}
        </div>
      ) : null}

      {control}

      {error != null ? (
        <p id={errorId} role="alert" className="text-meta text-state-danger">
          {error}
        </p>
      ) : hint != null ? (
        <p id={hintId} className="text-meta text-text-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
