'use client';

import Link from 'next/link';
import { SKILL_KEYS, type SkillKey } from '@ai-coach/shared';
import { Download } from 'lucide-react';
import { Button, GlassCard, Pill, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar, SkillHeatmap, TrendLine } from '@/components/data-viz';
import { KNOWLEDGE_GAPS, SKILL_MATRIX, TEAM_LEADERBOARD } from '@/lib/fixtures/reports';
import { RUBRIC_LIFE_CORE, SCORE_TREND, SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { useCan } from '@/lib/auth-context';
import { ReportTabs } from './report-tabs';

/** §47 Part I skill report — per-dimension breakdown across the workspace. */
export function SkillReportPage() {
  const canExport = useCan('report.export');

  const workspaceAverage = (skill: SkillKey) =>
    Math.round(SKILL_MATRIX.reduce((sum, row) => sum + row.scores[skill], 0) / Math.max(1, SKILL_MATRIX.length));

  const ranked = [...SKILL_KEYS].sort((a, b) => workspaceAverage(a) - workspaceAverage(b));
  const weakest = ranked[0]!;
  const strongest = ranked[ranked.length - 1]!;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Reports' }, { label: 'Skill' }]}
        title="Skill report"
        description="Where the whole workspace is strong and weak across the ten evaluation dimensions."
        meta={
          <Pill tone="neutral" size="sm">
            Rubric {RUBRIC_LIFE_CORE.name} v{RUBRIC_LIFE_CORE.version}
          </Pill>
        }
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              Export
            </Button>
          ) : null
        }
      />

      <ReportTabs current="skill" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="Weakest dimension" value={SKILL_LABEL[weakest]} hint={`${workspaceAverage(weakest)} / 100 workspace average`} />
        <StatTile surface="card" label="Strongest dimension" value={SKILL_LABEL[strongest]} hint={`${workspaceAverage(strongest)} / 100`} />
        <StatTile surface="card" label="Below threshold" value={String(ranked.filter((skill) => workspaceAverage(skill) < RUBRIC_LIFE_CORE.pass_threshold).length)} hint={`of ${SKILL_KEYS.length} dimensions`} />
        <StatTile surface="card" label="Knowledge gaps" value={String(KNOWLEDGE_GAPS.length)} hint="topics driving the misses" />
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Workspace average by dimension</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Ordered weakest first. The tick marks the rubric pass threshold of {RUBRIC_LIFE_CORE.pass_threshold}.
        </p>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {ranked.map((skill) => (
            <ScoreBar
              key={skill}
              label={`${SKILL_LABEL[skill]} · weight ${RUBRIC_LIFE_CORE.weights[skill]}%`}
              score={workspaceAverage(skill)}
              threshold={RUBRIC_LIFE_CORE.pass_threshold}
            />
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">By team</h2>
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
          <h2 className="text-card-title">Learners most affected by the weakest dimension</h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            Whose {SKILL_LABEL[weakest]} score is holding their overall score back.
          </p>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {TEAM_LEADERBOARD.filter((row) => row.weakest_skill === weakest || row.overall_score < 80).map((row) => (
              <li key={row.user_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/performance/${row.user_id}`} className="text-body-sm hover:text-accent-indigo">
                    {row.display_name}
                  </Link>
                  <p className="text-tiny text-text-tertiary">{row.team_name}</p>
                </div>
                <span className="text-body-sm tabular-nums">{row.overall_score}</span>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-card-title">Dimension trend</h2>
          <p className="text-tiny text-text-tertiary">{SKILL_LABEL[weakest]} across the last six months</p>
          <TrendLine
            className="mt-3"
            points={SCORE_TREND.map((point, index) => ({
              label: point.label,
              value: 52 + index * 3,
            }))}
            ariaLabel={`${SKILL_LABEL[weakest]} workspace average by month`}
            min={40}
            max={90}
          />
          <p className="mt-3 text-body-sm text-text-secondary">
            Improving, but still the lowest dimension. The compliance assessment assignment is the intended
            intervention.
          </p>
          <Button variant="ghost" size="sm" className="mt-3" asChild>
            <Link href="/training">Open training assignments</Link>
          </Button>
        </GlassCard>
      </div>
    </div>
  );
}
