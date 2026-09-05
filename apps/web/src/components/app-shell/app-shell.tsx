'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { GlassShell } from '@/components/ui';
import { AppCommandPalette } from '@/components/command-palette/app-command-palette';
import { NotificationPanel } from '@/components/notifications/notification-panel';
import { GlobalShortcuts, ShortcutsDialog } from '@/components/keyboard/shortcuts';
import { LocalAiConsent } from '@/components/runtime';
import { useAuth } from '@/lib/auth-context';
import { IconRail } from './icon-rail';
import { WorkspaceTopBar } from './workspace-top-bar';

/**
 * Soft Lavender workspace shell: compact navigation, thin context bar and a
 * low-distraction scrolling work canvas. The outer lavender stage remains
 * visible on desktop; below 768px the navigation becomes a bottom strip.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { activeRole, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !activeRole) router.replace('/role-select');
  }, [activeRole, isLoading, router]);

  if (isLoading || !activeRole) {
    return <div className="aurora-canvas min-h-screen" aria-busy="true" />;
  }

  return (
    <div className="aurora-canvas min-h-screen overflow-hidden">

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
        outerClassName="max-md:p-0"
        className="relative flex-row overflow-hidden h-[calc(100vh_-_2_*_var(--shell-safe-area))] max-md:h-screen max-md:rounded-none"
      >
        <IconRail />

        <div className="workspace-surface flex min-w-0 flex-1 flex-col max-md:pb-16">
          <WorkspaceTopBar />
          <main
            id="workspace-main"
            className="scroll-area relative z-10 min-h-0 flex-1 px-4 pb-6 sm:px-6 lg:px-10"
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
