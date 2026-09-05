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
        breadcrumbs={[{ label: 'Question Bank', href: '/questions' }, { label: 'Generate with AI' }]}
        title="AI question generator"
        description={`Step ${step + 1} of ${total} — ${currentStep?.label ?? ''}`}
        meta={<Pill tone="warning" size="sm">Nothing publishes without human review</Pill>}
      />

      <GlassCard className="p-5">
        <StepProgress
          orientation="horizontal"
          aria-label="Question generation steps"
          steps={QUESTION_GENERATION_STEPS.map((entry) => ({ id: entry.id, label: entry.label }))}
          current={step}
        />
      </GlassCard>

      <GlassCard className="p-6">
        {step === 0 ? (
          <section className="space-y-4">
            <h2 className="text-section">Knowledge</h2>
            <p className="text-body-sm text-text-secondary">
              Questions are grounded in the chunks of one knowledge base, and each generated item keeps its
              citations so a reviewer can verify the claim.
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
                          {kb.document_count} documents · {kb.chunk_count.toLocaleString('en-US')} chunks
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
            <h2 className="text-section">Topics</h2>
            <p className="text-body-sm text-text-secondary">
              Pick the sections to cover. Leaving this empty lets the generator choose, which usually
              over-samples the longest document.
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
            <Field label="Add a topic">
              <Input
                placeholder="e.g. 團保理賠上限"
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
            <p className="text-tiny text-text-tertiary">{topics.length} topic(s) selected</p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <h2 className="text-section">Question types</h2>
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
                    aria-label={`Generate ${QUESTION_TYPE_LABEL[type]} questions`}
                  />
                </li>
              ))}
            </ul>
            <p className="text-tiny text-text-tertiary">
              Voice and role-play items are authored by hand — they need a rubric a generator cannot infer.
            </p>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <h2 className="text-section">Difficulty & volume</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Difficulty">
                <Select
                  value={difficulty}
                  onValueChange={(value: string) => setDifficulty(value as Difficulty)}
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'hard', label: 'Hard' },
                    { value: 'expert', label: 'Expert' },
                  ]}
                />
              </Field>
              <Field label="How many" hint="Larger batches take longer to review than to generate.">
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
            <h2 className="text-section">Generate</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="meta-label">Knowledge base</dt>
                <dd className="text-body-sm">
                  {MOCK_KNOWLEDGE_BASES.find((kb) => kb.id === kbId)?.name ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="meta-label">Topics</dt>
                <dd className="text-body-sm">{topics.length > 0 ? topics.join('、') : 'Auto'}</dd>
              </div>
              <div>
                <dt className="meta-label">Types</dt>
                <dd className="text-body-sm">
                  {types.map((type) => QUESTION_TYPE_LABEL[type]).join(', ') || 'None selected'}
                </dd>
              </div>
              <div>
                <dt className="meta-label">Difficulty / count</dt>
                <dd className="text-body-sm">
                  {difficulty} · {count}
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
              Generate {count} questions
            </Button>

            <p className="text-tiny text-text-tertiary">
              Generation runs on the server. No model credential is present in this browser.
            </p>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-section">Human review</h2>
              <span className="gradient-pill inline-flex items-center gap-1.5 px-3 py-1 text-tiny font-medium">
                <Sparkles size={12} strokeWidth={2} aria-hidden />
                {count} questions successfully generated
              </span>
            </div>
            <p className="text-body-sm text-text-secondary">
              {approvedCount} of {GENERATED.length} shown items approved. Rejected items are kept for model
              evaluation but never assigned.
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
                                {decision === 'approved' ? 'Approved' : 'Rejected'}
                              </Pill>
                            ) : null}
                          </div>
                          <p className="text-body">{question.prompt}</p>
                          {question.correct_answer ? (
                            <p className="mt-2 text-body-sm">
                              <span className="meta-label mr-2">Answer</span>
                              <span className="text-text-secondary">{question.correct_answer}</span>
                            </p>
                          ) : null}
                          {question.explanation ? (
                            <p className="mt-1.5 text-body-sm text-text-secondary">{question.explanation}</p>
                          ) : null}
                          {question.citations && question.citations.length > 0 ? (
                            <div className="mt-3">
                              <p className="meta-label mb-1.5">Grounded in</p>
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
                              Reject
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => setDecisions((prev) => ({ ...prev, [question.id]: 'approved' }))}
                            >
                              <Check size={15} strokeWidth={2} aria-hidden />
                              Approve
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
            <h2 className="text-section">Publish</h2>
            <p className="text-body-sm text-text-secondary">
              {approvedCount} approved item(s) will be published into the question bank at version 1 and become
              assignable. Rejected and unreviewed items stay out of circulation.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" disabled={!canPublish || approvedCount === 0}>
                Publish {approvedCount} question(s)
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/questions">Back to the bank</Link>
              </Button>
            </div>
          </section>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border-soft pt-5">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep((prev) => Math.max(0, prev - 1))}>
            <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
            Back
          </Button>
          <p className="text-tiny text-text-tertiary">
            Step {step + 1} of {total}
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={step === total - 1}
            onClick={() => setStep((prev) => Math.min(total - 1, prev + 1))}
          >
            Next
            <ArrowRight size={15} strokeWidth={1.8} aria-hidden />
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
