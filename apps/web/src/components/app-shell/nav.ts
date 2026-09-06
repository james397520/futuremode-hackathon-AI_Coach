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
    description: '訓練總覽、今日目標與即時指標',
  },
  {
    id: 'simulations',
    label: '模擬練習',
    href: '/simulations',
    icon: PlayCircle,
    permission: 'simulation.start',
    description: '情境庫、進行中的練習與成果回顧',
  },
  {
    id: 'training',
    label: '我的訓練',
    href: '/training',
    icon: GraduationCap,
    permission: 'training.view_assigned',
    description: '指派任務、截止日與完成條件',
  },
  {
    id: 'personas',
    label: '模擬人物',
    href: '/personas',
    icon: UserRound,
    permission: 'persona.manage',
    description: '人物編輯器、隱藏狀態與測試室',
  },
  {
    id: 'scenarios',
    label: '訓練情境',
    href: '/scenarios',
    icon: SlidersHorizontal,
    permission: 'scenario.manage',
    description: '九步驟情境編輯器與版本管理',
  },
  {
    id: 'knowledge',
    label: '知識庫',
    href: '/knowledge',
    icon: BookOpen,
    permission: 'knowledge.view',
    description: '文件、切片、檢索測試與知識探勘',
  },
  {
    id: 'questions',
    label: '題庫',
    href: '/questions',
    icon: ListChecks,
    permission: 'question.manage',
    description: '題庫、AI 出題與人工審核',
  },
  {
    id: 'performance',
    label: '成效回顧',
    href: '/performance',
    icon: TrendingUp,
    permission: 'performance.view_own',
    description: '個人成長軌跡、有憑有據的評分與時間軸',
  },
  {
    id: 'reports',
    label: '報表',
    href: '/reports/team',
    icon: BarChart3,
    permission: 'report.view_team',
    matches: ['/reports'],
    description: '團隊、技能與合規報表',
  },
  {
    id: 'team',
    label: '團隊',
    href: '/team',
    icon: Users,
    permission: 'team.review',
    description: '成員、身份與備戰狀態',
  },
  {
    id: 'security',
    label: '安全與稽核',
    href: '/security',
    icon: ShieldCheck,
    permission: 'security.view',
    description: '風險事件、安全狀態與稽核紀錄',
  },
  {
    id: 'integrations',
    label: '整合服務',
    href: '/integrations',
    icon: Plug,
    permission: 'integration.manage',
    description: '模型、語音、向量資料庫、CRM、LMS 與身分驗證連接器',
  },
  {
    id: 'settings',
    label: '設定',
    href: '/settings',
    icon: Settings,
    permission: 'settings.view',
    description: '模型、AI 執行環境、語音、外觀、個人資料與帳務',
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
