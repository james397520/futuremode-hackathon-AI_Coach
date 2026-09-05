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
        title="Question Bank"
        description="Knowledge checks, scenarios, voice prompts and compliance items. AI-generated questions cannot publish themselves."
        meta={
          awaitingReview > 0 ? (
            <Pill tone="warning" size="sm">{awaitingReview} awaiting review</Pill>
          ) : null
        }
        actions={
          canEdit ? (
            <>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/questions/generate">
                  <Sparkles size={15} strokeWidth={1.9} aria-hidden />
                  Generate with AI
                </Link>
              </Button>
              <Button variant="primary" size="sm" asChild>
                <Link href="/questions/new/edit">
                  <Plus size={15} strokeWidth={2} aria-hidden />
                  Create question
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
            Needs review
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
              placeholder="Filter questions…"
              aria-label="Filter questions"
              className="pl-9"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {questions.length === 0 ? (
        <EmptyState
          title="No question matches"
          description="Try another type, or generate a batch from a knowledge base."
          action={
            canEdit ? (
              <Button variant="secondary" size="sm" asChild>
                <Link href="/questions/generate">Generate with AI</Link>
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
                        <dt className="text-text-tertiary">Knowledge</dt>
                        <dd className="truncate">{kb.name}</dd>
                      </div>
                    ) : null}
                    {question.skill ? (
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Skill</dt>
                        <dd>{SKILL_LABEL[question.skill]}</dd>
                      </div>
                    ) : null}
                    <div className="flex gap-2">
                      <dt className="text-text-tertiary">Version</dt>
                      <dd className="tabular-nums">v{question.version}</dd>
                    </div>
                  </dl>

                  {/* §15 — an AI-generated item always shows its sources. */}
                  {question.citations && question.citations.length > 0 ? (
                    <div className="mt-3">
                      <p className="meta-label mb-1.5">Generated from</p>
                      <CitationList citations={question.citations} showScores={false} />
                    </div>
                  ) : null}

                  <p className="mt-3 text-tiny text-text-tertiary">
                    {question.reviewed_at
                      ? `Reviewed ${formatRelative(question.reviewed_at)}`
                      : needsReview
                        ? 'Not reviewed — cannot be assigned yet'
                        : `Updated ${formatRelative(question.updated_at)}`}
                  </p>

                  <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/questions/${question.id}/edit`}>{canEdit ? 'Edit' : 'View'}</Link>
                    </Button>
                    {needsReview && canEdit ? (
                      <Button variant="primary" size="sm" asChild>
                        <Link href={`/questions/${question.id}/edit?review=1`}>Review</Link>
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
