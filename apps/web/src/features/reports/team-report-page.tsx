'use client';

import Link from 'next/link';
import { useState } from 'react';
import { SKILL_KEYS } from '@ai-coach/shared';
import { Download, Filter } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar, SkillHeatmap, TrendLine } from '@/components/data-viz';
import { RiskPill } from '@/components/status';
import {
  KNOWLEDGE_GAPS,
  SKILL_MATRIX,
  TEAM_KPIS,
  TEAM_LEADERBOARD,
} from '@/lib/fixtures/reports';
import { SCORE_TREND, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { MOCK_TEAMS } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import { ReportTabs } from './report-tabs';
import { titleize } from '@/lib/utils';

/** §35 Part I Manager / Team Analytics + §47 Part I report types. */
export function TeamReportPage() {
  const canExport = useCan('report.export');
  const [teamId, setTeamId] = useState<string>('all');
  const [range, setRange] = useState('30d');

  const rows = teamId === 'all' ? TEAM_KPIS : TEAM_KPIS.filter((kpi) => kpi.team_id === teamId);
  const totalMembers = rows.reduce((sum, row) => sum + row.members, 0);
  const avgScore = Math.round(rows.reduce((sum, row) => sum + row.average_score * row.members, 0) / Math.max(1, totalMembers));
  const avgPass = rows.reduce((sum, row) => sum + row.pass_rate * row.members, 0) / Math.max(1, totalMembers);
  const avgCompletion = rows.reduce((sum, row) => sum + row.completion_rate * row.members, 0) / Math.max(1, totalMembers);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Reports' }, { label: 'Team' }]}
        title="Team report"
        description="Average, pass rate, skill matrix, weakness heatmap, knowledge gaps and readiness."
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              Export
            </Button>
          ) : null
        }
      />

      <ReportTabs current="team" />

      <GlassCard className="flex flex-wrap items-end gap-4 p-4">
        <span className="flex items-center gap-1.5 text-body-sm text-text-tertiary">
          <Filter size={14} strokeWidth={1.8} aria-hidden />
          Filters
        </span>
        <div className="w-48">
          <Select
            value={teamId}
            onValueChange={setTeamId}
            ariaLabel="Team"
            options={[
              { value: 'all', label: 'All teams' },
              ...MOCK_TEAMS.map((team) => ({ value: team.id, label: team.name })),
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            value={range}
            onValueChange={setRange}
            ariaLabel="Date range"
            options={[
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last quarter' },
            ]}
          />
        </div>
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="Team average" value={String(avgScore)} hint={`${totalMembers} learners`} />
        <StatTile surface="card" label="Pass rate" value={`${Math.round(avgPass * 100)}%`} hint="against each scenario minimum" />
        <StatTile surface="card" label="Completion" value={`${Math.round(avgCompletion * 100)}%`} hint="mandatory assignments" />
        <StatTile surface="card" label="High potential" value={String(rows.reduce((sum, row) => sum + row.high_potential, 0))} hint={`${rows.reduce((sum, row) => sum + row.low_readiness, 0)} low readiness`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">Teams</h2>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {rows.map((row) => (
              <li key={row.team_id} className="py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{row.team_name}</p>
                    <p className="text-tiny text-text-tertiary">
                      {row.members} learners · {row.high_potential} high potential · {row.low_readiness} low readiness
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RiskPill risk={row.compliance_risk} />
                    <Pill tone={row.improvement >= 4 ? 'success' : 'neutral'} size="sm">
                      {row.improvement >= 0 ? '+' : ''}
                      {row.improvement} improvement
                    </Pill>
                  </div>
                </div>
                <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
                  <ScoreBar compact label="Average" score={row.average_score} threshold={80} />
                  <ScoreBar compact label="Pass rate" score={Math.round(row.pass_rate * 100)} />
                  <ScoreBar compact label="Completion" score={Math.round(row.completion_rate * 100)} />
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-card-title">Improvement trend</h2>
          <p className="text-tiny text-text-tertiary">Weighted team average by month</p>
          <TrendLine
            className="mt-3"
            points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score - 3 }))}
            ariaLabel="Team average score by month"
            min={55}
            max={95}
          />
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Skill matrix & weakness heatmap</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Compliance is the weakest dimension across every team — that is the workspace-level signal.
        </p>
        <SkillHeatmap
          className="mt-4"
          columns={[...SKILL_KEYS]}
          rows={SKILL_MATRIX.map((row) => ({
            id: row.team_id,
            label: row.team_name,
            values: SKILL_KEYS.map((key) => row.scores[key]),
          }))}
        />
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h2 className="text-card-title">Learners</h2>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {TEAM_LEADERBOARD.map((row) => (
              <li key={row.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/performance/${row.user_id}`} className="text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                    {row.display_name}
                  </Link>
                  <p className="text-tiny text-text-tertiary">
                    {row.team_name} · {row.sessions} sessions · weakest {SKILL_LABEL[row.weakest_skill]}
                  </p>
                </div>
                <span className="text-body-sm tabular-nums">{row.overall_score}</span>
                <Pill
                  tone={row.readiness === 'ready' ? 'success' : row.readiness === 'at_risk' ? 'danger' : 'warning'}
                  size="sm"
                >
                  {titleize(row.readiness)}
                </Pill>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-card-title">Knowledge gaps</h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            Topics learners get wrong most often, linked to the source document so the fix is concrete.
          </p>
          <ul className="mt-3 space-y-2.5">
            {KNOWLEDGE_GAPS.map((gap) => (
              <li key={gap.topic} className="rounded-card-sm border border-border-soft bg-glass-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body-sm font-medium">{gap.topic}</p>
                  <Pill tone="warning" size="sm">{Math.round(gap.miss_rate * 100)}% miss rate</Pill>
                </div>
                <p className="mt-1 text-tiny text-text-tertiary">
                  {gap.document_name} · {gap.affected_users} learners · {SKILL_LABEL[gap.linked_skill]}
                </p>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
