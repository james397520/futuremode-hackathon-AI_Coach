'use client';

import Link from 'next/link';
import { SKILL_KEYS } from '@ai-coach/shared';
import { ArrowUpRight, Flame, Target, TrendingUp } from 'lucide-react';
import { Button, GlassCard, Pill, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar, SkillRadar, TrendLine } from '@/components/data-viz';
import { RiskPill } from '@/components/status';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';
import {
  DEMO_HISTORY_JOURNEYS,
  DEMO_HISTORY_PROFILE,
  DEMO_HISTORY_RECOMMENDATION,
  DEMO_HISTORY_SESSIONS,
  DEMO_HISTORY_TREND,
} from '@/lib/fixtures/demo-history';
import { userById } from '@/lib/fixtures/identity';
import { useAuth } from '@/lib/auth-context';
import { DIFFICULTY_LABEL } from '@/lib/enum-labels';

/**
 * §34 Part I 個人成長頁 — overall score, monthly improvement, weakest and
 * strongest skill, sessions, compliance trend, knowledge mastery and days to
 * readiness, visualised as a radar, a trend and a mastery list (§38 restraint).
 */
export function PerformancePage({ userId }: { userId?: string }) {
  const { user } = useAuth();
  const target = userId ? userById(userId) : user;
  const profile = DEMO_HISTORY_PROFILE;
  const isOwn = !userId || userId === user?.id;

  const sessions = DEMO_HISTORY_SESSIONS;
  const radarValues = SKILL_KEYS.map((key) => profile.skills[key]);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={
          isOwn
            ? undefined
            : [{ label: '成效檢視', href: '/performance' }, { label: target?.display_name ?? userId ?? '' }]
        }
        title={isOwn ? '我的進度' : `${target?.display_name ?? '學員'} — 進度`}
        description="頁面上的每一個數字，都可以往下追到逐字稿佐證。"
        meta={
          <>
            <Pill tone="neutral" size="sm">{profile.completed_sessions} 場練習</Pill>
            <Pill tone="success" size="sm">本月 +{profile.monthly_improvement}</Pill>
            <RiskPill risk="low" />
          </>
        }
        actions={
          <Button variant="secondary" size="sm" asChild>
            <Link href="/reports/skill">
              技能報表
              <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="技能總分" value={String(profile.overall_score)} delta={`+${profile.monthly_improvement}`} hint="十項維度加權計算" />
        <StatTile surface="card" label="最擅長" value={SKILL_LABEL[profile.strongest_skill]} hint={`${profile.skills[profile.strongest_skill]} / 100`} />
        <StatTile surface="card" label="待加強" value={SKILL_LABEL[profile.weakest_skill]} hint={`${profile.skills[profile.weakest_skill]} / 100`} />
        <StatTile surface="card" label="預估達標天數" value={String(profile.days_to_readiness ?? '—')} hint="以目前的進步速度推估" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">技能輪廓</h2>
          <p className="text-tiny text-text-tertiary">與團隊平均對照</p>
          <SkillRadar
            axes={[...SKILL_KEYS]}
            series={[
              { id: 'me', label: isOwn ? '你' : target?.display_name ?? '學員', color: 'var(--accent-indigo)', values: radarValues },
              { id: 'team', label: '團隊平均', color: 'var(--accent-cyan)', values: [78, 80, 76, 79, 74, 77, 80, 82, 73, 79] },
            ]}
          />
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">分數趨勢</h2>
            </div>
            <TrendLine
              className="mt-3"
              points={DEMO_HISTORY_TREND.map((point) => ({ label: point.label, value: point.score }))}
              ariaLabel="每月的總分"
              min={55}
              max={95}
            />
            <p className="mt-2 text-tiny text-text-tertiary">
              練習頻率：{DEMO_HISTORY_TREND.map((point) => `${point.label} ${point.sessions}`).join(' · ')}
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <h2 className="text-card-title">合規趨勢</h2>
            <p className="text-tiny text-text-tertiary">
              合規是關卡型維度 — 只要出現重大發現，不論其他分數多高，該場練習一律不通過。
            </p>
            <TrendLine
              className="mt-3"
              points={profile.compliance_trend.map((value, index) => ({
                label: DEMO_HISTORY_TREND[index]?.label ?? `M${index + 1}`,
                value,
              }))}
              ariaLabel="每月的合規分數"
              min={40}
              max={100}
            />
          </GlassCard>
        </div>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">十項維度</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          開啟任一場練習報表，即可看到這些分數背後的逐字稿摘錄。
        </p>
        <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {SKILL_KEYS.map((key) => (
            <ScoreBar key={key} label={SKILL_LABEL[key]} score={profile.skills[key]} threshold={80} />
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">示範情境的分數歷程</h2>
          <p className="text-tiny text-text-tertiary">每一次練習的分數，由舊到新；及格線 70。</p>
          <ul className="mt-4 divide-y divide-border-soft/70">
            {DEMO_HISTORY_JOURNEYS.map((journey) => {
              const latest = journey.scores[journey.scores.length - 1] ?? 0;
              const first = journey.scores[0] ?? latest;
              const best = Math.max(...journey.scores);
              const passed = journey.scores.filter((v) => v >= journey.pass_threshold).length;
              const delta = latest - first;
              return (
                <li key={journey.scenario_id} className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3.5">
                  <div className="min-w-0 flex-1 basis-56">
                    <Link
                      href={journey.href}
                      className="text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                    >
                      {journey.scenario_name}
                    </Link>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      {DIFFICULTY_LABEL[journey.difficulty] ?? journey.difficulty} · {journey.scores.length} 次 · 及格 {passed}/{journey.scores.length}
                    </p>
                  </div>
                  <Sparkline values={journey.scores} threshold={journey.pass_threshold} />
                  <div className="flex items-baseline gap-2 tabular-nums">
                    <span className="text-display leading-none">{latest}</span>
                    <span className="text-tiny text-text-tertiary">最佳 {best}</span>
                    <span
                      className="text-tiny font-medium"
                      style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {delta >= 0 ? '+' : ''}{delta}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">接下來該做什麼</h2>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">
              依你最弱的維度推薦：{DEMO_HISTORY_RECOMMENDATION.weak_skills.map((skill) => SKILL_LABEL[skill]).join('、')}。
            </p>
            <ul className="mt-3 space-y-2 text-body-sm">
              <li>
                <Link
                  href={DEMO_HISTORY_RECOMMENDATION.retry_href}
                  className="font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                >
                  再練一次：續保費率調漲的情緒應對——張若瑄
                </Link>
              </li>
              <li>
                <Link
                  href={DEMO_HISTORY_RECOMMENDATION.next_href}
                  className="font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                >
                  下一個情境：投資型保單的合規對談——周敏惠
                </Link>
              </li>
              {DEMO_HISTORY_RECOMMENDATION.knowledge_material.map((material) => (
                <li key={material.document_id} className="text-text-secondary">
                  延伸閱讀：{material.reason}
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Flame size={16} strokeWidth={1.8} aria-hidden className="text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]" />
              <h2 className="text-card-title">最近的練習</h2>
            </div>
            <ul className="mt-3 divide-y divide-border-soft/70">
              {sessions.slice(0, 6).map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={session.href}
                      className="truncate text-body-sm hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                    >
                      {session.scenario_name}
                    </Link>
                    <p className="text-tiny text-text-tertiary">
                      {session.days_ago === 0 ? '今天' : `${session.days_ago} 天前`} · {session.turn_count} 輪對話 · {session.duration_min} 分鐘
                      {session.compliance_flags > 0 ? ` · 合規旗標 ${session.compliance_flags}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-body-sm font-semibold tabular-nums">{session.score}</span>
                    <Pill tone={session.passed ? 'success' : 'danger'} size="sm">
                      {session.passed ? '通過' : '未通過'}
                    </Pill>
                  </div>
                </li>
              ))}
              {sessions.length === 0 ? (
                <li className="py-4 text-body-sm text-text-tertiary">尚未有練習紀錄。</li>
              ) : null}
            </ul>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}

/** 迷你折線：一眼看出起伏與是否跨過及格線，不佔版面。 */
function Sparkline({ values, threshold }: { values: number[]; threshold: number }) {
  const w = 168;
  const h = 40;
  const pad = 4;
  const min = Math.min(threshold - 8, ...values);
  const max = Math.max(threshold + 8, ...values);
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / Math.max(1, max - min);
  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1] ?? 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <line x1={pad} x2={w - pad} y1={y(threshold)} y2={y(threshold)} stroke="var(--border-soft)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--accent-indigo)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3.2} fill={last >= threshold ? 'var(--success)' : 'var(--danger)'} />
    </svg>
  );
}
