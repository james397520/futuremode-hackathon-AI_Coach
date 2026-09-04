'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  AlarmClock,
  BookOpen,
  CalendarClock,
  CheckCheck,
  FileCheck2,
  GraduationCap,
  MessageSquare,
  ShieldAlert,
  Stamp,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button, Drawer, Pill } from '@/components/ui';
import {
  MOCK_NOTIFICATIONS,
  NOTIFICATION_KIND_LABEL,
  type AppNotification,
  type NotificationKind,
} from '@/lib/fixtures/notifications';
import { cn, formatRelative } from '@/lib/utils';
import { useShellStore } from '@/components/app-shell/shell-store';

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  training_assigned: GraduationCap,
  deadline_soon: CalendarClock,
  training_overdue: AlarmClock,
  report_ready: FileCheck2,
  manager_comment: MessageSquare,
  reviewer_request: Stamp,
  knowledge_updated: BookOpen,
  security_warning: ShieldAlert,
  review_required: CheckCheck,
};

const SEVERITY_TONE: Record<AppNotification['severity'], 'neutral' | 'info' | 'warning' | 'danger' | 'success'> = {
  info: 'info',
  attention: 'warning',
  critical: 'danger',
  success: 'success',
};

/**
 * §37 Part I notification types, §81 right-hand floating glass panel.
 * Status is never conveyed by colour alone (§47) — every row carries a text label.
 */
export function NotificationPanel() {
  const open = useShellStore((state) => state.notificationsOpen);
  const setOpen = useShellStore((state) => state.setNotificationsOpen);
  const [items, setItems] = useState<AppNotification[]>(MOCK_NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((item) => !item.read) : items),
    [items, filter],
  );
  const unread = items.filter((item) => !item.read).length;

  return (
    <Drawer open={open} onOpenChange={setOpen} side="right" title="Notifications">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 pb-4">
          <div>
            <h2 className="text-section">Notifications</h2>
            <p className="text-body-sm text-text-secondary">
              {unread > 0 ? `${unread} unread` : 'You are all caught up'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={filter === 'all' ? 'subtle' : 'ghost'}
              size="sm"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
            >
              All
            </Button>
            <Button
              variant={filter === 'unread' ? 'subtle' : 'ghost'}
              size="sm"
              onClick={() => setFilter('unread')}
              aria-pressed={filter === 'unread'}
            >
              Unread
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close notifications">
              <X size={16} strokeWidth={1.8} aria-hidden />
            </Button>
          </div>
        </div>

        <ul className="scroll-area -mx-1 flex min-h-0 flex-1 flex-col gap-2 px-1" aria-live="polite">
          {visible.length === 0 ? (
            <li className="glass-strong p-6 text-center text-body-sm text-text-secondary">
              Nothing here. New assignments, reports and security warnings will appear in this panel.
            </li>
          ) : null}

          {visible.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => {
                    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
                    setOpen(false);
                  }}
                  className={cn(
                    'glass-strong block rounded-card-sm p-3.5 transition-transform duration-150 ease-out-soft',
                    'hover:-translate-y-px hover:shadow-soft',
                    !item.read && 'border-l-2 border-l-accent-indigo',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-text-tertiary" aria-hidden>
                      <Icon size={17} strokeWidth={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Pill tone={SEVERITY_TONE[item.severity]} size="sm">
                          {NOTIFICATION_KIND_LABEL[item.kind]}
                        </Pill>
                        <span className="text-tiny text-text-tertiary">{formatRelative(item.at)}</span>
                        {!item.read ? <span className="text-tiny font-medium text-accent-indigo">Unread</span> : null}
                      </div>
                      <p className="text-body-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-body-sm text-text-secondary">{item.body}</p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-border-soft/70 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setItems((prev) => prev.map((n) => ({ ...n, read: true })))}
            disabled={unread === 0}
          >
            Mark all as read
          </Button>
          <Link href="/settings/profile" className="text-body-sm text-accent-indigo hover:underline">
            Notification settings
          </Link>
        </div>
      </div>
    </Drawer>
  );
}
