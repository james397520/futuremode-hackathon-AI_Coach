'use client';

import { useRouter } from 'next/navigation';
import { Building2, ChevronRight, User } from 'lucide-react';
import { Button, GlassCard } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

/**
 * §58-2 Workspace Selector.
 *
 * §10 Part I — a user can belong to several workspaces inside one tenant, and
 * every piece of data is scoped by `workspace_id`. Picking here is what sets
 * that scope for the rest of the session, so it is a deliberate step rather than
 * a dropdown buried in the shell.
 */
export function WorkspaceSelectPage() {
  const router = useRouter();
  const { workspaces, workspace, selectWorkspace, user } = useAuth();

  return (
    <GlassCard tone="strong" className="p-8">
      <h1 className="text-section">選擇工作區</h1>
      <p className="mt-1.5 text-body-sm text-text-secondary">
        {user ? `已登入：${user.display_name}。` : ''}
        知識庫、模擬人物與報表會依工作區隔離。
      </p>

      <ul className="mt-6 space-y-2">
        {workspaces.map((option) => {
          const isB2c = option.kind === 'b2c';
          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  selectWorkspace(option.id);
                  router.push('/role-select');
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-card-sm border border-border-soft px-4 py-3.5 text-left',
                  'transition-transform duration-150 ease-out-soft hover:-translate-y-px hover:shadow-soft',
                  option.id === workspace?.id && 'bg-glass-card',
                )}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
                  aria-hidden
                >
                  {isB2c ? <User size={17} strokeWidth={1.7} /> : <Building2 size={17} strokeWidth={1.7} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{option.name}</span>
                  <span className="block text-tiny text-text-tertiary">
                    {isB2c
                      ? '個人練習空間，不可存取企業知識庫'
                      : '企業工作區，共用知識、評分規準與報表'}
                  </span>
                </span>
                <ChevronRight size={16} strokeWidth={1.8} aria-hidden className="shrink-0 text-text-tertiary" />
              </button>
            </li>
          );
        })}
      </ul>

      <Button variant="ghost" size="sm" className="mt-6" onClick={() => router.push('/login')}>
        使用其他帳號登入
      </Button>
    </GlassCard>
  );
}
