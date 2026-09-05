/**
 * DataList / DataRow — spec §99（禁止 Bootstrap table）/ §87（"沒有傳統 bootstrap table 感"）/
 * §3.2 / §9 / §47。
 *
 * 這是本 package 對「表格」的唯一答案：**沒有 <table>、沒有格線、沒有斑馬紋**。
 * 每一列是一張極薄的玻璃 row，欄位用 CSS grid 對齊，欄寬由 column 定義決定。
 * 因此頁面永遠不需要寫 bordered table markup。
 *
 * 無障礙（§47）：雖然視覺上不是 table，但仍輸出 ARIA grid 語意
 * （role=table / row / columnheader / cell），讀屏可以正常橫向瀏覽欄位。
 */
import * as React from 'react';

import { cn } from '../lib/cn';
import { focusRingTight } from '../lib/focus-ring';

export type DataListAlign = 'start' | 'center' | 'end';

export interface DataListColumn<T> {
  /** 穩定的欄位 key。 */
  id: string;
  /** 表頭文字。省略時該欄不顯示標題（例如操作欄）。 */
  header?: React.ReactNode;
  /** CSS grid track，例如 `'minmax(0,2fr)'`、`'120px'`。預設 `minmax(0,1fr)`。 */
  width?: string;
  align?: DataListAlign;
  /** cell 渲染器。 */
  cell: (row: T) => React.ReactNode;
  /** 額外套在該欄 cell 與 header 上的 class。 */
  className?: string;
}

const alignClass: Record<DataListAlign, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right',
};

export interface DataRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** grid template columns。 */
  template?: string;
  interactive?: boolean;
  selected?: boolean;
  /** `header` 是表頭列（無玻璃底、只有極淡的文字）。 */
  appearance?: 'row' | 'header';
  dense?: boolean;
}

export const DataRow = React.forwardRef<HTMLDivElement, DataRowProps>(function DataRow(
  {
    template,
    interactive = false,
    selected = false,
    appearance = 'row',
    dense = false,
    className,
    style,
    ...props
  },
  ref,
) {
  const isHeader = appearance === 'header';

  return (
    <div
      ref={ref}
      role="row"
      aria-selected={interactive && !isHeader ? selected : undefined}
      data-selected={selected ? '' : undefined}
      className={cn(
        'grid w-full items-center gap-3',
        dense ? 'px-3 py-2' : 'px-4 py-3',
        isHeader
          ? 'border-b border-border-soft text-meta uppercase tracking-wide text-text-tertiary'
          : cn(
              'border-b border-border-soft bg-transparent text-body text-text-secondary last:border-b-0',
              'transition-[background-color,color] duration-[var(--dur-hover)] ease-out-soft',
              'motion-reduce:transition-none',
            ),
        !isHeader &&
          interactive &&
          cn(
            'cursor-pointer hover:bg-[color:color-mix(in_srgb,var(--text-tertiary)_7%,transparent)] hover:text-text-primary',
            focusRingTight,
          ),
        !isHeader &&
          selected &&
          // selection outline is a 3:1 graphic; pale blue @45% on light glass was ~1.5:1
          '[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--accent-ink)_80%,transparent)]',
        className,
      )}
      style={template != null ? { gridTemplateColumns: template, ...style } : style}
      {...props}
    />
  );
});

export interface DataListProps<T> {
  items: readonly T[];
  columns: readonly DataListColumn<T>[];
  /** 每列的穩定 key。 */
  getRowId: (row: T) => string;
  /** 有值時整列可點擊（Enter / Space 也能觸發，§47 keyboard navigation）。 */
  onRowSelect?: (row: T) => void;
  /** 目前選取的 row id。 */
  selectedId?: string | null;
  /** 顯示表頭列（預設 true）。 */
  showHeader?: boolean;
  /** 空清單時顯示的內容（建議傳 `<EmptyState />`，§45）。 */
  empty?: React.ReactNode;
  dense?: boolean;
  /** 清單的無障礙名稱（§47）。 */
  'aria-label'?: string;
  className?: string;
  rowClassName?: string;
}

/**
 * 泛型 function component（不是 forwardRef）——
 * forwardRef 會吃掉泛型參數，而這個元件的型別推導比 ref 更有價值。
 */
export function DataList<T>({
  items,
  columns,
  getRowId,
  onRowSelect,
  selectedId = null,
  showHeader = true,
  empty,
  dense = false,
  className,
  rowClassName,
  ...props
}: DataListProps<T>): React.ReactElement {
  const template = columns.map((column) => column.width ?? 'minmax(0,1fr)').join(' ');

  if (items.length === 0 && empty != null) {
    return <>{empty}</>;
  }

  return (
    <div
      role="table"
      aria-label={props['aria-label']}
      aria-rowcount={items.length}
      aria-colcount={columns.length}
      className={cn('flex w-full flex-col', className)}
    >
      {showHeader ? (
        <DataRow appearance="header" template={template} dense={dense}>
          {columns.map((column) => (
            <div
              key={column.id}
              role="columnheader"
              className={cn(
                'flex min-w-0 items-center',
                alignClass[column.align ?? 'start'],
                column.className,
              )}
            >
              <span className="truncate">{column.header}</span>
            </div>
          ))}
        </DataRow>
      ) : null}

      {items.map((row) => {
        const id = getRowId(row);
        const interactive = onRowSelect != null;

        return (
          <DataRow
            key={id}
            template={template}
            dense={dense}
            interactive={interactive}
            selected={selectedId === id}
            tabIndex={interactive ? 0 : undefined}
            onClick={interactive ? () => onRowSelect?.(row) : undefined}
            onKeyDown={
              interactive
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowSelect?.(row);
                    }
                  }
                : undefined
            }
            className={rowClassName}
          >
            {columns.map((column) => (
              <div
                key={column.id}
                role="cell"
                className={cn(
                  'flex min-w-0 items-center',
                  alignClass[column.align ?? 'start'],
                  column.className,
                )}
              >
                {column.cell(row)}
              </div>
            ))}
          </DataRow>
        );
      })}
    </div>
  );
}
