'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Download, MessageSquarePlus, PenLine, ShieldAlert } from 'lucide-react';
import { Button, GlassCard, Pill, Tabs, Textarea } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { EvidenceDisclosure, StateTimeline, TranscriptDocument } from '@/components/transcript';
import { SkillRadar, TrendLine } from '@/components/data-viz';
import { ModePill, RiskPill } from '@/components/status';
import { SKILL_KEYS } from '@ai-coach/shared';
import {
  DEMO_EVALUATION,
  RUBRIC_LIFE_CORE,
  SCORE_TREND,
  findingsForSession,
} from '@/lib/fixtures/evaluations';
import {
  DEMO_STATE_TIMELINE,
  MOCK_COACH_INSIGHTS,
  MOCK_TRANSCRIPT,
  sessionById,
} from '@/lib/fixtures/sessions';
import { personaById } from '@/lib/fixtures/personas';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { userById } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import {
  COMPLIANCE_TYPE_LABEL,
  REVIEWER_STATUS_LABEL,
  RUNTIME_LABEL,
} from '@/features/simulation/lib/labels';
import { formatDate, titleize } from '@/lib/utils';

type ReviewTab = 'report' | 'transcript' | 'timeline' | 'compliance';

/**
 * §58-9 Session Review / Replay + §37–§40 report surfaces.
 *
 * Score → evidence → transcript is one continuous path: every skill row expands
 * to its quotes (§27/§39) and every quote links to the transcript turn. A bare
 * number never appears on this page.
 */
export function SessionReviewPage({ sessionId }: { sessionId: string }) {
  const session = sessionById(sessionId);
  const scenario = session ? scenarioById(session.scenario_id) : undefined;
  const persona = session ? personaById(session.persona_id) : undefined;
  const learner = session ? userById(session.user_id) : undefined;
  const findings = findingsForSession(sessionId);
  const canOverride = useCan('score.override');
  const canComment = useCan('coaching_note.write');

  const [tab, setTab] = useState<ReviewTab>('report');
  const [highlight, setHighlight] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const jumpToTurn = useCallback((turnId: string) => {
    setTab('transcript');
    setHighlight([turnId]);
    // Let the transcript mount before scrolling to the row.
    window.requestAnimationFrame(() => {
      document.getElementById(`turn-${turnId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  if (!session) {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          breadcrumbs={[{ label: 'Simulations', href: '/simulations' }, { label: 'Review' }]}
          title="Session not found"
          description="Reports are retained per your workspace retention policy; this one may have expired."
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/simulations">Back to the library</Link>
        </Button>
      </div>
    );
  }

  const evaluation = DEMO_EVALUATION;
  const radarValues = SKILL_KEYS.map(
    (key) => evaluation.skills.find((skill) => skill.skill === key)?.score ?? 0,
  );

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: 'Simulations', href: '/simulations' },
          { label: scenario?.name ?? session.scenario_id },
          { label: 'Review' },
        ]}
        title="Session review"
        description={`${learner?.display_name ?? session.user_id} · ${persona?.name ?? session.persona_id} · ${session.turn_count} turns`}
        meta={
          <>
            <ModePill mode={session.mode} />
            <Pill tone="neutral" size="sm">Scenario v{session.scenario_version}</Pill>
            <Pill tone="neutral" size="sm">Persona v{session.persona_version}</Pill>
            <Pill tone="neutral" size="sm">{RUNTIME_LABEL[session.runtime] ?? titleize(session.runtime)}</Pill>
            <RiskPill risk={evaluation.compliance_status} />
            <Pill tone="neutral" size="sm">{formatDate(session.started_at)}</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              Export report
            </Button>
            {canOverride ? (
              <Button variant="secondary" size="sm">
                <PenLine size={15} strokeWidth={1.8} aria-hidden />
                Override score
              </Button>
            ) : null}
          </>
        }
      />

      {/* §37 layout — large score card left, highlights right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <GlassCard className="relative overflow-hidden p-6">
          <div className="dot-matrix pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-60" aria-hidden />
          <p className="meta-label">Performance</p>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-display tabular-nums">{evaluation.overall_score}</span>
            <span className="text-body text-text-tertiary">/ 100</span>
            <Pill tone={evaluation.passed ? 'success' : 'danger'} size="sm">
              {evaluation.passed ? 'Passed' : 'Not passed'}
            </Pill>
          </p>
          <p className="mt-1 text-body-sm text-text-secondary">
            Rubric {RUBRIC_LIFE_CORE.name} v{RUBRIC_LIFE_CORE.version} · pass threshold{' '}
            {RUBRIC_LIFE_CORE.pass_threshold} · goal {evaluation.goal_achieved ? 'achieved' : 'not achieved'}
          </p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="meta-label text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">Key strength</dt>
              <dd className="mt-1 text-body-sm text-text-secondary">{evaluation.key_strength}</dd>
            </div>
            <div>
              <dt className="meta-label text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">Main improvement</dt>
              <dd className="mt-1 text-body-sm text-text-secondary">{evaluation.main_improvement}</dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="meta-label">Highlights</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Pill tone="gradient" size="sm">Professional</Pill>
            <Pill tone="success" size="sm">Self-corrected</Pill>
            <Pill tone="info" size="sm">Improved +6.4</Pill>
            {findings.length > 0 ? (
              <Pill tone="warning" size="sm">{findings.length} finding{findings.length === 1 ? '' : 's'}</Pill>
            ) : null}
          </div>

          <h3 className="mt-5 text-body-sm font-semibold">Coach summary</h3>
          <ul className="mt-2 space-y-2.5">
            {MOCK_COACH_INSIGHTS.filter((insight) => insight.kind === 'post_session').map((insight) => (
              <li key={insight.id} className="rounded-card-sm border border-border-soft px-3.5 py-3">
                <p className="text-body-sm font-medium">{insight.title}</p>
                <p className="mt-1 text-body-sm text-text-secondary">{insight.body}</p>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value: string) => setTab(value as ReviewTab)}
        items={[
          { value: 'report', label: 'Scores & evidence' },
          { value: 'transcript', label: 'Transcript', count: MOCK_TRANSCRIPT.length },
          { value: 'timeline', label: 'State timeline' },
          { value: 'compliance', label: 'Compliance', count: findings.length },
        ]}
      />

      {tab === 'report' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <GlassCard className="p-5">
            <h2 className="text-card-title">Ten evaluation dimensions</h2>
            <p className="mt-1 text-body-sm text-text-secondary">
              Expand any row to see the transcript excerpt behind the score.
            </p>
            <div className="mt-4 space-y-2">
              {evaluation.skills.map((skill) => (
                <EvidenceDisclosure
                  key={String(skill.skill)}
                  skill={skill}
                  threshold={RUBRIC_LIFE_CORE.pass_threshold}
                  onJumpToTurn={jumpToTurn}
                />
              ))}
            </div>
          </GlassCard>

          <div className="space-y-4">
            <GlassCard className="p-5">
              <h2 className="text-card-title">Skill profile</h2>
              <SkillRadar
                axes={[...SKILL_KEYS]}
                series={[
                  { id: 'session', label: 'This session', color: 'var(--accent-indigo)', values: radarValues },
                  {
                    id: 'team',
                    label: 'Team average',
                    color: 'var(--accent-cyan)',
                    values: [85, 76, 84, 82, 80, 78, 83, 71, 77, 86],
                  },
                ]}
              />
            </GlassCard>

            <GlassCard className="p-5">
              <h2 className="text-card-title">Score trend</h2>
              <p className="text-tiny text-text-tertiary">Overall score across the learner’s last six months</p>
              <TrendLine
                className="mt-3"
                points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score }))}
                ariaLabel="Overall score trend across the last six months"
                min={55}
                max={95}
              />
            </GlassCard>

            {canComment ? (
              <GlassCard className="p-5">
                <div className="flex items-center gap-2">
                  <MessageSquarePlus size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
                  <h2 className="text-card-title">Coaching note</h2>
                </div>
                <p className="mt-1 text-body-sm text-text-secondary">
                  Visible to the learner and to their manager. Recorded in the audit log.
                </p>
                <Textarea
                  className="mt-3"
                  rows={4}
                  value={note}
                  placeholder="What should they do differently next time?"
                  aria-label="Coaching note"
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNote(event.target.value)}
                />
                <Button variant="primary" size="sm" className="mt-3" disabled={note.trim().length === 0}>
                  Save note
                </Button>
              </GlassCard>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'transcript' ? (
        <TranscriptDocument
          turns={MOCK_TRANSCRIPT}
          personaName={persona?.name ?? 'Customer'}
          traineeName={learner?.display_name ?? 'Trainee'}
          highlightTurnIds={highlight}
        />
      ) : null}

      {tab === 'timeline' ? (
        <GlassCard className="p-5">
          <h2 className="text-card-title">Persona state timeline</h2>
          <p className="mt-1 max-w-2xl text-body-sm text-text-secondary">
            Produced by the scenario agent state machine and the language context — not by facial or
            personality inference. Markers show key responses, missed signals and compliance warnings.
          </p>
          <StateTimeline className="mt-5" points={DEMO_STATE_TIMELINE} onJumpToTurn={jumpToTurn} />
        </GlassCard>
      ) : null}

      {tab === 'compliance' ? (
        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} strokeWidth={1.8} aria-hidden className="text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]" />
            <h2 className="text-card-title">Compliance findings</h2>
          </div>

          {findings.length === 0 ? (
            <p className="mt-3 text-body-sm text-text-secondary">
              No finding was raised in this session.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {findings.map((finding) => (
                <li key={finding.id} className="rounded-card-sm border border-border-soft bg-glass-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="neutral" size="sm">
                      {COMPLIANCE_TYPE_LABEL[finding.type] ?? titleize(finding.type)}
                    </Pill>
                    <RiskPill risk={finding.severity} />
                    <Pill tone="neutral" size="sm">
                      {REVIEWER_STATUS_LABEL[finding.reviewer_status] ?? titleize(finding.reviewer_status)}
                    </Pill>
                    {finding.policy_rule ? (
                      <span className="text-tiny text-text-tertiary">{finding.policy_rule}</span>
                    ) : null}
                  </div>
                  <blockquote className="mt-2.5 text-body text-text-primary">{finding.evidence}</blockquote>
                  <p className="mt-2 text-body-sm text-text-secondary">{finding.explanation}</p>
                  {finding.suggested_correction ? (
                    <p className="mt-2 text-body-sm">
                      <span className="meta-label mr-2 text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">Suggested correction</span>
                      <span className="text-text-secondary">{finding.suggested_correction}</span>
                    </p>
                  ) : null}
                  {finding.transcript_turn_id ? (
                    <button
                      type="button"
                      onClick={() => jumpToTurn(finding.transcript_turn_id!)}
                      className="mt-2 rounded-button text-body-sm text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
                    >
                      Jump to the turn
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      ) : null}
    </div>
  );
}
