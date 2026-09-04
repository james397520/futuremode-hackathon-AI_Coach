'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { GlassCard, Pill } from '@/components/ui';
import { PageHeader, type Crumb } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { SETTINGS_SECTIONS } from './settings-nav';

/**
 * Shared frame for every settings page: a section list on the left (RBAC
 * filtered) and the page content on the right. Below 1024px the list collapses
 * to a horizontal strip (§46).
 */
export function SettingsShell({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  children,
}: {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { can } = useAuth();
  const sections = SETTINGS_SECTIONS.filter((section) => can(section.permission));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={breadcrumbs ?? [{ label: 'Settings', href: '/settings' }, { label: title }]}
        title={title}
        description={description}
        actions={actions}
        meta={meta}
      />

      <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <GlassCard className="h-fit p-3">
          <nav aria-label="Settings sections">
            <ul className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
              {sections.map((section) => {
                const active = pathname === section.href;
                return (
                  <li key={section.id} className="shrink-0 md:shrink">
                    <Link
                      href={section.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-input px-3 py-2.5 text-body-sm transition-colors duration-150 ease-out-soft',
                        active ? 'bg-glass-strong font-medium shadow-soft' : 'text-text-secondary hover:text-text-primary',
                      )}
                    >
                      <section.icon size={16} strokeWidth={1.7} aria-hidden className="shrink-0" />
                      <span className="truncate">{section.label}</span>
                      {section.adminOnly ? (
                        <Pill tone="neutral" size="sm" className="ml-auto hidden md:inline-flex">
                          Admin
                        </Pill>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </GlassCard>

        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </div>
  );
}
