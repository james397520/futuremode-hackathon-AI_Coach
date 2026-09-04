'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  BarChart3,
  BookOpen,
  FileText,
  GraduationCap,
  ListChecks,
  Moon,
  PlayCircle,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import { CommandPalette } from '@/components/ui';
import { useTheme } from '@/components/theme';
import { useAuth } from '@/lib/auth-context';
import type { Permission } from '@/lib/rbac';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { MOCK_PERSONAS } from '@/lib/fixtures/personas';
import { MOCK_SCENARIOS } from '@/lib/fixtures/scenarios';
import { MOCK_QUESTIONS } from '@/lib/fixtures/questions';
import { MOCK_USERS } from '@/lib/fixtures/identity';
import { useShellStore } from '@/components/app-shell/shell-store';

/**
 * §79 Command Palette + §80 Global Search.
 *
 * `CommandPalette` from packages/ui owns the modal, fuzzy filter and keyboard
 * loop. This component only supplies the command set and the RBAC filter.
 *
 * Assumed prop shape (documented in src/components/ui.ts):
 *   groups: Array<{ id, label, items: Array<{
 *     id, label, hint?, icon?, keywords?: string[], onSelect: () => void
 *   }> }>
 */
interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  keywords?: string[];
  permission?: Permission;
  onSelect: () => void;
}

export function AppCommandPalette() {
  const router = useRouter();
  const { can } = useAuth();
  const { mode, setMode } = useTheme();
  const open = useShellStore((state) => state.commandPaletteOpen);
  const setOpen = useShellStore((state) => state.setCommandPaletteOpen);

  const groups = useMemo(() => {
    const go = (href: string) => () => {
      setOpen(false);
      router.push(href);
    };

    /** §79 — the nine core commands, in spec order. */
    const commands: PaletteItem[] = [
      {
        id: 'cmd-start-simulation',
        label: 'Start Simulation',
        hint: 'Pick a scenario and open setup',
        icon: <PlayCircle size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['run', 'practice', 'session', 'live'],
        permission: 'simulation.start',
        onSelect: go('/simulations'),
      },
      {
        id: 'cmd-new-persona',
        label: 'New Persona',
        hint: 'Identity, sliders, hidden state, voice',
        icon: <UserRound size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['customer', 'character', 'builder'],
        permission: 'persona.manage',
        onSelect: go('/personas/new'),
      },
      {
        id: 'cmd-upload-document',
        label: 'Upload Document',
        hint: 'PDF / DOCX / PPTX / TXT / CSV',
        icon: <Upload size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['file', 'ingest', 'knowledge', 'pdf'],
        permission: 'knowledge.manage',
        onSelect: go('/knowledge?upload=1'),
      },
      {
        id: 'cmd-search-knowledge',
        label: 'Search Knowledge',
        hint: 'Retrieval playground with similarity and rerank scores',
        icon: <Search size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['rag', 'retrieval', 'chunks', 'citation'],
        permission: 'knowledge.view',
        onSelect: go('/knowledge/kb_product_sop/playground'),
      },
      {
        id: 'cmd-assign-training',
        label: 'Assign Training',
        hint: 'Users, teams, deadline, attempts, minimum score',
        icon: <GraduationCap size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['assignment', 'deadline', 'mandatory'],
        permission: 'training.assign',
        onSelect: go('/training?assign=1'),
      },
      {
        id: 'cmd-view-report',
        label: 'View Report',
        hint: 'Team, skill and compliance reporting',
        icon: <BarChart3 size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['analytics', 'team', 'skill', 'compliance'],
        permission: 'report.view_team',
        onSelect: go('/reports/team'),
      },
      {
        id: 'cmd-open-security',
        label: 'Open Security',
        hint: 'Findings, safety posture, audit log',
        icon: <ShieldCheck size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['audit', 'compliance', 'findings', 'injection'],
        permission: 'security.view',
        onSelect: go('/security'),
      },
      {
        id: 'cmd-theme',
        label: mode === 'dark' ? 'Theme — switch to Light' : 'Theme — switch to Dark',
        hint: 'Light / Dark / System',
        icon:
          mode === 'dark' ? (
            <Sun size={16} strokeWidth={1.7} aria-hidden />
          ) : (
            <Moon size={16} strokeWidth={1.7} aria-hidden />
          ),
        keywords: ['appearance', 'dark mode', 'light mode'],
        onSelect: () => {
          setMode(mode === 'dark' ? 'light' : 'dark');
          setOpen(false);
        },
      },
      {
        id: 'cmd-settings',
        label: 'Settings',
        hint: 'Models, AI runtime, voice, appearance, billing',
        icon: <Settings size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['preferences', 'models', 'runtime'],
        permission: 'settings.view',
        onSelect: go('/settings'),
      },
    ];

    /** §80 Global search — grouped results across the product entities. */
    const personas: PaletteItem[] = MOCK_PERSONAS.slice(0, 5).map((persona) => ({
      id: `persona-${persona.id}`,
      label: persona.name,
      hint: [persona.occupation, `v${persona.version}`, persona.status].filter(Boolean).join(' · '),
      icon: <UserRound size={16} strokeWidth={1.7} aria-hidden />,
      keywords: [persona.industry ?? '', persona.locale],
      permission: 'persona.manage',
      onSelect: go(`/personas/${persona.id}`),
    }));

    const scenarios: PaletteItem[] = MOCK_SCENARIOS.slice(0, 5).map((scenario) => ({
      id: `scenario-${scenario.id}`,
      label: scenario.name,
      hint: `${scenario.difficulty} · ${scenario.mode} · v${scenario.version}`,
      icon: <PlayCircle size={16} strokeWidth={1.7} aria-hidden />,
      keywords: [scenario.training_type ?? '', scenario.industry ?? ''],
      permission: 'simulation.start',
      onSelect: go(`/simulations/${scenario.id}/setup`),
    }));

    const knowledge: PaletteItem[] = MOCK_KNOWLEDGE_BASES.map((kb) => ({
      id: `kb-${kb.id}`,
      label: kb.name,
      hint: `${kb.document_count} documents · ${kb.chunk_count.toLocaleString('en-US')} chunks`,
      icon: <BookOpen size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'knowledge.view',
      onSelect: go(`/knowledge/${kb.id}`),
    }));

    const questions: PaletteItem[] = MOCK_QUESTIONS.slice(0, 4).map((question) => ({
      id: `question-${question.id}`,
      label: question.title,
      hint: `${question.type} · ${question.difficulty} · ${question.status}`,
      icon: <ListChecks size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'question.manage',
      onSelect: go(`/questions/${question.id}/edit`),
    }));

    const people: PaletteItem[] = MOCK_USERS.slice(0, 5).map((user) => ({
      id: `user-${user.id}`,
      label: user.display_name,
      hint: user.roles.join(' · '),
      icon: <Users size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'team.review',
      onSelect: go(`/performance/${user.id}`),
    }));

    const reports: PaletteItem[] = [
      {
        id: 'report-team',
        label: 'Team report',
        hint: 'Average, pass rate, skill matrix, weakness heatmap',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/team'),
      },
      {
        id: 'report-skill',
        label: 'Skill report',
        hint: 'Per-skill breakdown and knowledge gaps',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/skill'),
      },
      {
        id: 'report-compliance',
        label: 'Compliance report',
        hint: 'Findings by type, severity and reviewer status',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/compliance'),
      },
    ];

    const allow = (items: PaletteItem[]) =>
      items.filter((item) => !item.permission || can(item.permission));

    return [
      { id: 'commands', label: 'Commands', items: allow(commands) },
      { id: 'personas', label: 'Personas', items: allow(personas) },
      { id: 'scenarios', label: 'Scenarios', items: allow(scenarios) },
      { id: 'knowledge', label: 'Knowledge', items: allow(knowledge) },
      { id: 'questions', label: 'Questions', items: allow(questions) },
      { id: 'reports', label: 'Reports', items: allow(reports) },
      { id: 'people', label: 'People', items: allow(people) },
    ].filter((group) => group.items.length > 0);
  }, [can, mode, router, setMode, setOpen]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      placeholder="Search commands, personas, knowledge, reports…"
      groups={groups}
    />
  );
}
