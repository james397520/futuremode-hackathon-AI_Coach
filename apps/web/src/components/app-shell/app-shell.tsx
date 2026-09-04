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

      <GlassShell className="shell-frame relative flex overflow-hidden">
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
