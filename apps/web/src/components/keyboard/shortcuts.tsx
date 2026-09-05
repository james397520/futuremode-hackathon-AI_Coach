'use client';

import { useEffect } from 'react';
import { Modal } from '@/components/ui';
import { useShellStore } from '@/components/app-shell/shell-store';

/** §78 Keyboard Shortcuts. */
export const SHORTCUTS: Array<{ keys: string; action: string; scope: string }> = [
  { keys: 'Space', action: '按住說話', scope: '語音練習' },
  { keys: '⌘K / Ctrl+K', action: '指令面板', scope: '全站通用' },
  { keys: '⌘/ / Ctrl+/', action: '快速鍵說明', scope: '全站通用' },
  { keys: 'Esc', action: '關閉面板或對話框', scope: '全站通用' },
  { keys: 'R', action: '重播目前這句語音', scope: '語音練習' },
  { keys: 'H', action: '請教練給提示', scope: '僅限訓練模式' },
  { keys: 'N', action: '開啟通知', scope: '全站通用' },
];

/**
 * Editable targets must never swallow a keystroke (§78: "avoid conflicting with
 * input fields"). Modifier shortcuts still fire; bare-letter ones do not.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function GlobalShortcuts() {
  const toggleCommandPalette = useShellStore((state) => state.toggleCommandPalette);
  const toggleNotifications = useShellStore((state) => state.toggleNotifications);
  const toggleShortcuts = useShellStore((state) => state.toggleShortcuts);
  const closeAllOverlays = useShellStore((state) => state.closeAllOverlays);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }

      if (mod && event.key === '/') {
        event.preventDefault();
        toggleShortcuts();
        return;
      }

      if (event.key === 'Escape') {
        closeAllOverlays();
        return;
      }

      if (isEditableTarget(event.target) || mod || event.altKey) return;

      // Bare-letter shortcuts. Space / R / H are owned by the live voice feature
      // (src/features/simulation) because they only make sense inside a session.
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        toggleNotifications();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleCommandPalette, toggleNotifications, toggleShortcuts, closeAllOverlays]);

  return null;
}

export function ShortcutsDialog() {
  const open = useShellStore((state) => state.shortcutsOpen);
  const setOpen = useShellStore((state) => state.setShortcutsOpen);

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="鍵盤快速鍵"
      description="在輸入欄位打字時，快速鍵會自動停用。"
      size="sm"
    >
      <ul className="divide-y divide-border-soft/70">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.keys} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <p className="text-body-sm font-medium">{shortcut.action}</p>
              <p className="text-tiny text-text-tertiary">{shortcut.scope}</p>
            </div>
            <kbd className="shrink-0 rounded-button border border-border-soft bg-glass-card px-2 py-1 text-meta">
              {shortcut.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
