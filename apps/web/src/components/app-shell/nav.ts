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
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    permission: 'dashboard.view',
    description: 'Training overview, today’s objective and live KPIs',
  },
  {
    id: 'simulations',
    label: 'Simulations',
    href: '/simulations',
    icon: PlayCircle,
    permission: 'simulation.start',
    description: 'Scenario library, live sessions and session review',
  },
  {
    id: 'training',
    label: 'Training',
    href: '/training',
    icon: GraduationCap,
    permission: 'training.view_assigned',
    description: 'Assignments, deadlines and completion rules',
  },
  {
    id: 'personas',
    label: 'Personas',
    href: '/personas',
    icon: UserRound,
    permission: 'persona.manage',
    description: 'Persona builder, hidden state and test lab',
  },
  {
    id: 'scenarios',
    label: 'Scenarios',
    href: '/scenarios',
    icon: SlidersHorizontal,
    permission: 'scenario.manage',
    description: 'Nine-step scenario builder and versioning',
  },
  {
    id: 'knowledge',
    label: 'Knowledge Base',
    href: '/knowledge',
    icon: BookOpen,
    permission: 'knowledge.view',
    description: 'Documents, chunks, retrieval playground and mining',
  },
  {
    id: 'questions',
    label: 'Question Bank',
    href: '/questions',
    icon: ListChecks,
    permission: 'question.manage',
    description: 'Question bank, AI generation and human review',
  },
  {
    id: 'performance',
    label: 'Performance Review',
    href: '/performance',
    icon: TrendingUp,
    permission: 'performance.view_own',
    description: 'Individual growth, evidence-backed scores and timelines',
  },
  {
    id: 'reports',
    label: 'Reports',
    href: '/reports/team',
    icon: BarChart3,
    permission: 'report.view_team',
    matches: ['/reports'],
    description: 'Team, skill and compliance reporting',
  },
  {
    id: 'team',
    label: 'Team',
    href: '/team',
    icon: Users,
    permission: 'team.review',
    description: 'People, roles and readiness',
  },
  {
    id: 'security',
    label: 'Security & Audit',
    href: '/security',
    icon: ShieldCheck,
    permission: 'security.view',
    description: 'Findings, safety posture and the audit log',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    href: '/integrations',
    icon: Plug,
    permission: 'integration.manage',
    description: 'Model, voice, vector, CRM, LMS and identity connectors',
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '/settings',
    icon: Settings,
    permission: 'settings.view',
    description: 'Models, AI runtime, voice, appearance, profile and billing',
  },
];

/** Longest-prefix match so `/knowledge/kb_x/chunks` still highlights Knowledge. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const candidates = [item.href, ...(item.matches ?? [])];
  return candidates.some(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
}
