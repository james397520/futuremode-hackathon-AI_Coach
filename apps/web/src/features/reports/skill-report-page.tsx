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
        breadcrumbs={[{ label: '報表' }, { label: '技能' }]}
        title="技能報表"
        description="整個工作區在十項評分維度上的強項與弱項。"
        meta={
          <Pill tone="neutral" size="sm">
            評分規準 {RUBRIC_LIFE_CORE.name} v{RUBRIC_LIFE_CORE.version}
          </Pill>
        }
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              匯出
            </Button>
          ) : null
        }
      />

      <ReportTabs current="skill" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="最弱維度" value={SKILL_LABEL[weakest]} hint={`工作區平均 ${workspaceAverage(weakest)} / 100`} />
        <StatTile surface="card" label="最強維度" value={SKILL_LABEL[strongest]} hint={`${workspaceAverage(strongest)} / 100`} />
        <StatTile surface="card" label="未達門檻" value={String(ranked.filter((skill) => workspaceAverage(skill) < RUBRIC_LIFE_CORE.pass_threshold).length)} hint={`共 ${SKILL_KEYS.length} 項維度`} />
        <StatTile surface="card" label="知識落差" value={String(KNOWLEDGE_GAPS.length)} hint="造成答錯的主題" />
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">各維度的工作區平均</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          由最弱排到最強。刻度標示的是評分規準的及格門檻 {RUBRIC_LIFE_CORE.pass_threshold} 分。
        </p>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {ranked.map((skill) => (
            <ScoreBar
              key={skill}
              label={`${SKILL_LABEL[skill]} · 權重 ${RUBRIC_LIFE_CORE.weights[skill]}%`}
              score={workspaceAverage(skill)}
              threshold={RUBRIC_LIFE_CORE.pass_threshold}
            />
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">依團隊分佈</h2>
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
          <h2 className="text-card-title">受最弱維度影響最深的學員</h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            這些學員的總分被{SKILL_LABEL[weakest]}分數拖住。
          </p>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {TEAM_LEADERBOARD.filter((row) => row.weakest_skill === weakest || row.overall_score < 80).map((row) => (
              <li key={row.user_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/performance/${row.user_id}`} className="text-body-sm hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
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
          <h2 className="text-card-title">維度趨勢</h2>
          <p className="text-tiny text-text-tertiary">近六個月的{SKILL_LABEL[weakest]}表現</p>
          <TrendLine
            className="mt-3"
            points={SCORE_TREND.map((point, index) => ({
              label: point.label,
              value: 52 + index * 3,
            }))}
            ariaLabel={`${SKILL_LABEL[weakest]}的每月工作區平均`}
            min={40}
            max={90}
          />
          <p className="mt-3 text-body-sm text-text-secondary">
            雖然持續進步，但仍是分數最低的維度。合規評測指派就是針對這一點設計的補強措施。
          </p>
          <Button variant="ghost" size="sm" className="mt-3" asChild>
            <Link href="/training">開啟訓練指派</Link>
          </Button>
        </GlassCard>
      </div>
    </div>
  );
}
