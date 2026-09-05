'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Play, Save } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, StepProgress, Switch, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill, ModePill } from '@/components/status';
import { SCENARIO_WIZARD_STEPS, scenarioById } from '@/lib/fixtures/scenarios';
import { MOCK_PERSONAS, personaById } from '@/lib/fixtures/personas';
import { MOCK_KNOWLEDGE_BASES } from '@/lib/fixtures/knowledge';
import { MOCK_RUBRICS, RUBRIC_LIFE_CORE, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { formatDuration } from '@/lib/utils';

/**
 * §17 Scenario Builder — the nine-step wizard, driven by `StepProgress`
 * (horizontal glass stepper). Every field in the §17 field list has a home in
 * one of the steps, and step 8 is a real preview rather than a summary table.
 */
export function ScenarioBuilderPage({ scenarioId }: { scenarioId: string }) {
  const canEdit = useCan('scenario.manage');
  const canPublish = useCan('content.publish');
  const isNew = scenarioId === 'new';

  const source = useMemo(() => scenarioById(scenarioId), [scenarioId]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [industry, setIndustry] = useState(source?.industry ?? '');
  const [trainingType, setTrainingType] = useState(source?.training_type ?? '');
  const [personaId, setPersonaId] = useState(source?.persona_id ?? MOCK_PERSONAS[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState(source?.difficulty ?? 'medium');
  const [mode, setMode] = useState(source?.mode ?? 'training');
  const [openingContext, setOpeningContext] = useState(source?.opening_context ?? '');
  const [selectedKbs, setSelectedKbs] = useState<string[]>(source?.knowledge_base_ids ?? []);
  const [adaptive, setAdaptive] = useState(true);
  const [rubricId, setRubricId] = useState(source?.rubric_id ?? RUBRIC_LIFE_CORE.id);

  const persona = personaById(personaId);
  const total = SCENARIO_WIZARD_STEPS.length;
  const currentStep = SCENARIO_WIZARD_STEPS[step];

  const toggleKb = (kbId: string) =>
    setSelectedKbs((prev) => (prev.includes(kbId) ? prev.filter((id) => id !== kbId) : [...prev, kbId]));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: 'Scenarios', href: '/scenarios' },
          { label: isNew ? 'New scenario' : name || 'Scenario' },
          { label: 'Builder' },
        ]}
        title={isNew ? 'New scenario' : name || 'Scenario builder'}
        description={`Step ${step + 1} of ${total} — ${currentStep?.label ?? ''}`}
        meta={
          <>
            {source ? <ContentStatusPill status={source.status} /> : <ContentStatusPill status="draft" />}
            <DifficultyPill difficulty={difficulty} />
            <ModePill mode={mode} />
            {source ? <Pill tone="neutral" size="sm">v{source.version}</Pill> : null}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={!canEdit}>
              <Save size={15} strokeWidth={1.8} aria-hidden />
              Save draft
            </Button>
            <Button variant="primary" size="sm" disabled={!canPublish || step < total - 1}>
              Publish
            </Button>
          </>
        }
      />

      <GlassCard className="p-5">
        <StepProgress
          orientation="horizontal"
          aria-label="Scenario builder steps"
          steps={SCENARIO_WIZARD_STEPS.map((wizardStep) => ({ id: wizardStep.id, label: wizardStep.label }))}
          current={step}
        />
      </GlassCard>

      <GlassCard className="p-6">
        {step === 0 ? (
          <section className="space-y-4">
            <h2 className="text-section">Basic information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" hint="What trainees will see in the library.">
                <Input value={name} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
              </Field>
              <Field label="Industry">
                <Input value={industry} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIndustry(e.target.value)} />
              </Field>
              <Field label="Training type">
                <Input value={trainingType} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTrainingType(e.target.value)} />
              </Field>
              <Field label="Difficulty" hint="The difficulty engine can still adapt within the session.">
                <Select
                  value={difficulty}
                  onValueChange={(value: string) => setDifficulty(value as typeof difficulty)}
                  options={[
                    { value: 'easy', label: 'Easy' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'hard', label: 'Hard' },
                    { value: 'expert', label: 'Expert' },
                  ]}
                />
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={4} value={description} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)} />
            </Field>
            <Field label="Mode" hint="Assessment mode removes hints, coach cards and knowledge peeking.">
              <Select
                value={mode}
                onValueChange={(value: string) => setMode(value as typeof mode)}
                options={[
                  { value: 'training', label: 'Training — coaching allowed' },
                  { value: 'assessment', label: 'Assessment — no assistance' },
                ]}
              />
            </Field>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-4">
            <h2 className="text-section">Select knowledge bases</h2>
            <p className="text-body-sm text-text-secondary">
              Retrieval is limited to what you select here, intersected with the trainee’s own access
              control list. Nothing outside the workspace is reachable.
            </p>
            <ul className="space-y-2">
              {MOCK_KNOWLEDGE_BASES.map((kb) => (
                <li key={kb.id} className="border border-border-soft bg-glass-card flex items-start justify-between gap-3 rounded-card-sm p-4">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{kb.name}</p>
                    <p className="mt-0.5 text-body-sm text-text-secondary">{kb.description}</p>
                    <p className="mt-1 text-tiny text-text-tertiary">
                      {kb.document_count} documents · {kb.chunk_count.toLocaleString('en-US')} chunks · scope{' '}
                      {kb.acl.scope} · {kb.embedding_model}
                    </p>
                  </div>
                  <Switch
                    checked={selectedKbs.includes(kb.id)}
                    onCheckedChange={() => toggleKb(kb.id)}
                    disabled={!canEdit}
                    aria-label={`Use ${kb.name} for retrieval`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <h2 className="text-section">Select persona</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {MOCK_PERSONAS.filter((option) => option.status !== 'archived').map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setPersonaId(option.id)}
                    aria-pressed={personaId === option.id}
                    className={`w-full rounded-card-sm border px-4 py-3.5 text-left transition-transform duration-150 ease-out-soft hover:-translate-y-px ${
                      personaId === option.id ? 'border-accent-indigo bg-glass-card' : 'border-border-soft'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-body-sm font-medium">{option.name}</p>
                      {personaId === option.id ? (
                        <Check size={15} strokeWidth={2.2} aria-hidden className="shrink-0 text-accent-indigo" />
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      {[option.age ? `${option.age}` : null, option.occupation].filter(Boolean).join(' · ')} · v
                      {option.version}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {persona ? (
              <p className="text-body-sm text-text-secondary">
                Selected: <span className="font-medium">{persona.name}</span> — main objection「
                {persona.hidden?.objections[0] ?? 'not configured'}」
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <h2 className="text-section">Define the scenario</h2>
            <Field label="Opening context" hint="Time, place, mood — what the trainee walks into.">
              <Textarea rows={3} value={openingContext} disabled={!canEdit} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setOpeningContext(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Learning objectives" hint="One per line.">
                <Textarea rows={5} defaultValue={(source?.learning_objectives ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="Required talking points" hint="One per line.">
                <Textarea rows={5} defaultValue={(source?.required_talking_points ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="Required knowledge" hint="One per line.">
                <Textarea rows={4} defaultValue={(source?.required_knowledge ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="Key objections" hint="One per line.">
                <Textarea rows={4} defaultValue={(source?.key_objections ?? []).join('\n')} disabled={!canEdit} />
              </Field>
              <Field label="Success condition">
                <Textarea rows={2} defaultValue={source?.success_condition ?? ''} disabled={!canEdit} />
              </Field>
              <Field label="Failure condition">
                <Textarea rows={2} defaultValue={source?.failure_condition ?? ''} disabled={!canEdit} />
              </Field>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-4">
            <h2 className="text-section">Dynamic behaviour</h2>
            <p className="text-body-sm text-text-secondary">
              §18 Difficulty Engine — how far the scenario may adapt while it is running.
            </p>
            <Switch
              checked={adaptive}
              onCheckedChange={setAdaptive}
              disabled={!canEdit}
              label="Allow in-session difficulty adaptation"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Time limit (seconds)">
                <Input type="number" defaultValue={source?.time_limit_seconds ?? 900} disabled={!canEdit} />
              </Field>
              <Field label="Max turns">
                <Input type="number" defaultValue={source?.max_turns ?? 40} disabled={!canEdit} />
              </Field>
              <Field label="Minimum score">
                <Input type="number" defaultValue={source?.minimum_score ?? 80} disabled={!canEdit} />
              </Field>
            </div>
            <ul className="space-y-2">
              {[
                ['Escalate when the trainee is ahead of pace', 'Persona raises a second-order objection.'],
                ['De-escalate after two consecutive failures', 'Persona offers a clearer signal instead of exiting.'],
                ['Hold difficulty in assessment mode', 'Adaptation is always disabled for assessments.'],
              ].map(([title, body]) => (
                <li key={title} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                  <p className="text-body-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-body-sm text-text-secondary">{body}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="space-y-4">
            <h2 className="text-section">Evaluation rubric</h2>
            <Field label="Rubric" hint="Reports are pinned to the rubric version used at session time.">
              <Select
                value={rubricId}
                onValueChange={setRubricId}
                options={MOCK_RUBRICS.map((rubric) => ({
                  value: rubric.id,
                  label: `${rubric.name} v${rubric.version} — threshold ${rubric.pass_threshold}`,
                }))}
              />
            </Field>

            {(() => {
              const rubric = MOCK_RUBRICS.find((entry) => entry.id === rubricId) ?? RUBRIC_LIFE_CORE;
              return (
                <>
                  <ul className="grid gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2">
                    {Object.entries(rubric.weights).map(([skill, weight]) => (
                      <li key={skill} className="flex items-center justify-between gap-3">
                        <span className="truncate text-text-secondary">
                          {SKILL_LABEL[skill as keyof typeof SKILL_LABEL] ?? skill}
                        </span>
                        <span className="shrink-0 tabular-nums text-text-tertiary">{weight}%</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="meta-label">Required evidence</p>
                      <ul className="mt-2 space-y-1 text-body-sm text-text-secondary">
                        {rubric.required_evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="meta-label text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">Forbidden behaviours</p>
                      <ul className="mt-2 space-y-1 text-body-sm text-text-secondary">
                        {rubric.forbidden_behaviors.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        ) : null}

        {step === 6 ? (
          <section className="space-y-4">
            <h2 className="text-section">Compliance & safety</h2>
            <Field label="Restricted topics" hint="One per line. Mentioning these raises a finding.">
              <Textarea rows={4} defaultValue={(source?.restricted_topics ?? []).join('\n')} disabled={!canEdit} />
            </Field>
            <ul className="space-y-2">
              {[
                ['Compliance policy', 'Insurance TW 2026 — inherited from workspace settings.'],
                ['PII handling', 'Identifiers are masked at ingest and never stored in the transcript.'],
                ['Injection detection', 'Enabled — attempts are recorded as security findings.'],
                ['Critical finding behaviour', 'Assessment sessions fail immediately on a critical finding.'],
              ].map(([title, body]) => (
                <li key={title} className="border border-border-soft bg-glass-card flex items-start justify-between gap-3 rounded-card-sm p-4">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{title}</p>
                    <p className="mt-0.5 text-body-sm text-text-secondary">{body}</p>
                  </div>
                  <Pill tone="success" size="sm">Enforced</Pill>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {step === 7 ? (
          <section className="space-y-4">
            <h2 className="text-section">Preview & test</h2>
            <p className="text-body-sm text-text-secondary">
              Run the scenario yourself before it is assigned. Test runs are marked as such and never
              counted in a learner’s report.
            </p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="meta-label">Persona</dt>
                <dd className="text-body-sm">{persona?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="meta-label">Knowledge bases</dt>
                <dd className="text-body-sm">{selectedKbs.length} selected</dd>
              </div>
              <div>
                <dt className="meta-label">Mode</dt>
                <dd className="text-body-sm">{mode === 'assessment' ? 'Assessment' : 'Training'}</dd>
              </div>
              <div>
                <dt className="meta-label">Time limit</dt>
                <dd className="text-body-sm">
                  {formatDuration(source?.time_limit_seconds ?? 900)}
                </dd>
              </div>
            </dl>
            <Button variant="primary" size="sm" asChild={Boolean(source)} disabled={!source}>
              {source ? (
                <Link href={`/simulations/${source.id}/setup`}>
                  <Play size={15} strokeWidth={2} aria-hidden />
                  Run a test session
                </Link>
              ) : (
                <>
                  <Play size={15} strokeWidth={2} aria-hidden />
                  Save the draft first
                </>
              )}
            </Button>
          </section>
        ) : null}

        {step === 8 ? (
          <section className="space-y-4">
            <h2 className="text-section">Publish</h2>
            <p className="text-body-sm text-text-secondary">
              Publishing creates a new immutable version. Sessions already running keep the version they
              started with, so existing reports stay reproducible.
            </p>
            <ul className="space-y-2">
              {[
                ['Name and description', name.trim().length > 0],
                ['Persona selected', Boolean(persona)],
                ['At least one knowledge base', selectedKbs.length > 0],
                ['Rubric assigned', Boolean(rubricId)],
                ['Opening context written', openingContext.trim().length > 0],
              ].map(([label, done]) => (
                <li key={String(label)} className="flex items-center gap-2.5 text-body-sm">
                  <span
                    aria-hidden
                    className={
                      done
                        ? 'text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]'
                        : 'text-text-tertiary'
                    }
                  >
                    <Check size={15} strokeWidth={2.2} />
                  </span>
                  <span className={done ? '' : 'text-text-tertiary'}>{String(label)}</span>
                  {!done ? <Pill tone="warning" size="sm">Incomplete</Pill> : null}
                </li>
              ))}
            </ul>
            {!canPublish ? (
              <p className="text-body-sm text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">
                Your role can save drafts but not publish. Submit for review instead.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* Wizard navigation */}
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
