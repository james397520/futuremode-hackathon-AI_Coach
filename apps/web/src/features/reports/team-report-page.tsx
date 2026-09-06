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
import { READINESS_LABEL } from '@/lib/enum-labels';

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
        breadcrumbs={[{ label: '報表' }, { label: '團隊' }]}
        title="團隊報表"
        description="平均分數、及格率、技能矩陣、弱項熱區圖、知識落差與準備度。"
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              匯出
            </Button>
          ) : null
        }
      />

      <ReportTabs current="team" />

      <GlassCard className="flex flex-wrap items-end gap-4 p-4">
        <span className="flex items-center gap-1.5 text-body-sm text-text-tertiary">
          <Filter size={14} strokeWidth={1.8} aria-hidden />
          篩選
        </span>
        <div className="w-48">
          <Select
            value={teamId}
            onValueChange={setTeamId}
            ariaLabel="團隊"
            options={[
              { value: 'all', label: '全部團隊' },
              ...MOCK_TEAMS.map((team) => ({ value: team.id, label: team.name })),
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            value={range}
            onValueChange={setRange}
            ariaLabel="時間範圍"
            options={[
              { value: '7d', label: '近 7 天' },
              { value: '30d', label: '近 30 天' },
              { value: '90d', label: '上一季' },
            ]}
          />
        </div>
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="團隊平均" value={String(avgScore)} hint={`${totalMembers} 位學員`} />
        <StatTile surface="card" label="及格率" value={`${Math.round(avgPass * 100)}%`} hint="以各情境的最低分數為準" />
        <StatTile surface="card" label="完成率" value={`${Math.round(avgCompletion * 100)}%`} hint="必修指派" />
        <StatTile surface="card" label="高潛力人數" value={String(rows.reduce((sum, row) => sum + row.high_potential, 0))} hint={`${rows.reduce((sum, row) => sum + row.low_readiness, 0)} 位準備度偏低`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">團隊</h2>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {rows.map((row) => (
              <li key={row.team_id} className="py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">{row.team_name}</p>
                    <p className="text-tiny text-text-tertiary">
                      {row.members} 位學員 · {row.high_potential} 位高潛力 · {row.low_readiness} 位準備度偏低
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RiskPill risk={row.compliance_risk} />
                    <Pill tone={row.improvement >= 4 ? 'success' : 'neutral'} size="sm">
                      {row.improvement >= 0 ? '+' : ''}
                      {row.improvement} 進步幅度
                    </Pill>
                  </div>
                </div>
                <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
                  <ScoreBar compact label="平均分數" score={row.average_score} threshold={80} />
                  <ScoreBar compact label="及格率" score={Math.round(row.pass_rate * 100)} />
                  <ScoreBar compact label="完成率" score={Math.round(row.completion_rate * 100)} />
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-card-title">進步趨勢</h2>
          <p className="text-tiny text-text-tertiary">每月的團隊加權平均</p>
          <TrendLine
            className="mt-3"
            points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score - 3 }))}
            ariaLabel="每月的團隊平均分數"
            min={55}
            max={95}
          />
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">技能矩陣與弱項熱區圖</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          合規是每個團隊共同最弱的維度 — 這是工作區層級的警訊。
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
          <h2 className="text-card-title">學員</h2>
          <ul className="mt-3 divide-y divide-border-soft/70">
            {TEAM_LEADERBOARD.map((row) => (
              <li key={row.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/performance/${row.user_id}`} className="text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                    {row.display_name}
                  </Link>
                  <p className="text-tiny text-text-tertiary">
                    {row.team_name} · {row.sessions} 場練習 · 最弱：{SKILL_LABEL[row.weakest_skill]}
                  </p>
                </div>
                <span className="text-body-sm tabular-nums">{row.overall_score}</span>
                <Pill
                  tone={row.readiness === 'ready' ? 'success' : row.readiness === 'at_risk' ? 'danger' : 'warning'}
                  size="sm"
                >
                  {READINESS_LABEL[row.readiness] ?? row.readiness}
                </Pill>
              </li>
            ))}
          </ul>
        </GlassCard>

        <GlassCard className="p-5">
          <h2 className="text-card-title">知識落差</h2>
          <p className="mt-1 text-body-sm text-text-secondary">
            學員最常答錯的主題，並連結到來源文件，讓補強有明確依據。
          </p>
          <ul className="mt-3 space-y-2.5">
            {KNOWLEDGE_GAPS.map((gap) => (
              <li key={gap.topic} className="rounded-card-sm border border-border-soft bg-glass-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-body-sm font-medium">{gap.topic}</p>
                  <Pill tone="warning" size="sm">答錯率 {Math.round(gap.miss_rate * 100)}%</Pill>
                </div>
                <p className="mt-1 text-tiny text-text-tertiary">
                  {gap.document_name} · {gap.affected_users} 位學員 · {SKILL_LABEL[gap.linked_skill]}
                </p>
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
