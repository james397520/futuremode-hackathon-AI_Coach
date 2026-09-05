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
      breadcrumbs={[{ label: '設定' }]}
      title="設定"
      description="工作區設定與你的個人偏好。"
      meta={
        <>
          <Pill tone="neutral" size="sm">{workspace?.name ?? '尚未指定工作區'}</Pill>
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-glass-card text-accent-indigo"
                  aria-hidden
                >
                  <section.icon size={17} strokeWidth={1.7} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-card-title">
                    <Link href={section.href} className="hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                      {section.label}
                    </Link>
                  </h2>
                  <p className="mt-1 text-body-sm text-text-secondary">{section.description}</p>
                  {section.adminOnly ? (
                    <Pill tone="neutral" size="sm" className="mt-2">
                      僅限管理者
                    </Pill>
                  ) : null}
                </div>
              </div>
            </GlassCard>
          </li>
        ))}
      </ul>

      <GlassCard className="p-5">
        <h2 className="text-card-title">鍵盤快速鍵</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          在任何頁面按 <kbd className="rounded-button border border-border-soft px-1.5 py-0.5 text-tiny">⌘/</kbd>{' '}
          即可看到完整清單，或按 <kbd className="rounded-button border border-border-soft px-1.5 py-0.5 text-tiny">⌘K</kbd>{' '}
          開啟指令面板。
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
