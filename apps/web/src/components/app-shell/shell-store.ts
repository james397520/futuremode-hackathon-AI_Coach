'use client';

import { create } from 'zustand';

/**
 * §48.4 — client/UI state lives in Zustand. This store holds only shell-level
 * overlay state so the rail, top bar, command palette, notification panel and
 * the keyboard layer can all talk to each other without prop drilling.
 * Nothing server-derived belongs here (that is TanStack Query, §48.5).
 */
interface ShellState {
  commandPaletteOpen: boolean;
  notificationsOpen: boolean;
  shortcutsOpen: boolean;
  /** 1024–1199px: the persona / detail column is collapsible (§46). */
  detailColumnOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setNotificationsOpen: (open: boolean) => void;
  toggleNotifications: () => void;
  setShortcutsOpen: (open: boolean) => void;
  toggleShortcuts: () => void;
  toggleDetailColumn: () => void;
  closeAllOverlays: () => void;
}

export const useShellStore = create<ShellState>((set) => ({
  commandPaletteOpen: false,
  notificationsOpen: false,
  shortcutsOpen: false,
  detailColumnOpen: true,
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen, notificationsOpen: false })),
  setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
  toggleNotifications: () =>
    set((state) => ({ notificationsOpen: !state.notificationsOpen, commandPaletteOpen: false })),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  toggleShortcuts: () => set((state) => ({ shortcutsOpen: !state.shortcutsOpen })),
  toggleDetailColumn: () => set((state) => ({ detailColumnOpen: !state.detailColumnOpen })),
  closeAllOverlays: () =>
    set({ commandPaletteOpen: false, notificationsOpen: false, shortcutsOpen: false }),
}));
