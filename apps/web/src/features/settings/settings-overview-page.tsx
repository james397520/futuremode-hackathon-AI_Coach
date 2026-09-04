'use client';

import Link from 'next/link';
import { GlassCard, Pill } from '@/components/ui';
import { RuntimeBadge } from '@/components/runtime';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { SettingsShell } from './settings-shell';
import { SETTINGS_SECTIONS } from './settings-nav';

export function SettingsOverviewPage() {
  const { can, user, workspace } = useAuth();
  const sections = SETTINGS_SECTIONS.filter((section) => can(section.permission));

  return (
    <SettingsShell
      breadcrumbs={[{ label: 'Settings' }]}
      title="Settings"
      description="Workspace configuration and your personal preferences."
      meta={
        <>
          <Pill tone="neutral" size="sm">{workspace?.name ?? 'No workspace'}</Pill>
          {user?.roles.map((role) => (
            <Pill key={role} tone="neutral" size="sm">
              {ROLE_LABEL[role]}
            </Pill>
          ))}
          <RuntimeBadge />
        </>
      }
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.id}>
            <GlassCard className="h-full p-5">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
                  aria-hidden
                >
                  <section.icon size={17} strokeWidth={1.7} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-card-title">
                    <Link href={section.href} className="hover:text-accent-indigo">
                      {section.label}
                    </Link>
                  </h2>
                  <p className="mt-1 text-body-sm text-text-secondary">{section.description}</p>
                  {section.adminOnly ? (
                    <Pill tone="neutral" size="sm" className="mt-2">
                      Admin only
                    </Pill>
                  ) : null}
                </div>
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Keyboard shortcuts</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Press <kbd className="rounded-button border border-border-soft px-1.5 py-0.5 text-tiny">⌘/</kbd> anywhere to
          see the full list, or <kbd className="rounded-button border border-border-soft px-1.5 py-0.5 text-tiny">⌘K</kbd>{' '}
          for the command palette.
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
