'use client';

import { useRouter } from 'next/navigation';
import type { Role } from '@ai-coach/shared';
import { useState } from 'react';
import {
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  Settings,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Button, GlassCard } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

interface RoleOption {
  role: Role;
  title: string;
  description: string;
  action: string;
  icon: typeof UserRound;
  href: string;
}

const ROLE_OPTIONS: Record<Role, RoleOption> = {
  trainee: {
    role: 'trainee',
    title: '我是學員',
    description: '完成今日指派的訓練，查看回饋與下一步建議。',
    action: '進入我的訓練',
    icon: UserRound,
    href: '/training',
  },
  coach: {
    role: 'coach',
    title: '我是教練',
    description: '建立訓練內容、協助學員練習，並檢視回饋。',
    action: '進入教練工作台',
    icon: BookOpenCheck,
    href: '/dashboard',
  },
  manager: {
    role: 'manager',
    title: '我是主管',
    description: '掌握團隊進度與能力缺口，安排下一輪訓練。',
    action: '進入團隊總覽',
    icon: BarChart3,
    href: '/dashboard',
  },
  reviewer: {
    role: 'reviewer',
    title: '我是合規審查者',
    description: '檢視合規發現、稽核紀錄與需要人工覆核的結果。',
    action: '進入審查工作台',
    icon: ShieldCheck,
    href: '/security',
  },
  admin: {
    role: 'admin',
    title: '我是管理者',
    description: '管理工作區、帳號權限、整合服務與安全設定。',
    action: '進入管理設定',
    icon: Settings,
    href: '/dashboard',
  },
};

/**
 * A work-context picker, not an authorisation boundary. The available cards are
 * derived exclusively from roles granted by the authenticated session.
 */
export function RoleSelectPage() {
  const router = useRouter();
  const { user, workspace, selectRole } = useAuth();
  const options = (user?.roles ?? []).map((role) => ROLE_OPTIONS[role]).filter(Boolean);
  const trainee = options.find((option) => option.role === 'trainee');
  const otherRoles = options.filter((option) => option.role !== 'trainee');
  const [otherRolesOpen, setOtherRolesOpen] = useState(false);

  const choose = (option: RoleOption) => {
    selectRole(option.role);
    router.push(option.href);
  };

  return (
    <GlassCard tone="strong" className="p-8">
      <p className="meta-label">選擇工作身份</p>
      <h1 className="mt-2 text-section">今天要做什麼？</h1>
      <p className="mt-1.5 text-body-sm text-text-secondary">
        {workspace ? `${workspace.name} · ` : ''}
        先進入你的訓練；若這次要管理內容或團隊，可再切換其他身份。
      </p>

      {trainee ? (
        <GlassCard tone="floating" className="mt-6 p-5">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
              aria-hidden
            >
              <UserRound size={18} strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-card-title">我是學員</p>
              <p className="mt-1 text-body-sm text-text-secondary">
                完成今日指派的訓練，查看回饋與下一步建議。
              </p>
            </div>
          </div>
          <Button variant="primary" size="md" className="mt-5 w-full" onClick={() => choose(trainee)}>
            進入我的訓練
            <ChevronRight size={16} strokeWidth={1.8} aria-hidden />
          </Button>
        </GlassCard>
      ) : null}

      {otherRoles.length > 0 ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setOtherRolesOpen((open) => !open)}
            aria-expanded={otherRolesOpen}
            className="flex w-full items-center justify-between rounded-card-sm px-1 text-body-sm text-text-secondary hover:text-text-primary"
          >
            <span>我要切換其他身份</span>
            <ChevronDown
              size={17}
              strokeWidth={1.8}
              aria-hidden
              className={cn('transition-transform', otherRolesOpen && 'rotate-180')}
            />
          </button>

          {otherRolesOpen ? (
            <ul className="mt-2.5 space-y-2.5">
              {otherRoles.map((option) => {
                const Icon = option.icon;
                return (
                  <li key={option.role}>
                    <button
                      type="button"
                      onClick={() => choose(option)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-card-sm border border-border-soft px-4 py-4 text-left',
                        'transition-transform duration-150 ease-out-soft hover:-translate-y-px hover:shadow-soft',
                      )}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
                        aria-hidden
                      >
                        <Icon size={18} strokeWidth={1.7} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-body font-medium">{option.title}</span>
                        <span className="mt-0.5 block text-body-sm text-text-secondary">
                          {option.description}
                        </span>
                        <span className="mt-2 block text-tiny font-medium text-accent-indigo">
                          {option.action}
                        </span>
                      </span>
                      <ChevronRight
                        size={17}
                        strokeWidth={1.8}
                        aria-hidden
                        className="shrink-0 text-text-tertiary"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-6 text-tiny text-text-tertiary">
        身份只會切換工作視角，不會改變你的帳號權限。你隨時可以從右上角切換身份或工作區。
      </p>
    </GlassCard>
  );
}
