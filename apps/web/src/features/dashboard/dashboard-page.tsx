'use client';

import Link from 'next/link';
import { ArrowUpRight, CalendarClock, Play, Sparkles, Target } from 'lucide-react';
import { Button, GlassCard, Pill, ProgressBar, StatTile } from '@/components/ui';
import { MiniBars, Sparkline, TrendLine } from '@/components/data-viz';
import { DifficultyPill, ModePill, RiskPill } from '@/components/status';
import { PageHeader } from '@/components/app-shell';
import { useAuth } from '@/lib/auth-context';
import { ACTIVITY_BY_DAY, DASHBOARD_KPIS } from '@/lib/fixtures/reports';
import { ASSIGNMENT_STATUS_LABEL, MOCK_ASSIGNMENT_PROGRESS } from '@/lib/fixtures/training';
import { MOCK_SESSIONS } from '@/lib/fixtures/sessions';
import { DEMO_SKILL_PROFILE, SCORE_TREND, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { userById } from '@/lib/fixtures/identity';
import { formatRelative, titleize } from '@/lib/utils';

/**
 * §13 Dashboard.
 *
 * Layout follows §13.1: a hero + two-column grid of large glass cards rather than
 * eight little KPI squares (§13.3). Charts stay restrained — one activity bar
 * group and one score trend line, no pies and no gauges (§38 / §99).
 */
export function DashboardPage() {
  const { user, workspace } = useAuth();
  const firstName = user?.display_name.split(' ')[0] ?? 'there';

  const todaysFocus = MOCK_ASSIGNMENT_PROGRESS.find((item) => item.status !== 'completed');
  const recentSessions = MOCK_SESSIONS.slice(0, 4);

  return (
    <div className="space-y-6 pb-4">
      <PageHeader
        title={`Good evening, ${firstName}`}
        description={`Training overview for ${workspace?.name ?? 'this workspace'} — assignments, readiness and today’s objective.`}
        meta={
          <>
            <Pill tone="neutral" size="sm">Week 12 · 2026</Pill>
            <Pill tone="success" size="sm">2 assignments due this week</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports/team">
                Team report
                <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
              </Link>
            </Button>
            <Button variant="primary" size="sm" asChild>
              <Link href="/simulations">
                <Play size={15} strokeWidth={2} aria-hidden />
                Start a simulation
              </Link>
            </Button>
          </>
        }
      />

      {/* Hero — the only place with dot matrix on this page (§2). */}
      <GlassCard className="relative overflow-hidden p-0">
        <div className="dot-matrix pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-80" aria-hidden />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div>
            <p className="meta-label">Training overview</p>
            <h2 className="mt-2 text-display">
              {Math.round(MOCK_ASSIGNMENT_PROGRESS.reduce((sum, item) => sum + item.completion_rate, 0) / MOCK_ASSIGNMENT_PROGRESS.length * 100)}%
            </h2>
            <p className="mt-1 text-body text-text-secondary">
              average completion across {MOCK_ASSIGNMENT_PROGRESS.length} active assignments
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {DASHBOARD_KPIS.slice(0, 3).map((kpi) => (
                <div key={kpi.id} className="border-l border-border-soft pl-4 first:border-l-0 first:pl-0">
                  <p className="meta-label">{kpi.label}</p>
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className="text-section tabular-nums">{kpi.value}</span>
                    {kpi.delta ? <span className="text-tiny text-state-success">{kpi.delta}</span> : null}
                  </p>
                  <p className="text-tiny text-text-tertiary">{kpi.hint}</p>
                  {kpi.trend ? <Sparkline values={kpi.trend} /> : null}
                </div>
              ))}
            </div>
          </div>

          {/* §13.1 "Today / Objective" floating card. */}
          <GlassCard tone="strong" className="p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <p className="meta-label">Today’s objective</p>
            </div>
            {todaysFocus ? (
              <>
                <h3 className="mt-2.5 text-card-title">{todaysFocus.scenario_name}</h3>
                <p className="mt-1 text-body-sm text-text-secondary">
                  Persona: {todaysFocus.persona_name}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <DifficultyPill difficulty={todaysFocus.difficulty} />
                  <ModePill mode={todaysFocus.mode} />
                  {todaysFocus.mandatory ? <Pill tone="warning" size="sm">Mandatory</Pill> : null}
                </div>
                <dl className="mt-4 space-y-2 text-body-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Minimum score</dt>
                    <dd className="tabular-nums">{todaysFocus.minimum_score}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Attempts</dt>
                    <dd className="tabular-nums">
                      {todaysFocus.attempts_used} / {todaysFocus.max_attempts ?? '∞'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">Status</dt>
                    <dd>{ASSIGNMENT_STATUS_LABEL[todaysFocus.status]}</dd>
                  </div>
                </dl>
                <Button variant="primary" size="sm" className="mt-4 w-full" asChild>
                  <Link href={`/simulations/${todaysFocus.scenario_id}/setup`}>Open setup</Link>
                </Button>
              </>
            ) : (
              <p className="mt-3 text-body-sm text-text-secondary">
                Nothing outstanding. Pick any scenario from the library to keep practising.
              </p>
            )}
          </GlassCard>
        </div>
      </GlassCard>

      {/* §13.3 KPI row — big tiles, not a grid of small squares. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DASHBOARD_KPIS.map((kpi) => (
          <StatTile
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            hint={kpi.hint}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Assigned training */}
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">Assigned training</h2>
              <p className="text-tiny text-text-tertiary">
                Completion requires attempts ≥ 2, score ≥ minimum, and no critical compliance risk.
              </p>
            </div>
            <Link href="/training" className="shrink-0 text-body-sm text-accent-indigo hover:underline">
              All assignments
            </Link>
          </div>

          <ul className="space-y-2.5">
            {MOCK_ASSIGNMENT_PROGRESS.map((item) => (
              <li key={item.assignment_id} className="glass-strong rounded-card-sm p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/simulations/${item.scenario_id}/setup`}
                      className="text-body font-medium hover:text-accent-indigo"
                    >
                      {item.scenario_name}
                    </Link>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      {item.persona_name}
                      {item.deadline ? ` · due ${formatRelative(item.deadline)}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <DifficultyPill difficulty={item.difficulty} />
                    <Pill
                      tone={
                        item.status === 'completed'
                          ? 'success'
                          : item.status === 'overdue'
                            ? 'danger'
                            : item.status === 'awaiting_retry'
                              ? 'warning'
                              : 'neutral'
                      }
                      size="sm"
                    >
                      {ASSIGNMENT_STATUS_LABEL[item.status]}
                    </Pill>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-tiny text-text-tertiary">
                  <span className="tabular-nums">
                    Best {item.best_score ?? '—'} / min {item.minimum_score}
                  </span>
                  <span className="tabular-nums">
                    Attempt {item.attempts_used}/{item.max_attempts ?? '∞'}
                  </span>
                  {item.blocking_skill ? (
                    <span>Blocking skill: {SKILL_LABEL[item.blocking_skill]}</span>
                  ) : null}
                  {item.critical_findings > 0 ? (
                    <span className="text-state-danger">
                      {item.critical_findings} compliance finding{item.critical_findings === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </div>

                <ProgressBar
                  value={Math.round(item.completion_rate * 100)}
                  label={`Team completion ${Math.round(item.completion_rate * 100)}% of ${item.assignee_count} assignees`}
                  className="mt-3"
                />
              </li>
            ))}
          </ul>
        </GlassCard>

        <div className="space-y-4">
          {/* Readiness (§34 Part I) */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Sparkles size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">Readiness</h2>
            </div>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-display tabular-nums">{DEMO_SKILL_PROFILE.overall_score}</span>
              <span className="text-body-sm text-text-tertiary">/ 100 overall</span>
            </p>
            <p className="text-body-sm text-state-success">
              +{DEMO_SKILL_PROFILE.monthly_improvement} this month
            </p>

            <dl className="mt-4 space-y-2.5 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Strongest</dt>
                <dd>{SKILL_LABEL[DEMO_SKILL_PROFILE.strongest_skill]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Weakest</dt>
                <dd className="text-state-warning">{SKILL_LABEL[DEMO_SKILL_PROFILE.weakest_skill]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">Sessions completed</dt>
                <dd className="tabular-nums">{DEMO_SKILL_PROFILE.completed_sessions}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-text-tertiary">
                  <CalendarClock size={13} strokeWidth={1.8} aria-hidden />
                  Days to readiness
                </dt>
                <dd className="tabular-nums">{DEMO_SKILL_PROFILE.days_to_readiness ?? '—'}</dd>
              </div>
            </dl>

            <TrendLine
              className="mt-4"
              points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score }))}
              ariaLabel="Overall score trend over the last six months"
              min={55}
              max={95}
            />

            <Link
              href="/performance"
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-accent-indigo hover:underline"
            >
              Individual progress
              <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
            </Link>
          </GlassCard>

          {/* Activity */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">Activity</h2>
            <p className="text-tiny text-text-tertiary">Sessions per day · voice sessions highlighted</p>
            <MiniBars
              className="mt-4"
              data={ACTIVITY_BY_DAY.map((day) => ({
                label: day.label,
                value: day.sessions,
                secondary: day.voice,
              }))}
              ariaLabel="Sessions per day for the current week, with voice sessions highlighted"
            />
          </GlassCard>
        </div>
      </div>

      {/* Recent sessions */}
      <GlassCard className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-card-title">Recent sessions</h2>
          <Link href="/simulations" className="text-body-sm text-accent-indigo hover:underline">
            Simulation library
          </Link>
        </div>

        <ul className="divide-y divide-border-soft/70">
          {recentSessions.map((session) => {
            const scenario = scenarioById(session.scenario_id);
            const learner = userById(session.user_id);
            return (
              <li key={session.session_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/simulations/${session.session_id}/review`}
                    className="text-body-sm font-medium hover:text-accent-indigo"
                  >
                    {scenario?.name ?? session.scenario_id}
                  </Link>
                  <p className="text-tiny text-text-tertiary">
                    {learner?.display_name ?? session.user_id} · {session.turn_count} turns ·{' '}
                    {formatRelative(session.ended_at ?? session.started_at)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <ModePill mode={session.mode} />
                  {session.voice_enabled ? <Pill tone="info" size="sm">Voice</Pill> : null}
                  <Pill tone="neutral" size="sm">{titleize(session.runtime)}</Pill>
                  <Pill
                    tone={session.status === 'completed' ? 'success' : session.status === 'error' ? 'danger' : 'neutral'}
                    size="sm"
                  >
                    {titleize(session.status)}
                  </Pill>
                </div>
              </li>
            );
          })}
        </ul>
      </GlassCard>

      {/* Compliance posture strip — restrained, no red dashboard (§41). */}
      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-card-title">Compliance posture</h2>
          <p className="text-body-sm text-text-secondary">
            94% of sessions closed with no finding above low severity in the last 30 days.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RiskPill risk="low" />
          <Pill tone="warning" size="sm">2 open findings</Pill>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/security">Open security & audit</Link>
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
