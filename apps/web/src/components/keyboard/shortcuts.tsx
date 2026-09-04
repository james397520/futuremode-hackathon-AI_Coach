'use client';

import { useEffect } from 'react';
import { Modal } from '@/components/ui';
import { useShellStore } from '@/components/app-shell/shell-store';

/** §78 Keyboard Shortcuts. */
export const SHORTCUTS: Array<{ keys: string; action: string; scope: string }> = [
  { keys: 'Space', action: 'Push to talk', scope: 'Voice simulation' },
  { keys: '⌘K / Ctrl+K', action: 'Command palette', scope: 'Everywhere' },
  { keys: '⌘/ / Ctrl+/', action: 'Keyboard help', scope: 'Everywhere' },
  { keys: 'Esc', action: 'Close panel or dialog', scope: 'Everywhere' },
  { keys: 'R', action: 'Replay current voice turn', scope: 'Voice simulation' },
  { keys: 'H', action: 'Request a coach hint', scope: 'Training mode only' },
  { keys: 'N', action: 'Open notifications', scope: 'Everywhere' },
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
      title="Keyboard shortcuts"
      description="Shortcuts are suppressed while you are typing in a field."
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
