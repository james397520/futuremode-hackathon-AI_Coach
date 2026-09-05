/**
 * CommandPalette — spec §79 Command Palette / §78 Keyboard Shortcuts / §80 grouped glass list /
 * §47 Accessibility。
 *
 * 這是**純 primitive**：items 全部由呼叫端傳入。
 * 本 package 不得出現任何業務語意（Persona / Scenario / Knowledge…），
 * 那些指令字串屬於 `apps/web/src/components/command-palette`（見 PROJECT_STRUCTURE §2）。
 *
 * 行為：
 *  - center glass modal（§79）
 *  - 輸入即過濾（預設 label / description / group / keywords 子字串比對，可用 `filter` 覆寫）
 *  - ↑ / ↓ 移動、Home / End 跳頭尾、Enter 執行、Esc 關閉（Radix Dialog 提供）
 *  - combobox + listbox ARIA，含 aria-activedescendant
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search } from 'lucide-react';

import { cn } from '../lib/cn';
import { glassSurface } from './glass-card';
import { ModalOverlay } from './dialog';
import { ScrollArea } from './scroll-area';

export interface CommandPaletteItem {
  /** 穩定 id，也用於 aria-activedescendant。 */
  id: string;
  label: string;
  description?: string;
  /** 分組標題。同一個 group 的項目會被收在一起（§80 grouped glass list）。 */
  group?: string;
  /** 額外的搜尋關鍵字（不顯示）。 */
  keywords?: readonly string[];
  /** 右側快捷鍵提示（§78），例如 `⌘K`。 */
  shortcut?: string;
  /** 線性 icon（§85）。 */
  icon?: React.ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

/** `groups` 形式的輸入（等價於帶 `group` 欄位的扁平 items，兩種都接）。 */
export interface CommandPaletteGroup {
  id: string;
  label: string;
  items: readonly CommandPaletteItem[];
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 扁平 items；與 `groups` 二選一（同時給時兩者合併）。 */
  items?: readonly CommandPaletteItem[];
  /**
   * 已分組的 items。group 的顯示順序即陣列順序，
   * 不需要另外給 `groupOrder`。
   */
  groups?: readonly CommandPaletteGroup[];
  placeholder?: string;
  /** 找不到結果時顯示（§45 精神：一句話）。 */
  emptyMessage?: React.ReactNode;
  /** 分組顯示順序。未列出的 group 依出現順序排在後面。 */
  groupOrder?: readonly string[];
  /** 覆寫過濾邏輯（例如接 fuzzy matcher）。 */
  filter?: (item: CommandPaletteItem, query: string) => boolean;
  /** dialog 的無障礙名稱。 */
  label?: string;
  /** 底部提示列（快捷鍵說明等）。 */
  footer?: React.ReactNode;
  className?: string;
}

const UNGROUPED = '__ungrouped__';

function defaultFilter(item: CommandPaletteItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  const haystack = [item.label, item.description ?? '', item.group ?? '', ...(item.keywords ?? [])]
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

interface PaletteGroup {
  key: string;
  label: string | null;
  items: CommandPaletteItem[];
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  groups: groupsProp,
  placeholder = '搜尋指令…',
  emptyMessage = 'No matching command.',
  groupOrder,
  filter = defaultFilter,
  label = '指令面板',
  footer,
  className,
}: CommandPaletteProps): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const rawId = React.useId();
  const domId = rawId.replace(/:/g, '');
  const listboxId = `cmdk-list-${domId}`;
  const inputId = `cmdk-input-${domId}`;

  /**
   * `items` 與 `groups` 兩種輸入都收斂成同一份扁平清單：
   * group 形式的每個 item 補上 `group` 欄位，下面的分組邏輯就不用分兩套。
   */
  const allItems = React.useMemo<CommandPaletteItem[]>(() => {
    const flat: CommandPaletteItem[] = items === undefined ? [] : [...items];
    if (groupsProp !== undefined) {
      for (const g of groupsProp) {
        for (const it of g.items) flat.push({ ...it, group: it.group ?? g.label });
      }
    }
    return flat;
  }, [items, groupsProp]);

  /** `groups` 的陣列順序就是顯示順序，不需要呼叫端另給 groupOrder。 */
  const resolvedGroupOrder = React.useMemo<readonly string[] | undefined>(
    () => groupOrder ?? groupsProp?.map((g) => g.label),
    [groupOrder, groupsProp],
  );

  /** 過濾後可被選取的扁平清單（disabled 也在清單裡但不可 active）。 */
  const matches = React.useMemo(
    () => allItems.filter((item) => filter(item, query)),
    [allItems, filter, query],
  );
  const selectable = React.useMemo(() => matches.filter((item) => !item.disabled), [matches]);

  const groups = React.useMemo<PaletteGroup[]>(() => {
    const byKey = new Map<string, PaletteGroup>();
    for (const item of matches) {
      const key = item.group ?? UNGROUPED;
      const existing = byKey.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        byKey.set(key, { key, label: item.group ?? null, items: [item] });
      }
    }
    const ordered: PaletteGroup[] = [];
    if (resolvedGroupOrder) {
      for (const name of resolvedGroupOrder) {
        const found = byKey.get(name);
        if (found) {
          ordered.push(found);
          byKey.delete(name);
        }
      }
    }
    for (const group of byKey.values()) ordered.push(group);
    return ordered;
  }, [matches, resolvedGroupOrder]);

  // 開啟 / 輸入變動時把 active 拉回第一項
  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const activeItem = selectable[activeIndex];

  // active 項目滾進可視範圍（§47 keyboard navigation）
  React.useEffect(() => {
    if (activeItem == null) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-item-id="${activeItem.id}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeItem]);

  const move = React.useCallback(
    (delta: number) => {
      setActiveIndex((prev) => {
        const count = selectable.length;
        if (count === 0) return 0;
        return (prev + delta + count) % count;
      });
    },
    [selectable.length],
  );

  const runItem = React.useCallback(
    (item: CommandPaletteItem) => {
      if (item.disabled === true) return;
      onOpenChange(false);
      item.onSelect();
    },
    [onOpenChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, selectable.length - 1));
        break;
      case 'Enter': {
        event.preventDefault();
        if (activeItem != null) runItem(activeItem);
        break;
      }
      default:
        break;
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <ModalOverlay />
        <DialogPrimitive.Content
          aria-label={label}
          // 沒有 Dialog.Description，明確關掉 Radix 的 describedby 連結（避免指向不存在的 id）
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 flex w-[calc(100vw_-_2_*_var(--shell-safe-area))] max-w-[36rem]',
            '-translate-x-1/2 flex-col overflow-hidden rounded-card p-0 text-text-primary outline-none',
            glassSurface.overlay,
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>

          {/* 搜尋列 */}
          <div className="flex items-center gap-3 border-b border-border-soft px-4">
            <Search aria-hidden className="size-4 shrink-0 text-text-tertiary" />
            <input
              id={inputId}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- palette 開啟即應可輸入（§79）
              autoFocus
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={activeItem != null ? `${listboxId}-${activeItem.id}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={placeholder}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              className={cn(
                'h-12 w-full min-w-0 bg-transparent text-body text-text-primary outline-none',
                'placeholder:text-text-tertiary',
              )}
            />
            <kbd className="hidden shrink-0 rounded-button border border-border-soft px-1.5 py-0.5 text-tiny text-text-tertiary sm:inline-block">
              Esc
            </kbd>
          </div>

          {/* 結果清單 */}
          <ScrollArea className="max-h-[min(24rem,52vh)]" viewportClassName="p-2">
            <div ref={listRef} id={listboxId} role="listbox" aria-label={label}>
              {groups.length === 0 ? (
                <p className="px-2 py-8 text-center text-body-sm text-text-tertiary">
                  {emptyMessage}
                </p>
              ) : (
                groups.map((group) => (
                  <div key={group.key} role="group" aria-label={group.label ?? undefined}>
                    {group.label != null ? (
                      <p className="px-2.5 pb-1 pt-2.5 text-meta uppercase tracking-wide text-text-tertiary">
                        {group.label}
                      </p>
                    ) : null}
                    {group.items.map((item) => {
                      const isActive = activeItem != null && activeItem.id === item.id;
                      return (
                        <div
                          key={item.id}
                          id={`${listboxId}-${item.id}`}
                          data-item-id={item.id}
                          role="option"
                          aria-selected={isActive}
                          aria-disabled={item.disabled === true ? true : undefined}
                          onPointerMove={() => {
                            if (item.disabled === true) return;
                            const next = selectable.findIndex((candidate) => candidate.id === item.id);
                            if (next >= 0) setActiveIndex(next);
                          }}
                          onClick={() => runItem(item)}
                          className={cn(
                            'flex min-h-9 cursor-pointer select-none items-center gap-3 rounded-button px-2.5 py-2',
                            'text-body text-text-secondary',
                            'transition-colors duration-[var(--dur-hover)] motion-reduce:transition-none',
                            isActive && 'bg-glass-card text-text-primary',
                            item.disabled === true && 'pointer-events-none opacity-50',
                          )}
                        >
                          {item.icon != null ? (
                            <span
                              aria-hidden
                              className="inline-flex shrink-0 items-center text-text-tertiary [&_svg]:size-4"
                            >
                              {item.icon}
                            </span>
                          ) : null}
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate">{item.label}</span>
                            {item.description != null ? (
                              <span className="truncate text-meta text-text-tertiary">
                                {item.description}
                              </span>
                            ) : null}
                          </span>
                          {item.shortcut != null ? (
                            <kbd className="shrink-0 rounded-button border border-border-soft px-1.5 py-0.5 text-tiny text-text-tertiary">
                              {item.shortcut}
                            </kbd>
                          ) : null}
                          {isActive ? (
                            <CornerDownLeft
                              aria-hidden
                              className="size-3.5 shrink-0 text-text-tertiary"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          {footer != null ? (
            <div className="flex items-center justify-between gap-3 border-t border-border-soft px-4 py-2.5 text-meta text-text-tertiary">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * §78：Cmd/Ctrl + K 開啟 palette。
 * 這只是通用的鍵盤綁定，不含任何指令內容；
 * 呼叫端自行決定要不要用（也可以自己接 hotkey library）。
 * 會避開輸入框內的按鍵衝突（§78「需避免與輸入框衝突」）——
 * Cmd/Ctrl 組合鍵在 input 內仍然有效，這是刻意的。
 */
export function useCommandPaletteHotkey(
  onOpen: () => void,
  options?: { enabled?: boolean; key?: string },
): void {
  const enabled = options?.enabled ?? true;
  const key = options?.key ?? 'k';
  const handlerRef = React.useRef(onOpen);
  handlerRef.current = onOpen;

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handlerRef.current();
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled, key]);
}
