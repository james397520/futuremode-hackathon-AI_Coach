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
import { ROLE_LABEL, type Permission } from '@/lib/rbac';
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
 *     id, label, description?, icon?, keywords?: string[], onSelect: () => void
 *   }> }>
 */
interface PaletteItem {
  id: string;
  label: string;
  /** The kit renders this as the item's secondary line. */
  description?: string;
  icon?: React.ReactNode;
  keywords?: string[];
  /** Used only for the RBAC filter below; harmless extra field for the kit. */
  permission?: Permission;
  onSelect: () => void;
}

/**
 * The search rows print raw contract slugs, which would leak English into an
 * otherwise Chinese palette. These are display-only lookups; the slugs
 * themselves stay untouched.
 */
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿', generated: 'AI 產生', review_required: '需要審核',
  approved: '已核准', published: '已發布', archived: '已封存',
};

const DIFFICULTY_TEXT: Record<string, string> = {
  easy: '初階', medium: '中階', hard: '進階', expert: '專家',
};

const MODE_TEXT: Record<string, string> = { training: '訓練模式', assessment: '評測模式' };

const QUESTION_TYPE_TEXT: Record<string, string> = {
  multiple_choice: '單選題', true_false: '是非題', short_answer: '簡答題',
  open_ended: '申論題', scenario: '情境題', voice_response: '語音作答',
  role_play: '角色扮演', compliance: '合規題', objection_handling: '異議處理',
  knowledge_check: '知識檢核',
};

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
        label: '開始模擬練習',
        description: '選擇情境並開啟練習設定',
        icon: <PlayCircle size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['模擬', '練習', '對話', '開始', 'run', 'practice', 'session', 'live'],
        permission: 'simulation.start',
        onSelect: go('/simulations'),
      },
      {
        id: 'cmd-new-persona',
        label: '新增模擬人物',
        description: '身分設定、性格調節、隱藏狀態與語音',
        icon: <UserRound size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['客戶', '人物', '角色', '編輯器', 'customer', 'persona'],
        permission: 'persona.manage',
        onSelect: go('/personas/new'),
      },
      {
        id: 'cmd-upload-document',
        label: '上傳文件',
        description: 'PDF / DOCX / PPTX / TXT / CSV',
        icon: <Upload size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['檔案', '文件', '匯入', '知識庫', 'file', 'upload', 'pdf'],
        permission: 'knowledge.manage',
        onSelect: go('/knowledge?upload=1'),
      },
      {
        id: 'cmd-search-knowledge',
        label: '搜尋知識庫',
        description: '檢索測試場，可看相似度與重排分數',
        icon: <Search size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['知識庫', '檢索', '切片', '引用', 'rag', 'retrieval'],
        permission: 'knowledge.view',
        onSelect: go('/knowledge/kb_product_sop/playground'),
      },
      {
        id: 'cmd-assign-training',
        label: '指派訓練',
        description: '指定成員與團隊，設定截止日、次數與最低分數',
        icon: <GraduationCap size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['指派', '訓練', '截止日', '必修', 'assign', 'training'],
        permission: 'training.assign',
        onSelect: go('/training?assign=1'),
      },
      {
        id: 'cmd-view-report',
        label: '查看報表',
        description: '團隊、技能與合規報表',
        icon: <BarChart3 size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['報表', '數據', '團隊', '技能', '合規', 'report', 'analytics'],
        permission: 'report.view_team',
        onSelect: go('/reports/team'),
      },
      {
        id: 'cmd-open-security',
        label: '開啟安全與稽核',
        description: '風險事件、安全狀態與稽核紀錄',
        icon: <ShieldCheck size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['安全', '稽核', '合規', '風險', 'audit', 'security'],
        permission: 'security.view',
        onSelect: go('/security'),
      },
      {
        id: 'cmd-theme',
        label: mode === 'dark' ? '外觀主題 — 切換為淺色' : '外觀主題 — 切換為深色',
        description: '淺色 / 深色 / 跟隨系統',
        icon:
          mode === 'dark' ? (
            <Sun size={16} strokeWidth={1.7} aria-hidden />
          ) : (
            <Moon size={16} strokeWidth={1.7} aria-hidden />
          ),
        keywords: ['外觀', '主題', '深色', '淺色', 'theme', 'dark', 'light'],
        onSelect: () => {
          setMode(mode === 'dark' ? 'light' : 'dark');
          setOpen(false);
        },
      },
      {
        id: 'cmd-settings',
        label: '設定',
        description: '模型、AI 執行環境、語音、外觀與帳務',
        icon: <Settings size={16} strokeWidth={1.7} aria-hidden />,
        keywords: ['設定', '偏好', '模型', '執行環境', 'settings', 'runtime'],
        permission: 'settings.view',
        onSelect: go('/settings'),
      },
    ];

    /** §80 Global search — grouped results across the product entities. */
    const personas: PaletteItem[] = MOCK_PERSONAS.slice(0, 5).map((persona) => ({
      id: `persona-${persona.id}`,
      label: persona.name,
      description: [persona.occupation, `v${persona.version}`, STATUS_TEXT[persona.status] ?? persona.status]
        .filter(Boolean)
        .join(' · '),
      icon: <UserRound size={16} strokeWidth={1.7} aria-hidden />,
      keywords: [persona.industry ?? '', persona.locale],
      permission: 'persona.manage',
      onSelect: go(`/personas/${persona.id}`),
    }));

    const scenarios: PaletteItem[] = MOCK_SCENARIOS.slice(0, 5).map((scenario) => ({
      id: `scenario-${scenario.id}`,
      label: scenario.name,
      description: `${DIFFICULTY_TEXT[scenario.difficulty] ?? scenario.difficulty} · ${MODE_TEXT[scenario.mode] ?? scenario.mode} · v${scenario.version}`,
      icon: <PlayCircle size={16} strokeWidth={1.7} aria-hidden />,
      keywords: [scenario.training_type ?? '', scenario.industry ?? ''],
      permission: 'simulation.start',
      onSelect: go(`/simulations/${scenario.id}/setup`),
    }));

    const knowledge: PaletteItem[] = MOCK_KNOWLEDGE_BASES.map((kb) => ({
      id: `kb-${kb.id}`,
      label: kb.name,
      description: `${kb.document_count} 份文件 · ${kb.chunk_count.toLocaleString('en-US')} 個切片`,
      icon: <BookOpen size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'knowledge.view',
      onSelect: go(`/knowledge/${kb.id}`),
    }));

    const questions: PaletteItem[] = MOCK_QUESTIONS.slice(0, 4).map((question) => ({
      id: `question-${question.id}`,
      label: question.title,
      description: `${QUESTION_TYPE_TEXT[question.type] ?? question.type} · ${DIFFICULTY_TEXT[question.difficulty] ?? question.difficulty} · ${STATUS_TEXT[question.status] ?? question.status}`,
      icon: <ListChecks size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'question.manage',
      onSelect: go(`/questions/${question.id}/edit`),
    }));

    const people: PaletteItem[] = MOCK_USERS.slice(0, 5).map((user) => ({
      id: `user-${user.id}`,
      label: user.display_name,
      description: user.roles.map((role) => ROLE_LABEL[role]).join(' · '),
      icon: <Users size={16} strokeWidth={1.7} aria-hidden />,
      permission: 'team.review',
      onSelect: go(`/performance/${user.id}`),
    }));

    const reports: PaletteItem[] = [
      {
        id: 'report-team',
        label: '團隊報表',
        description: '平均分數、通過率、技能矩陣與弱項熱區圖',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/team'),
      },
      {
        id: 'report-skill',
        label: '技能報表',
        description: '各項技能拆解與知識缺口',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/skill'),
      },
      {
        id: 'report-compliance',
        label: '合規報表',
        description: '依類型、嚴重程度與審核狀態彙整的風險事件',
        icon: <FileText size={16} strokeWidth={1.7} aria-hidden />,
        permission: 'report.view_team',
        onSelect: go('/reports/compliance'),
      },
    ];

    const allow = (items: PaletteItem[]) =>
      items.filter((item) => !item.permission || can(item.permission));

    return [
      { id: 'commands', label: '指令', items: allow(commands) },
      { id: 'personas', label: '模擬人物', items: allow(personas) },
      { id: 'scenarios', label: '訓練情境', items: allow(scenarios) },
      { id: 'knowledge', label: '知識庫', items: allow(knowledge) },
      { id: 'questions', label: '題庫', items: allow(questions) },
      { id: 'reports', label: '報表', items: allow(reports) },
      { id: 'people', label: '成員', items: allow(people) },
    ].filter((group) => group.items.length > 0);
  }, [can, mode, router, setMode, setOpen]);

  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      placeholder="搜尋指令、模擬人物、知識庫、報表…"
      groups={groups}
    />
  );
}
