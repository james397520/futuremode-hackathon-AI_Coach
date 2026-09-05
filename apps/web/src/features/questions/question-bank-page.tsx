'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { QuestionType } from '@ai-coach/shared';
import { Plus, Search, Sparkles } from 'lucide-react';
import { Button, EmptyState, GlassCard, Input, Pill, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill } from '@/components/status';
import { CitationList } from '@/components/transcript';
import { MOCK_QUESTIONS, QUESTION_TABS, QUESTION_TYPE_LABEL } from '@/lib/fixtures/questions';
import { knowledgeBaseById } from '@/lib/fixtures/knowledge';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { formatRelative } from '@/lib/utils';

/** §32 Question Bank. */
export function QuestionBankPage() {
  const canEdit = useCan('question.manage');
  const searchParams = useSearchParams();
  const statusParam = searchParams.get('status');

  const [tab, setTab] = useState<'all' | QuestionType>('all');
  const [query, setQuery] = useState('');
  const [reviewOnly, setReviewOnly] = useState(statusParam === 'generated' || statusParam === 'review_required');

  const questions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return MOCK_QUESTIONS.filter((question) => {
      if (tab !== 'all' && question.type !== tab) return false;
      if (reviewOnly && !['generated', 'review_required'].includes(question.status)) return false;
      if (!term) return true;
      return [question.title, question.prompt, question.category, ...question.tags]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [tab, query, reviewOnly]);

  const awaitingReview = MOCK_QUESTIONS.filter((question) =>
    ['generated', 'review_required'].includes(question.status),
  ).length;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="題庫"
        description="知識檢核、情境、語音提問與合規題目。AI 生成的題目無法自行發布。"
        meta={
          awaitingReview > 0 ? (
            <Pill tone="warning" size="sm">{awaitingReview} 題待審核</Pill>
          ) : null
        }
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/questions/generate">
                  <Sparkles size={15} strokeWidth={1.9} aria-hidden />
                  用 AI 生成
                </Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href="/questions/new/edit">
                  <Plus size={15} strokeWidth={2} aria-hidden />
                  新增題目
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={tab}
          onValueChange={(value: string) => setTab(value as 'all' | QuestionType)}
          items={QUESTION_TABS.map((entry) => ({
            value: entry.value,
            label: entry.label,
            count:
              entry.value === 'all'
                ? MOCK_QUESTIONS.length
                : MOCK_QUESTIONS.filter((question) => question.type === entry.value).length,
          }))}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={reviewOnly ? 'subtle' : 'ghost'}
            size="sm"
            aria-pressed={reviewOnly}
            onClick={() => setReviewOnly((prev) => !prev)}
          >
            待審核
          </Button>
          <div className="relative w-full max-w-xs">
            <Search
              size={15}
              strokeWidth={1.8}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <Input
              type="search"
              value={query}
              placeholder="篩選題目…"
              aria-label="篩選題目"
              className="pl-9"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {questions.length === 0 ? (
        <EmptyState
          title="沒有符合的題目"
          description="換一種題型，或從知識庫生成一批題目。"
          action={
            canEdit ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href="/questions/generate">用 AI 生成</Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {questions.map((question) => {
            const kb = question.knowledge_base_id ? knowledgeBaseById(question.knowledge_base_id) : undefined;
            const needsReview = ['generated', 'review_required'].includes(question.status);

            return (
              <li key={question.id}>
                <GlassCard className="flex h-full flex-col p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <Pill tone="neutral" size="sm">{QUESTION_TYPE_LABEL[question.type]}</Pill>
                    <DifficultyPill difficulty={question.difficulty} />
                    <ContentStatusPill status={question.status} />
                    {question.generated_by_model ? (
                      <Pill tone="gradient" size="sm">
                        <Sparkles size={11} strokeWidth={2} aria-hidden />
                        AI
                      </Pill>
                    ) : null}
                  </div>

                  <h2 className="text-body-sm font-semibold">{question.title}</h2>
                  <p className="mt-1.5 line-clamp-4 text-body text-text-primary">{question.prompt}</p>

                  <dl className="mt-3 space-y-1 text-body-sm">
                    {kb ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">知識庫</dt>
                        <dd className="truncate">{kb.name}</dd>
                      </div>
                    ) : null}
                    {question.skill ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">技能</dt>
                        <dd>{SKILL_LABEL[question.skill]}</dd>
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">版本</dt>
                      <dd className="tabular-nums">v{question.version}</dd>
                    </div>
                  </dl>

                  {/* §15 — an AI-generated item always shows its sources. */}
                  {question.citations && question.citations.length > 0 ? (
                    <div className="mt-3">
                      <p className="meta-label mb-1.5">生成依據</p>
                      <CitationList citations={question.citations} showScores={false} />
                    </div>
                  ) : null}

                  <p className="mt-3 text-tiny text-text-tertiary">
                    {question.reviewed_at
                      ? `審核於 ${formatRelative(question.reviewed_at)}`
                      : needsReview
                        ? '尚未審核 — 還不能指派'
                        : `更新於 ${formatRelative(question.updated_at)}`}
                  </p>

                  <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/questions/${question.id}/edit`}>{canEdit ? '編輯' : '檢視'}</Link>
                    </Button>
                    {needsReview && canEdit ? (
                      <Button variant="primary" size="sm" asChild>
                        <Link href={`/questions/${question.id}/edit?review=1`}>審核</Link>
                      </Button>
                    ) : null}
                  </div>
                </GlassCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
