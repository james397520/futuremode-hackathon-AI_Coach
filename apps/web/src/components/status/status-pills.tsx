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
  draft: { label: 'Draft', tone: 'neutral' },
  generated: { label: 'AI generated', tone: 'info' },
  review_required: { label: 'Review required', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  published: { label: 'Published', tone: 'success' },
  archived: { label: 'Archived', tone: 'neutral' },
};

const DOCUMENT_STATE: Record<DocumentState, { label: string; tone: Tone }> = {
  uploaded: { label: 'Uploaded', tone: 'neutral' },
  validating: { label: 'Validating', tone: 'info' },
  parsing: { label: 'Parsing', tone: 'info' },
  chunking: { label: 'Chunking', tone: 'info' },
  embedding: { label: 'Embedding', tone: 'info' },
  indexing: { label: 'Indexing', tone: 'info' },
  ready: { label: 'Ready', tone: 'success' },
  failed: { label: 'Error', tone: 'danger' },
};

const RISK: Record<ComplianceRisk, { label: string; tone: Tone }> = {
  safe: { label: 'Safe', tone: 'success' },
  low: { label: 'Low risk', tone: 'success' },
  medium: { label: 'Medium risk', tone: 'warning' },
  high: { label: 'High risk', tone: 'danger' },
  critical: { label: 'Critical', tone: 'danger' },
};

const DIFFICULTY: Record<Difficulty, { label: string; tone: Tone }> = {
  easy: { label: 'Easy', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'info' },
  hard: { label: 'Hard', tone: 'warning' },
  expert: { label: 'Expert', tone: 'danger' },
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
      {mode === 'assessment' ? 'Assessment mode' : 'Training mode'}
    </Pill>
  );
}
