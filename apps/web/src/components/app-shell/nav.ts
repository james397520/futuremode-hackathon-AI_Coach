import {
  BarChart3,
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  Plug,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@ai-coach/shared';
import type { Permission } from '@/lib/rbac';

/** §57 — the thirteen primary navigation items, in spec order. */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** RBAC gate (§9). Items the role cannot use are not rendered at all. */
  permission: Permission;
  /** Extra path prefixes that should also light this item up. */
  matches?: string[];
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: '首頁',
    href: '/dashboard',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    description: 'Training overview, today’s objective and live KPIs',
  },
  {
    id: 'simulations',
    label: '模擬練習',
    href: '/simulations',
    icon: PlayCircle,
    permission: 'simulation.start',
    description: 'Scenario library, live sessions and session review',
  },
  {
    id: 'training',
    label: '我的訓練',
    href: '/training',
    icon: GraduationCap,
    permission: 'training.view_assigned',
    description: 'Assignments, deadlines and completion rules',
  },
  {
    id: 'personas',
    label: '模擬人物',
    href: '/personas',
    icon: UserRound,
    permission: 'persona.manage',
    description: 'Persona builder, hidden state and test lab',
  },
  {
    id: 'scenarios',
    label: '訓練情境',
    href: '/scenarios',
    icon: SlidersHorizontal,
    permission: 'scenario.manage',
    description: 'Nine-step scenario builder and versioning',
  },
  {
    id: 'knowledge',
    label: '知識庫',
    href: '/knowledge',
    icon: BookOpen,
    permission: 'knowledge.view',
    description: 'Documents, chunks, retrieval playground and mining',
  },
  {
    id: 'questions',
    label: '題庫',
    href: '/questions',
    icon: ListChecks,
    permission: 'question.manage',
    description: 'Question bank, AI generation and human review',
  },
  {
    id: 'performance',
    label: '成效回顧',
    href: '/performance',
    icon: TrendingUp,
    permission: 'performance.view_own',
    description: 'Individual growth, evidence-backed scores and timelines',
  },
  {
    id: 'reports',
    label: '報表',
    href: '/reports/team',
    icon: BarChart3,
    permission: 'report.view_team',
    matches: ['/reports'],
    description: 'Team, skill and compliance reporting',
  },
  {
    id: 'team',
    label: '團隊',
    href: '/team',
    icon: Users,
    permission: 'team.review',
    description: 'People, roles and readiness',
  },
  {
    id: 'security',
    label: '安全與稽核',
    href: '/security',
    icon: ShieldCheck,
    permission: 'security.view',
    description: 'Findings, safety posture and the audit log',
  },
  {
    id: 'integrations',
    label: '整合服務',
    href: '/integrations',
    icon: Plug,
    permission: 'integration.manage',
    description: 'Model, voice, vector, CRM, LMS and identity connectors',
  },
  {
    id: 'settings',
    label: '設定',
    href: '/settings',
    icon: Settings,
    permission: 'settings.view',
    description: 'Models, AI runtime, voice, appearance, profile and billing',
  },
];

/** Keep the rail task-focused: a selected work identity sees only its core journey. */
export const ROLE_NAV_IDS: Record<Role, readonly NavItem['id'][]> = {
  trainee: ['dashboard', 'simulations', 'training', 'performance'],
  coach: ['dashboard', 'simulations', 'training', 'personas', 'scenarios', 'knowledge', 'questions', 'performance'],
  manager: ['dashboard', 'training', 'performance', 'reports', 'team'],
  reviewer: ['dashboard', 'performance', 'reports', 'security'],
  admin: ['dashboard', 'team', 'security', 'integrations', 'settings'],
};

/** Longest-prefix match so `/knowledge/kb_x/chunks` still highlights Knowledge. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const candidates = [item.href, ...(item.matches ?? [])];
  return candidates.some(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
}
