'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Difficulty, Question, QuestionType } from '@ai-coach/shared';
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, StepProgress, Switch } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill } from '@/components/status';
import { CitationList } from '@/components/transcript';
import {
  GENERATION_TOPIC_SUGGESTIONS,
  MOCK_QUESTIONS,
  QUESTION_GENERATION_STEPS,
  QUESTION_TYPE_LABEL,
} from '@/lib/fixtures/questions';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

const GENERATED: Question[] = MOCK_QUESTIONS.filter((question) => Boolean(question.generated_by_model));

/** The same Chinese difficulty wording `DifficultyPill` uses (`components/status`). */
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: '初階', medium: '中階', hard: '進階', expert: '專家',
};

const TYPE_CHOICES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'short_answer',
  'open_ended',
  'scenario',
  'compliance',
];

/**
 * §33 AI Question Generation.
 *
 * Flow: Knowledge → Topics → Question type → Difficulty → Generate →
 * **Human review** → Publish. The review step is not skippable, and the success
 * banner is the small gradient pill from §86 rather than a full-width colour block.
 */
export function QuestionGeneratorPage() {
  const canEdit = useCan('question.manage');
  const canPublish = useCan('content.publish');

  const [step, setStep] = useState(0);
  const [kbId, setKbId] = useState(MOCK_KNOWLEDGE_BASES[0]?.id ?? '');
  const [topics, setTopics] = useState<string[]>([GENERATION_TOPIC_SUGGESTIONS[0] ?? '']);
  const [types, setTypes] = useState<QuestionType[]>(['multiple_choice', 'scenario']);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [count, setCount] = useState(20);
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});

  const total = QUESTION_GENERATION_STEPS.length;
  const currentStep = QUESTION_GENERATION_STEPS[step];
  const approvedCount = Object.values(decisions).filter((value) => value === 'approved').length;

  const toggleTopic = (topic: string) =>
    setTopics((prev) => (prev.includes(topic) ? prev.filter((entry) => entry !== topic) : [...prev, topic]));

  const toggleType = (type: QuestionType) =>
    setTypes((prev) => (prev.includes(type) ? prev.filter((entry) => entry !== type) : [...prev, type]));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: '題庫', href: '/questions' }, { label: '用 AI 生成' }]}
        title="AI 出題工具"
        description={`第 ${step + 1} / ${total} 步 — ${currentStep?.label ?? ''}`}
        meta={<Pill tone="warning" size="sm">未經人工審核，一律不會發布</Pill>}
      />

      <GlassCard className="p-5">
        <StepProgress
          orientation="horizontal"
          aria-label="出題流程步驟"
          steps={QUESTION_GENERATION_STEPS.map((entry) => ({ id: entry.id, label: entry.label }))}
          current={step}
        />
      </GlassCard>

      <GlassCard className="p-6">
        {step === 0 ? (
          <section className="space-y-4">
            <h2 className="text-section">知識庫</h2>
            <p className="text-body-sm text-text-secondary">
              題目會以單一知識庫的段落為依據生成，而且每則題目都會保留引用來源，方便審核者查核內容。
            </p>
            <ul className="space-y-2">
              {MOCK_KNOWLEDGE_BASES.map((kb) => (
                <li key={kb.id}>
                  <button
                    type="button"
                    onClick={() => setKbId(kb.id)}
                    aria-pressed={kbId === kb.id}
                    className={cn(
                      'w-full rounded-card-sm border px-4 py-3.5 text-left transition-transform duration-150 ease-out-soft hover:-translate-y-px',
                      kbId === kb.id ? 'border-accent-indigo bg-glass-card' : 'border-border-soft',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body-sm font-medium">{kb.name}</p>
                        <p className="text-tiny text-text-tertiary">
                          {kb.document_count} 份文件 · {kb.chunk_count.toLocaleString('en-US')} 個段落
                        </p>
                      </div>
                      {kbId === kb.id ? (
                        <Check size={16} strokeWidth={2.2} aria-hidden className="shrink-0 text-accent-indigo" />
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-4">
            <h2 className="text-section">主題</h2>
            <p className="text-body-sm text-text-secondary">
              挑選要涵蓋的章節。留空則由系統自行決定，通常會過度集中在最長的那份文件。
            </p>
            <div className="flex flex-wrap gap-2">
              {GENERATION_TOPIC_SUGGESTIONS.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  aria-pressed={topics.includes(topic)}
                  className={cn(
                    'rounded-pill border px-3.5 py-1.5 text-body-sm',
                    topics.includes(topic)
                      ? 'border-accent-indigo text-text-primary'
                      : 'border-border-soft text-text-secondary hover:text-text-primary',
                  )}
                >
                  {topic}
                </button>
              ))}
            </div>
            <Field label="新增主題">
              <Input
                placeholder="例如：團保理賠上限"
                onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    const value = event.currentTarget.value.trim();
                    if (value) {
                      toggleTopic(value);
                      event.currentTarget.value = '';
                    }
                  }
                }}
              />
            </Field>
            <p className="text-tiny text-text-tertiary">已選擇 {topics.length} 個主題</p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <h2 className="text-section">題型</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {TYPE_CHOICES.map((type) => (
                <li
                  key={type}
                  className="flex items-center justify-between gap-3 rounded-card-sm border border-border-soft bg-glass-card px-4 py-3"
                >
                  <span className="text-body-sm">{QUESTION_TYPE_LABEL[type]}</span>
                  <Switch
                    checked={types.includes(type)}
                    onCheckedChange={() => toggleType(type)}
                    aria-label={`生成${QUESTION_TYPE_LABEL[type]}題目`}
                  />
                </li>
              ))}
            </ul>
            <p className="text-tiny text-text-tertiary">
              語音與角色扮演題目一律人工撰寫 — 它們需要的評分規準無法由系統推斷。
            </p>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <h2 className="text-section">難度與題數</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="難度">
                <Select
                  value={difficulty}
                  onValueChange={(value: string) => setDifficulty(value as Difficulty)}
                  options={[
                    { value: 'easy', label: DIFFICULTY_LABEL.easy },
                    { value: 'medium', label: DIFFICULTY_LABEL.medium },
                    { value: 'hard', label: DIFFICULTY_LABEL.hard },
                    { value: 'expert', label: DIFFICULTY_LABEL.expert },
                  ]}
                />
              </Field>
              <Field label="要生成幾題" hint="一次生成太多，審核花的時間會遠多於生成。">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCount(Number(event.target.value) || 1)}
                />
              </Field>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-4">
            <h2 className="text-section">生成</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="meta-label">知識庫</dt>
                <dd className="text-body-sm">
                  {MOCK_KNOWLEDGE_BASES.find((kb) => kb.id === kbId)?.name ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="meta-label">主題</dt>
                <dd className="text-body-sm">{topics.length > 0 ? topics.join('、') : '自動決定'}</dd>
              </div>
              <div>
                <dt className="meta-label">題型</dt>
                <dd className="text-body-sm">
                  {types.map((type) => QUESTION_TYPE_LABEL[type]).join('、') || '尚未選擇'}
                </dd>
              </div>
              <div>
                <dt className="meta-label">難度 / 題數</dt>
                <dd className="text-body-sm">
                  {DIFFICULTY_LABEL[difficulty]} · {count}
                </dd>
              </div>
            </dl>

            <Button
              variant="primary"
              size="md"
              disabled={!canEdit || types.length === 0}
              onClick={() => setStep(5)}
            >
              <Sparkles size={16} strokeWidth={1.9} aria-hidden />
              生成 {count} 道題目
            </Button>

            <p className="text-tiny text-text-tertiary">
              生成作業在伺服器端執行，瀏覽器內不存放任何模型憑證。
            </p>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-section">人工審核</h2>
              <span className="gradient-pill inline-flex items-center gap-1.5 px-3 py-1 text-tiny font-medium">
                <Sparkles size={12} strokeWidth={2} aria-hidden />
                已成功生成 {count} 道題目
              </span>
            </div>
            <p className="text-body-sm text-text-secondary">
              顯示的 {GENERATED.length} 則中已核准 {approvedCount} 則。退回的題目會保留供模型評估使用，但不會被指派。
            </p>

            <ul className="space-y-3">
              {GENERATED.map((question) => {
                const decision = decisions[question.id];
                return (
                  <li key={question.id}>
                    <GlassCard className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-1.5">
                            <Pill tone="neutral" size="sm">{QUESTION_TYPE_LABEL[question.type]}</Pill>
                            <DifficultyPill difficulty={question.difficulty} />
                            <ContentStatusPill status={question.status} />
                            {decision ? (
                              <Pill tone={decision === 'approved' ? 'success' : 'danger'} size="sm">
                                {decision === 'approved' ? '已核准' : '已退回'}
                              </Pill>
                            ) : null}
                          </div>
                          <p className="text-body">{question.prompt}</p>
                          {question.correct_answer ? (
                            <p className="mt-2 text-body-sm">
                              <span className="meta-label mr-2">答案</span>
                              <span className="text-text-secondary">{question.correct_answer}</span>
                            </p>
                          ) : null}
                          {question.explanation ? (
                            <p className="mt-1.5 text-body-sm text-text-secondary">{question.explanation}</p>
                          ) : null}
                          {question.citations && question.citations.length > 0 ? (
                            <div className="mt-3">
                              <p className="meta-label mb-1.5">依據來源</p>
                              <CitationList citations={question.citations} />
                            </div>
                          ) : null}
                        </div>

                        {canPublish ? (
                          <div className="flex shrink-0 gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDecisions((prev) => ({ ...prev, [question.id]: 'rejected' }))}
                            >
                              <X size={15} strokeWidth={2} aria-hidden />
                              退回
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setDecisions((prev) => ({ ...prev, [question.id]: 'approved' }))}
                            >
                              <Check size={15} strokeWidth={2} aria-hidden />
                              核准
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </GlassCard>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {step === 6 ? (
          <section className="space-y-4">
            <h2 className="text-section">發布</h2>
            <p className="text-body-sm text-text-secondary">
              已核准的 {approvedCount} 則題目會以第 1 版發布到題庫，並可開始指派。退回與尚未審核的題目不會進入題庫。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={!canPublish || approvedCount === 0}>
                發布 {approvedCount} 道題目
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/questions">回到題庫</Link>
              </Button>
            </div>
          </section>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border-soft pt-5">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((prev) => Math.max(0, prev - 1))}>
            <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
            上一步
          </Button>
          <p className="text-tiny text-text-tertiary">
            第 {step + 1} / {total} 步
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={step === total - 1}
            onClick={() => setStep((prev) => Math.min(total - 1, prev + 1))}
          >
            下一步
            <ArrowRight size={15} strokeWidth={1.8} aria-hidden />
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
