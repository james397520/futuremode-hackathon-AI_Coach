'use client';

import Link from 'next/link';
import { SKILL_KEYS } from '@ai-coach/shared-types';
import { ArrowUpRight, Flame, Target, TrendingUp } from 'lucide-react';
import { Button, GlassCard, Pill, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar, SkillRadar, TrendLine } from '@/components/data-viz';
import { RiskPill } from '@/components/status';
import {
  DEMO_RECOMMENDATION,
  DEMO_SKILL_PROFILE,
  SCORE_TREND,
  SKILL_LABEL,
} from '@/lib/fixtures/evaluations';
import { MOCK_SESSIONS } from '@/lib/fixtures/sessions';
import { SCENARIO_MASTERY } from '@/lib/fixtures/reports';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { userById } from '@/lib/fixtures/identity';
import { useAuth } from '@/lib/auth-context';
import { formatRelative, titleize } from '@/lib/utils';

/**
 * §34 Part I 個人成長頁 — overall score, monthly improvement, weakest and
 * strongest skill, sessions, compliance trend, knowledge mastery and days to
 * readiness, visualised as a radar, a trend and a mastery list (§38 restraint).
 */
export function PerformancePage({ userId }: { userId?: string }) {
  const { user } = useAuth();
  const target = userId ? userById(userId) : user;
  const profile = DEMO_SKILL_PROFILE;
  const isOwn = !userId || userId === user?.id;

  const sessions = MOCK_SESSIONS.filter((session) => !userId || session.user_id === userId);
  const radarValues = SKILL_KEYS.map((key) => profile.skills[key]);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={
          isOwn
            ? undefined
            : [{ label: 'Performance Review', href: '/performance' }, { label: target?.display_name ?? userId ?? '' }]
        }
        title={isOwn ? 'My progress' : `${target?.display_name ?? 'Learner'} — progress`}
        description="Every number on this page opens the transcript evidence behind it."
        meta={
          <>
            <Pill tone="neutral" size="sm">{profile.completed_sessions} sessions</Pill>
            <Pill tone="success" size="sm">+{profile.monthly_improvement} this month</Pill>
            <RiskPill risk="low" />
          </>
        }
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/reports/skill">
              Skill report
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Overall skill score" value={String(profile.overall_score)} delta={`+${profile.monthly_improvement}`} hint="weighted across ten dimensions" />
        <StatTile label="Strongest" value={SKILL_LABEL[profile.strongest_skill]} hint={`${profile.skills[profile.strongest_skill]} / 100`} />
        <StatTile label="Weakest" value={SKILL_LABEL[profile.weakest_skill]} hint={`${profile.skills[profile.weakest_skill]} / 100`} />
        <StatTile label="Days to readiness" value={String(profile.days_to_readiness ?? '—')} hint="at the current pace" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">Skill profile</h2>
          <p className="text-tiny text-text-tertiary">Compared with the team average</p>
          <SkillRadar
            axes={[...SKILL_KEYS]}
            series={[
              { id: 'me', label: isOwn ? 'You' : target?.display_name ?? 'Learner', color: 'var(--accent-indigo)', values: radarValues },
              { id: 'team', label: 'Team average', color: 'var(--accent-cyan)', values: [85, 76, 84, 82, 80, 78, 83, 71, 77, 86] },
            ]}
          />
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">Score trend</h2>
            </div>
            <TrendLine
              className="mt-3"
              points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score }))}
              ariaLabel="Overall score by month"
              min={55}
              max={95}
            />
            <p className="mt-2 text-tiny text-text-tertiary">
              Practice frequency: {SCORE_TREND.map((point) => `${point.label} ${point.sessions}`).join(' · ')}
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="text-card-title">Compliance trend</h2>
            <p className="text-tiny text-text-tertiary">
              Compliance is the gating dimension — a critical finding fails a session regardless of the
              other scores.
            </p>
            <TrendLine
              className="mt-3"
              points={profile.compliance_trend.map((value, index) => ({
                label: SCORE_TREND[index]?.label ?? `M${index + 1}`,
                value,
              }))}
              ariaLabel="Compliance score by month"
              min={40}
              max={100}
            />
          </GlassCard>
        </div>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">All ten dimensions</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Open any session report to see the transcript excerpts behind these scores.
        </p>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {SKILL_KEYS.map((key) => (
            <ScoreBar key={key} label={SKILL_LABEL[key]} score={profile.skills[key]} threshold={80} />
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">Scenario mastery</h2>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {SCENARIO_MASTERY.map((entry) => (
              <li key={entry.scenario_id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/simulations/${entry.scenario_id}/setup`}
                    className="text-body-sm font-medium hover:text-accent-indigo"
                  >
                    {entry.scenario_name}
                  </Link>
                  <p className="text-tiny text-text-tertiary">
                    {titleize(entry.difficulty)} · {entry.attempts} attempts
                  </p>
                </div>
                <div className="w-40">
                  <ScoreBar compact label={`${Math.round(entry.pass_rate * 100)}% pass`} score={entry.average_score} />
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard tone="strong" className="p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">What to do next</h2>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">
              Derived from your weakest dimensions: {DEMO_RECOMMENDATION.weak_skills.map((skill) => SKILL_LABEL[skill]).join(', ')}.
            </p>
            <ul className="mt-3 space-y-2 text-body-sm">
              {DEMO_RECOMMENDATION.retry_scenario_id ? (
                <li>
                  <Link
                    href={`/simulations/${DEMO_RECOMMENDATION.retry_scenario_id}/setup`}
                    className="font-medium hover:text-accent-indigo"
                  >
                    Retry: {scenarioById(DEMO_RECOMMENDATION.retry_scenario_id)?.name}
                  </Link>
                </li>
              ) : null}
              {DEMO_RECOMMENDATION.next_scenario_id ? (
                <li>
                  <Link
                    href={`/simulations/${DEMO_RECOMMENDATION.next_scenario_id}/setup`}
                    className="font-medium hover:text-accent-indigo"
                  >
                    Next: {scenarioById(DEMO_RECOMMENDATION.next_scenario_id)?.name}
                  </Link>
                </li>
              ) : null}
              {DEMO_RECOMMENDATION.knowledge_material.map((material) => (
                <li key={material.document_id} className="text-text-secondary">
                  Read: {material.reason}
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Flame size={16} strokeWidth={1.8} aria-hidden className="text-state-warning" />
              <h2 className="text-card-title">Recent sessions</h2>
            </div>
            <ul className="mt-3 divide-y divide-border-soft/70">
              {sessions.slice(0, 5).map((session) => (
                <li key={session.session_id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/simulations/${session.session_id}/review`}
                      className="truncate text-body-sm hover:text-accent-indigo"
                    >
                      {scenarioById(session.scenario_id)?.name ?? session.scenario_id}
                    </Link>
                    <p className="text-tiny text-text-tertiary">
                      {formatRelative(session.ended_at ?? session.started_at)} · {session.turn_count} turns
                    </p>
                  </div>
                  <Pill
                    tone={session.status === 'completed' ? 'success' : session.status === 'error' ? 'danger' : 'neutral'}
                    size="sm"
                  >
                    {titleize(session.status)}
                  </Pill>
                </li>
              ))}
              {sessions.length === 0 ? (
                <li className="py-4 text-body-sm text-text-tertiary">No session yet.</li>
              ) : null}
            </ul>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
