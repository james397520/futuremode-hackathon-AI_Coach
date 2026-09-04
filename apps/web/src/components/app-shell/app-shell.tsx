'use client';

import type { ReactNode } from 'react';
import { GlassShell } from '@/components/ui';
import { AppCommandPalette } from '@/components/command-palette/app-command-palette';
import { NotificationPanel } from '@/components/notifications/notification-panel';
import { GlobalShortcuts, ShortcutsDialog } from '@/components/keyboard/shortcuts';
import { LocalAiConsent } from '@/components/runtime';
import { IconRail } from './icon-rail';
import { WorkspaceTopBar } from './workspace-top-bar';

/**
 * §10 App Shell.
 *
 *   Viewport → aurora background → 24px safe area → floating glass shell
 *
 * Deliberately not a full-bleed dashboard: the shell is
 * `calc(100vw - 48px) × calc(100vh - 48px)`, capped at 1800px, with a 30px
 * radius, and the workspace column scrolls *inside* it. Below 768px the safe
 * area is dropped and the rail becomes a bottom strip (§46).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="aurora-canvas min-h-screen overflow-hidden">
      {/* §2 — dot matrix only top-left, never tiled across the page. */}
      <div className="dot-matrix pointer-events-none fixed left-0 top-0 h-[46vh] w-[42vw] opacity-70" aria-hidden />

      {/*
        `flex-row` 必須寫出來：GlassShell 內框預設是 `flex-col`，而
        tailwind-merge 把 `flex`（display）與 `flex-col`（flex-direction）
        視為不同 group，只傳 `flex` 不會覆蓋掉 `flex-col`——結果 icon rail
        會堆在內容上方，把 workspace 推出固定高度的 shell 之外被裁掉。

        The other two overrides exist because GlassShell already owns the safe
        area, the 1800px cap and the 30px radius:
          - `padded={false}` — the workspace column supplies its own padding and
            the icon rail must reach the frame edge, so the kit's p-5/xl:p-6 is off.
          - a *fixed* height — the kit ships `min-height`, which would let content
            grow the page; we need the column to scroll inside the frame (§10).
        Below 768px the safe area is dropped entirely (§46).
      */}
      <GlassShell
        padded={false}
        outerClassName="max-sm:p-0"
        className="relative flex-row overflow-hidden h-[calc(100vh_-_2_*_var(--shell-safe-area))] max-sm:h-screen max-sm:rounded-none"
      >
        <IconRail />

        <div className="flex min-w-0 flex-1 flex-col max-sm:pb-16">
          <WorkspaceTopBar />
          <main
            id="workspace-main"
            className="scroll-area min-h-0 flex-1 px-5 pb-6 sm:px-6"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </GlassShell>

      {/* Overlays live outside the scrolling column so blur never clips them. */}
      <AppCommandPalette />
      <NotificationPanel />
      <ShortcutsDialog />
      <GlobalShortcuts />
      <LocalAiConsent />
    </div>
  );
}
