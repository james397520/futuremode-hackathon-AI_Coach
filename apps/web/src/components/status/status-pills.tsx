import type {
  ComplianceRisk,
  ContentStatus,
  Difficulty,
  DocumentState,
  SessionMode,
} from '@ai-coach/shared';
import { Pill } from '@/components/ui';

type Tone = 'gradient' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const CONTENT_STATUS: Record<ContentStatus, { label: string; tone: Tone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  generated: { label: 'AI 產生', tone: 'info' },
  review_required: { label: '需要審核', tone: 'warning' },
  approved: { label: '已核准', tone: 'success' },
  published: { label: '已發布', tone: 'success' },
  archived: { label: '已封存', tone: 'neutral' },
};

const DOCUMENT_STATE: Record<DocumentState, { label: string; tone: Tone }> = {
  uploaded: { label: '已上傳', tone: 'neutral' },
  validating: { label: '驗證中', tone: 'info' },
  parsing: { label: '解析中', tone: 'info' },
  chunking: { label: '切分中', tone: 'info' },
  embedding: { label: '向量化中', tone: 'info' },
  indexing: { label: '建立索引中', tone: 'info' },
  ready: { label: '已就緒', tone: 'success' },
  failed: { label: '發生錯誤', tone: 'danger' },
};

const RISK: Record<ComplianceRisk, { label: string; tone: Tone }> = {
  safe: { label: '安全', tone: 'success' },
  low: { label: '低風險', tone: 'success' },
  medium: { label: '中風險', tone: 'warning' },
  high: { label: '高風險', tone: 'danger' },
  critical: { label: '重大風險', tone: 'danger' },
};

const DIFFICULTY: Record<Difficulty, { label: string; tone: Tone }> = {
  easy: { label: '初階', tone: 'neutral' },
  medium: { label: '中階', tone: 'info' },
  hard: { label: '進階', tone: 'warning' },
  expert: { label: '專家', tone: 'danger' },
};

/** §38 Part I approval workflow states. Text label always present (§47). */
export function ContentStatusPill({ status }: { status: ContentStatus }) {
  const meta = CONTENT_STATUS[status];
  return <Pill tone={meta.tone} size="sm">{meta.label}</Pill>;
}

/** §27 Part II document card status: Ready / Parsing / Embedding / Error. */
export function DocumentStatePill({ state }: { state: DocumentState }) {
  const meta = DOCUMENT_STATE[state];
  return <Pill tone={meta.tone} size="sm">{meta.label}</Pill>;
}

export function RiskPill({ risk }: { risk: ComplianceRisk }) {
  const meta = RISK[risk];
  return <Pill tone={meta.tone} size="sm">{meta.label}</Pill>;
}

export function DifficultyPill({ difficulty }: { difficulty: Difficulty }) {
  const meta = DIFFICULTY[difficulty];
  return <Pill tone={meta.tone} size="sm">{meta.label}</Pill>;
}

/** §8.4 — assessment mode disables hints, coach cards and knowledge peeking. */
export function ModePill({ mode }: { mode: SessionMode }) {
  return (
    <Pill tone={mode === 'assessment' ? 'warning' : 'neutral'} size="sm">
      {mode === 'assessment' ? '評測模式' : '訓練模式'}
    </Pill>
  );
}
