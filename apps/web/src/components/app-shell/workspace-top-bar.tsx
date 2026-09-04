'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Bell, ChevronDown, Plus, Search } from 'lucide-react';
import { Button, IconButton, Pill } from '@/components/ui';
import { useAuth, useCan } from '@/lib/auth-context';
import { MOCK_NOTIFICATIONS } from '@/lib/fixtures/notifications';
import { cn } from '@/lib/utils';
import { useShellStore } from './shell-store';

/**
 * §13.2 — greeting, workspace switch, search, notifications, + New Simulation.
 * Search is deliberately a *trigger* for the command palette (§79/§80) rather
 * than a second search implementation.
 */
export function WorkspaceTopBar() {
  const { user, workspace, workspaces, selectWorkspace } = useAuth();
  const canStart = useCan('simulation.start');
  const toggleCommandPalette = useShellStore((state) => state.toggleCommandPalette);
  const toggleNotifications = useShellStore((state) => state.toggleNotifications);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const unread = useMemo(() => MOCK_NOTIFICATIONS.filter((n) => !n.read).length, []);
  const firstName = user?.display_name.split(' ')[0] ?? 'there';

  return (
    <header className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="meta-label">Workspace</p>
        <div className="relative flex items-center gap-2">
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={switcherOpen}
            onClick={() => setSwitcherOpen((prev) => !prev)}
            className="flex min-w-0 items-center gap-1.5 rounded-button text-left text-section hover:text-accent-indigo"
          >
            <span className="truncate">{workspace?.name ?? 'Select workspace'}</span>
            <ChevronDown size={17} strokeWidth={1.8} aria-hidden className="shrink-0 text-text-tertiary" />
          </button>
          {workspace?.kind === 'b2c' ? <Pill tone="neutral" size="sm">Personal</Pill> : null}

          {switcherOpen ? (
            <ul
              role="listbox"
              aria-label="Switch workspace"
              className="glass-card absolute left-0 top-full z-30 mt-2 w-72 p-1.5 shadow-floating animate-card-enter"
            >
              {workspaces.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.id === workspace?.id}
                    onClick={() => {
                      selectWorkspace(option.id);
                      setSwitcherOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-input px-3 py-2 text-left text-body-sm',
                      'hover:bg-glass-strong',
                      option.id === workspace?.id && 'bg-glass-strong font-medium',
                    )}
                  >
                    <span className="truncate">{option.name}</span>
                    <span className="text-tiny uppercase text-text-tertiary">{option.kind}</span>
                  </button>
                </li>
              ))}
              <li className="border-t border-border-soft/70 pt-1">
                <Link
                  href="/workspace-select"
                  className="block rounded-input px-3 py-2 text-body-sm text-accent-indigo hover:bg-glass-strong"
                  onClick={() => setSwitcherOpen(false)}
                >
                  See all workspaces
                </Link>
              </li>
            </ul>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-body-sm text-text-secondary">
          Good to see you, {firstName}. Here is where your team stands today.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleCommandPalette}
          className="hidden items-center gap-2 rounded-pill border border-border-soft bg-glass-card px-3.5 py-2 text-body-sm text-text-tertiary transition-colors duration-150 ease-out-soft hover:text-text-primary md:flex"
          aria-label="Search everything (Command or Control K)"
        >
          <Search size={16} strokeWidth={1.7} aria-hidden />
          <span>Search personas, knowledge, reports…</span>
          <kbd className="ml-2 rounded-button border border-border-soft px-1.5 py-0.5 text-tiny">⌘K</kbd>
        </button>

        <IconButton label="Search" onClick={toggleCommandPalette} className="md:hidden">
          <Search size={18} strokeWidth={1.7} aria-hidden />
        </IconButton>

        <IconButton
          label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          onClick={toggleNotifications}
          className="relative"
        >
          <Bell size={18} strokeWidth={1.7} aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-pill bg-accent-indigo ring-2 ring-glass-strong"
            />
          ) : null}
        </IconButton>

        {canStart ? (
          <Button asChild variant="primary" size="sm">
            <Link href="/simulations">
              <Plus size={16} strokeWidth={2} aria-hidden />
              New Simulation
            </Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
