'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Question, QuestionType } from '@ai-coach/shared';
import { AlertTriangle, Check, Save, Sparkles, X } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill } from '@/components/status';
import { CitationList } from '@/components/transcript';
import { MOCK_QUESTIONS, QUESTION_TYPE_LABEL, questionById } from '@/lib/fixtures/questions';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { SCOPE } from '@/lib/fixtures/constants';
import { useCan } from '@/lib/auth-context';
import { formatRelative } from '@/lib/utils';

/** The same Chinese difficulty wording `DifficultyPill` uses (`components/status`). */
const DIFFICULTY_LABEL: Record<Question['difficulty'], string> = {
  easy: '初階', medium: '中階', hard: '進階', expert: '專家',
};

const EMPTY: Question = {
  id: 'new',
  ...SCOPE,
  title: '',
  type: 'multiple_choice',
  prompt: '',
  difficulty: 'medium',
  required_keywords: [],
  forbidden_claims: [],
  compliance_rules: [],
  tags: [],
  version: 1,
  status: 'draft',
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * §58-22 Question Editor, with the §15 / §38 **review-before-publish gate**.
 *
 * A `generated` or `review_required` question shows the review bar at the top:
 * it cannot be assigned until a reviewer approves it, and the sources it was
 * generated from are always visible next to the prompt.
 */
export function QuestionEditorPage({ questionId, reviewMode }: { questionId: string; reviewMode?: boolean }) {
  const canEdit = useCan('question.manage');
  const canPublish = useCan('content.publish');
  const isNew = questionId === 'new';

  const source = useMemo(() => (isNew ? EMPTY : questionById(questionId) ?? EMPTY), [isNew, questionId]);
  const [draft, setDraft] = useState<Question>(source);
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // `reviewMode` comes from ?review=1 (the "Review" action in the bank), which
  // surfaces the gate even for an item whose status has already moved on.
  const needsReview = Boolean(reviewMode) || ['generated', 'review_required'].includes(draft.status);

  const list = (values: string[]) => values.join('\n');
  const parseList = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '題庫', href: '/questions' },
          { label: isNew ? '新題目' : draft.title || '題目' },
        ]}
        title={isNew ? '新題目' : draft.title || '題目編輯器'}
        description={QUESTION_TYPE_LABEL[draft.type]}
        meta={
          <>
            <ContentStatusPill status={draft.status} />
            <DifficultyPill difficulty={draft.difficulty} />
            <Pill tone="neutral" size="sm">v{draft.version}</Pill>
            {draft.generated_by_model ? (
              <Pill tone="gradient" size="sm">
                <Sparkles size={11} strokeWidth={2} aria-hidden />
                {draft.generated_by_model}
              </Pill>
            ) : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!canEdit}>
              <Save size={15} strokeWidth={1.8} aria-hidden />
              儲存
            </Button>
            <Button variant="primary" size="sm" disabled={!canPublish || needsReview}>
              發布
            </Button>
          </>
        }
      />

      {/* Review gate (§15 / §38) */}
      {needsReview ? (
        <GlassCard className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={18}
                strokeWidth={1.8}
                aria-hidden
                className="mt-0.5 text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]"
              />
              <div>
                <h2 className="text-card-title">發布前必須經過人工審核</h2>
                <p className="mt-1 max-w-2xl text-body-sm text-text-secondary">
                  {draft.generated_by_model
                    ? `由 ${draft.generated_by_model} 生成。請對照引用段落查核內容、確認正確答案，並確認沒有隱含任何禁用話術。`
                    : '這則題目被標記為需要審核。在審核者核准之前無法指派。'}
                </p>
                {decision !== 'pending' ? (
                  <p className="mt-2 text-body-sm">
                    <Pill tone={decision === 'approved' ? 'success' : 'danger'} size="sm">
                      {decision === 'approved' ? '本次已核准' : '本次已退回'}
                    </Pill>
                  </p>
                ) : null}
              </div>
            </div>

            {canPublish ? (
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDecision('rejected')}>
                  <X size={15} strokeWidth={2} aria-hidden />
                  退回
                </Button>
                <Button variant="primary" size="sm" onClick={() => setDecision('approved')}>
                  <Check size={15} strokeWidth={2} aria-hidden />
                  核准
                </Button>
              </div>
            ) : (
              <p className="text-body-sm text-text-tertiary">你的角色沒有核准內容的權限。</p>
            )}
          </div>
        </GlassCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <GlassCard className="space-y-4 p-5">
            <h2 className="text-card-title">題目</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="標題" hint="在清單與報表中顯示的內部名稱。">
                <Input
                  value={draft.title}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, title: e.target.value })}
                />
              </Field>
              <Field label="題型">
                <Select
                  value={draft.type}
                  onValueChange={(value: string) => setDraft({ ...draft, type: value as QuestionType })}
                  options={(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((type) => ({
                    value: type,
                    label: QUESTION_TYPE_LABEL[type],
                  }))}
                />
              </Field>
              <Field label="難度">
                <Select
                  value={draft.difficulty}
                  onValueChange={(value: string) => setDraft({ ...draft, difficulty: value as Question['difficulty'] })}
                  options={[
                    { value: 'easy', label: DIFFICULTY_LABEL.easy },
                    { value: 'medium', label: DIFFICULTY_LABEL.medium },
                    { value: 'hard', label: DIFFICULTY_LABEL.hard },
                    { value: 'expert', label: DIFFICULTY_LABEL.expert },
                  ]}
                />
              </Field>
              <Field label="知識庫">
                <Select
                  value={draft.knowledge_base_id ?? ''}
                  onValueChange={(value: string) => setDraft({ ...draft, knowledge_base_id: value || undefined })}
                  options={[
                    { value: '', label: '未連結知識庫' },
                    ...MOCK_KNOWLEDGE_BASES.map((kb) => ({ value: kb.id, label: kb.name })),
                  ]}
                />
              </Field>
              <Field label="分類">
                <Input
                  value={draft.category ?? ''}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, category: e.target.value })}
                />
              </Field>
              <Field label="技能維度">
                <Select
                  value={draft.skill ?? ''}
                  onValueChange={(value: string) =>
                    setDraft({ ...draft, skill: (value || undefined) as Question['skill'] })
                  }
                  options={[
                    { value: '', label: '未對應' },
                    ...Object.entries(SKILL_LABEL).map(([key, label]) => ({ value: key, label })),
                  ]}
                />
              </Field>
            </div>

            <Field label="題目內容" hint="學員會讀到或聽到的內容。">
              <Textarea
                rows={4}
                value={draft.prompt}
                disabled={!canEdit}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </Field>

            {['multiple_choice', 'true_false', 'short_answer'].includes(draft.type) ? (
              <Field label="正確答案">
                <Input
                  value={draft.correct_answer ?? ''}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, correct_answer: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="評分規準" hint="開放式作答的評分依據。開放式與角色扮演題目必填。">
                <Textarea
                  rows={3}
                  value={draft.rubric ?? ''}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, rubric: e.target.value })}
                />
              </Field>
            )}

            <Field label="解析" hint="送出作答後顯示。">
              <Textarea
                rows={3}
                value={draft.explanation ?? ''}
                disabled={!canEdit}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, explanation: e.target.value })}
              />
            </Field>
          </GlassCard>

          <GlassCard className="space-y-4 p-5">
            <h2 className="text-card-title">評分防呆條件</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="必要關鍵字" hint="一行一個。">
                <Textarea
                  rows={4}
                  value={list(draft.required_keywords)}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft({ ...draft, required_keywords: parseList(e.target.value) })
                  }
                />
              </Field>
              <Field label="禁用話術" hint="一行一個。出現這些說法會直接不及格。">
                <Textarea
                  rows={4}
                  value={list(draft.forbidden_claims)}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft({ ...draft, forbidden_claims: parseList(e.target.value) })
                  }
                />
              </Field>
              <Field label="合規條款" hint="政策代碼，一行一個。">
                <Textarea
                  rows={3}
                  value={list(draft.compliance_rules)}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft({ ...draft, compliance_rules: parseList(e.target.value) })
                  }
                />
              </Field>
              <Field label="標籤" hint="一行一個。">
                <Textarea
                  rows={3}
                  value={list(draft.tags)}
                  disabled={!canEdit}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setDraft({ ...draft, tags: parseList(e.target.value) })
                  }
                />
              </Field>
            </div>
          </GlassCard>
        </div>

        <div className="space-y-4">
          {draft.citations && draft.citations.length > 0 ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">來源引用</h2>
              <p className="mt-1 text-body-sm text-text-secondary">
                每一則 AI 生成的題目都會帶著它取材的段落。核准前請先對照這些段落查核內容。
              </p>
              <CitationList className="mt-3" citations={draft.citations} />
            </GlassCard>
          ) : null}

          <GlassCard className="p-5">
            <h2 className="text-card-title">預覽</h2>
            <div className="mt-3 rounded-card-sm border border-border-soft bg-glass-card p-4">
              <p className="text-tiny uppercase text-text-tertiary">
                {QUESTION_TYPE_LABEL[draft.type]} · {DIFFICULTY_LABEL[draft.difficulty]}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-body">
                {draft.prompt || '題目內容會顯示在這裡。'}
              </p>
              {draft.type === 'true_false' ? (
                <div className="mt-3 flex gap-2">
                  <Pill tone="neutral" size="sm">是</Pill>
                  <Pill tone="neutral" size="sm">否</Pill>
                </div>
              ) : null}
              {draft.type === 'voice_response' ? (
                <p className="mt-3 text-tiny text-text-tertiary">以語音作答 · 限時 60 秒</p>
              ) : null}
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="text-card-title">異動紀錄</h2>
            <ul className="mt-3 space-y-2 text-body-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-text-tertiary">建立</span>
                <span>{isNew ? '尚未儲存' : formatRelative(draft.created_at)}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-text-tertiary">更新</span>
                <span>{isNew ? '—' : formatRelative(draft.updated_at)}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-text-tertiary">審核者</span>
                <span>{draft.reviewer_id ?? '尚未審核'}</span>
              </li>
            </ul>
            <p className="mt-4 text-tiny text-text-tertiary">
              每次編輯都會遞增版本號，並記錄在稽核日誌中。
            </p>
          </GlassCard>

          <p className="text-tiny text-text-tertiary">
            此工作區共有 {MOCK_QUESTIONS.length} 道題目 ·{' '}
            <Link
              href="/questions"
              className="text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
            >
              回到題庫
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
