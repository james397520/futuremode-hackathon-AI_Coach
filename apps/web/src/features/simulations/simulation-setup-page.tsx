'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, BookOpen, Mic, Play, ShieldCheck, Target } from 'lucide-react';
import { Button, GlassCard, Pill, Switch } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DifficultyPill, ModePill } from '@/components/status';
import { RuntimeBadge, useComputeCapability } from '@/components/runtime';
import { knowledgeBaseById } from '@/lib/fixtures/knowledge';
import { personaById } from '@/lib/fixtures/personas';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { RUBRIC_LIFE_CORE, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { DEMO_SESSION_ID } from '@/lib/fixtures/sessions';
import { useCan } from '@/lib/auth-context';
import { formatDuration } from '@/lib/utils';

/**
 * §58-5 Simulation Setup — the pre-flight page.
 *
 * Everything the session will be pinned to is confirmed here (§54 version
 * pinning): scenario version, persona version, rubric, knowledge bases, mode,
 * voice and live scoring. Assessment mode disables hints and coach cards (§8.4),
 * which is stated on this page rather than discovered mid-session.
 */
export function SimulationSetupPage({ scenarioId }: { scenarioId: string }) {
  const scenario = scenarioById(scenarioId);
  const persona = scenario ? personaById(scenario.persona_id) : undefined;
  const canSeeHidden = useCan('persona.manage');
  const { label: runtimeLabel } = useComputeCapability();

  const [voice, setVoice] = useState(true);
  const [liveScore, setLiveScore] = useState(true);
  const [captions, setCaptions] = useState(true);

  if (!scenario) {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          breadcrumbs={[{ label: 'Simulations', href: '/simulations' }, { label: 'Setup' }]}
          title="Scenario not found"
          description="This scenario may have been archived, or the link is from an older version."
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/simulations">Back to the library</Link>
        </Button>
      </div>
    );
  }

  const isAssessment = scenario.mode === 'assessment';

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Simulations', href: '/simulations' }, { label: scenario.name }, { label: 'Setup' }]}
        title={scenario.name}
        description={scenario.description}
        meta={
          <>
            <DifficultyPill difficulty={scenario.difficulty} />
            <ModePill mode={scenario.mode} />
            <Pill tone="neutral" size="sm">Scenario v{scenario.version}</Pill>
            {persona ? <Pill tone="neutral" size="sm">Persona v{persona.version}</Pill> : null}
            <RuntimeBadge />
          </>
        }
        actions={
          <Button variant="primary" size="md" asChild>
            <Link href={voice ? `/simulations/${DEMO_SESSION_ID}/voice` : `/simulations/${DEMO_SESSION_ID}/live`}>
              {voice ? <Mic size={16} strokeWidth={1.9} aria-hidden /> : <Play size={16} strokeWidth={2} aria-hidden />}
              {voice ? 'Start voice session' : 'Start session'}
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {/* Opening context */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">Opening context</h2>
            <p className="mt-2 text-body text-text-secondary">{scenario.opening_context}</p>
          </GlassCard>

          {/* Objectives + talking points */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">What you are being assessed on</h2>
            </div>

            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <section>
                <p className="meta-label">Learning objectives</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.learning_objectives.map((objective) => (
                    <li key={objective} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-accent-indigo" />
                      {objective}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label">Required talking points</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.required_talking_points.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-accent-cyan" />
                      {point}
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label">Objections to expect</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.key_objections.map((objection) => (
                    <li key={objection}>「{objection}」</li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="meta-label text-state-warning">Restricted topics</p>
                <ul className="mt-2 space-y-1.5 text-body-sm text-text-secondary">
                  {scenario.restricted_topics.length === 0 ? (
                    <li className="text-text-tertiary">None configured for this scenario.</li>
                  ) : null}
                  {scenario.restricted_topics.map((topic) => (
                    <li key={topic} className="flex gap-2">
                      <AlertTriangle size={13} strokeWidth={1.9} aria-hidden className="mt-1 shrink-0 text-state-warning" />
                      {topic}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <dl className="mt-5 grid gap-3 border-t border-border-soft pt-4 text-body-sm sm:grid-cols-2">
              <div>
                <dt className="meta-label">Success condition</dt>
                <dd className="mt-1 text-text-secondary">{scenario.success_condition}</dd>
              </div>
              <div>
                <dt className="meta-label">Failure condition</dt>
                <dd className="mt-1 text-text-secondary">{scenario.failure_condition}</dd>
              </div>
            </dl>
          </GlassCard>

          {/* Rubric */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">Rubric — {RUBRIC_LIFE_CORE.name} v{RUBRIC_LIFE_CORE.version}</h2>
            <p className="mt-1 text-body-sm text-text-secondary">
              Pass threshold {RUBRIC_LIFE_CORE.pass_threshold}. Every score you receive will be backed by
              transcript evidence.
            </p>
            <ul className="mt-4 grid gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2">
              {Object.entries(RUBRIC_LIFE_CORE.weights).map(([skill, weight]) => (
                <li key={skill} className="flex items-center justify-between gap-3">
                  <span className="truncate text-text-secondary">
                    {SKILL_LABEL[skill as keyof typeof SKILL_LABEL] ?? skill}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-tertiary">{weight}%</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        </div>

        <div className="space-y-4">
          {/* Persona card */}
          {persona ? (
            <GlassCard tone="strong" className="p-5">
              <p className="meta-label">You will be speaking with</p>
              <h2 className="mt-2 text-section">{persona.name}</h2>
              <p className="text-body-sm text-text-secondary">
                {[persona.age ? `${persona.age}` : null, persona.occupation, persona.industry]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-3 text-body-sm text-text-secondary">{persona.background}</p>

              <div className="mt-4 space-y-2">
                {(
                  [
                    ['Price sensitivity', persona.traits.price_sensitivity],
                    ['Resistance', persona.traits.resistance],
                    ['Trust', persona.traits.trust],
                    ['Patience', persona.traits.patience],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="flex justify-between text-tiny text-text-tertiary">
                      <span>{label}</span>
                      <span className="tabular-nums">{value}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-border-soft">
                      <div
                        className="h-full rounded-pill"
                        style={{
                          width: `${value}%`,
                          background: 'linear-gradient(90deg, var(--accent-indigo), var(--accent-cyan))',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {canSeeHidden && persona.hidden ? (
                <details className="mt-4 rounded-card-sm border border-border-soft px-3.5 py-3">
                  <summary className="cursor-pointer text-body-sm font-medium">
                    Hidden state (coach & admin only)
                  </summary>
                  <dl className="mt-3 space-y-2 text-body-sm">
                    <div>
                      <dt className="meta-label">Hidden need</dt>
                      <dd className="text-text-secondary">{persona.hidden.hidden_need}</dd>
                    </div>
                    <div>
                      <dt className="meta-label">Main concern</dt>
                      <dd className="text-text-secondary">{persona.hidden.main_concern}</dd>
                    </div>
                    <div>
                      <dt className="meta-label">Exit condition</dt>
                      <dd className="text-text-secondary">{persona.hidden.exit_condition}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-tiny text-text-tertiary">
                    Trainees never receive this payload — the API strips it for unauthorised roles.
                  </p>
                </details>
              ) : null}
            </GlassCard>
          ) : null}

          {/* Session options */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">Session options</h2>

            <div className="mt-4 space-y-4">
              <Switch
                checked={voice}
                onCheckedChange={setVoice}
                label="Voice session"
                aria-describedby="voice-hint"
              />
              <p id="voice-hint" className="-mt-2 text-tiny text-text-tertiary">
                Push-to-talk with barge-in. Falls back to text if the microphone is unavailable.
              </p>

              <Switch
                checked={captions}
                onCheckedChange={setCaptions}
                label="Live captions"
              />

              <Switch
                checked={liveScore && !isAssessment}
                onCheckedChange={setLiveScore}
                disabled={isAssessment}
                label="Live scoring panel"
              />
              {isAssessment ? (
                <p className="-mt-2 text-tiny text-state-warning">
                  Assessment mode: live scoring, coach hints and knowledge peeking are disabled.
                </p>
              ) : null}
            </div>

            <dl className="mt-5 space-y-2 border-t border-border-soft pt-4 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Time limit</dt>
                <dd>{scenario.time_limit_seconds ? formatDuration(scenario.time_limit_seconds) : 'None'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Max turns</dt>
                <dd className="tabular-nums">{scenario.max_turns ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Minimum score</dt>
                <dd className="tabular-nums">{scenario.minimum_score ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Inference</dt>
                <dd>{runtimeLabel}</dd>
              </div>
            </dl>
          </GlassCard>

          {/* Knowledge grounding */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <BookOpen size={16} strokeWidth={1.8} aria-hidden className="text-accent-blue" />
              <h2 className="text-card-title">Knowledge grounding</h2>
            </div>
            <ul className="mt-3 space-y-2">
              {scenario.knowledge_base_ids.map((kbId) => {
                const kb = knowledgeBaseById(kbId);
                return (
                  <li key={kbId} className="text-body-sm">
                    <Link href={`/knowledge/${kbId}`} className="font-medium hover:text-accent-indigo">
                      {kb?.name ?? kbId}
                    </Link>
                    <p className="text-tiny text-text-tertiary">
                      {kb ? `${kb.document_count} documents · ${kb.chunk_count.toLocaleString('en-US')} chunks` : 'Not available in this workspace'}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex items-start gap-2 text-tiny text-text-tertiary">
              <ShieldCheck size={13} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0" />
              Retrieval is scoped to this workspace and your access control list. Cross-tenant lookups are
              impossible by construction.
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
