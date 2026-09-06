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
 * §34 Part I 個人成長頁 — 單屏版。所有內容（總分、四項指標、技能輪廓、十維度、
 * 兩條趨勢、三個示範情境的分數歷程、最近練習、下一步）壓進一個視窗高度，不需捲動：
 * 三列固定比例的格線，卡片內以緊湊間距與小字排版，圖表縮小但保留所有數據。
 */
export function PerformancePage({ userId }: { userId?: string }) {
  const { user } = useAuth();
  const target = userId ? userById(userId) : user;
  const profile = DEMO_HISTORY_PROFILE;
  const isOwn = !userId || userId === user?.id;
  const radarValues = SKILL_KEYS.map((key) => profile.skills[key]);
  const sessions = DEMO_HISTORY_SESSIONS;

  return (
    <div className="flex h-[calc(100dvh-7.75rem)] min-h-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        breadcrumbs={
          isOwn
            ? undefined
            : [{ label: '成效檢視', href: '/performance' }, { label: target?.display_name ?? userId ?? '' }]
        }
        title={isOwn ? '我的進度' : `${target?.display_name ?? '學員'} — 進度`}
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

      {/* Row 1 — four headline numbers */}
      <div className="grid shrink-0 grid-cols-4 gap-3">
        <StatTile surface="card" label="技能總分" value={String(profile.overall_score)} delta={`+${profile.monthly_improvement}`} hint="十項維度加權" />
        <StatTile surface="card" label="最擅長" value={SKILL_LABEL[profile.strongest_skill]} hint={`${profile.skills[profile.strongest_skill]} / 100`} />
        <StatTile surface="card" label="待加強" value={SKILL_LABEL[profile.weakest_skill]} hint={`${profile.skills[profile.weakest_skill]} / 100`} />
        <StatTile surface="card" label="預估達標天數" value={String(profile.days_to_readiness ?? '—')} hint="依目前進步速度" />
      </div>

      {/* Row 2 — profile: radar · ten dimensions · two trends */}
      <div className="grid min-h-0 flex-[1.15] grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
        <GlassCard className="flex min-h-0 flex-col p-4">
          <h2 className="text-card-title">技能輪廓</h2>
          <p className="text-tiny text-text-tertiary">與團隊平均對照</p>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <SkillRadar
              size={208}
              axes={[...SKILL_KEYS]}
              series={[
                { id: 'me', label: isOwn ? '你' : target?.display_name ?? '學員', color: 'var(--accent-indigo)', values: radarValues },
                { id: 'team', label: '團隊平均', color: 'var(--accent-cyan)', values: [78, 80, 76, 79, 74, 77, 80, 82, 73, 79] },
              ]}
            />
          </div>
        </GlassCard>

        <GlassCard className="flex min-h-0 flex-col p-4">
          <h2 className="text-card-title">十項維度</h2>
          <p className="text-tiny text-text-tertiary">及格線 80，每一分都能追到逐字稿佐證。</p>
          <div className="mt-3 grid flex-1 grid-cols-2 content-start gap-x-6 gap-y-2.5">
            {SKILL_KEYS.map((key) => (
              <ScoreBar key={key} compact label={SKILL_LABEL[key]} score={profile.skills[key]} threshold={80} />
            ))}
          </div>
        </GlassCard>

        <div className="grid min-h-0 grid-rows-2 gap-3">
          <GlassCard className="flex min-h-0 flex-col p-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">分數趨勢</h2>
              <span className="ml-auto truncate text-tiny text-text-tertiary">
                {DEMO_HISTORY_TREND.map((p) => `${p.label} ${p.sessions}`).join(' · ')}
              </span>
            </div>
            <TrendLine
              className="mt-1"
              height={86}
              points={DEMO_HISTORY_TREND.map((point) => ({ label: point.label, value: point.score }))}
              ariaLabel="每月的總分"
              min={55}
              max={95}
            />
          </GlassCard>
          <GlassCard className="flex min-h-0 flex-col p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-card-title">合規趨勢</h2>
              <span className="ml-auto truncate text-tiny text-text-tertiary">關卡型維度：出現重大發現即不通過</span>
            </div>
            <TrendLine
              className="mt-1"
              height={86}
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

      {/* Row 3 — the three demo journeys · recent sessions · next steps */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-3">
        <GlassCard className="flex min-h-0 flex-col p-4">
          <h2 className="text-card-title">示範情境的分數歷程</h2>
          <p className="text-tiny text-text-tertiary">每一次練習的分數，由舊到新；及格線 70。</p>
          <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-around divide-y divide-border-soft/70">
            {DEMO_HISTORY_JOURNEYS.map((journey) => {
              const latest = journey.scores[journey.scores.length - 1] ?? 0;
              const first = journey.scores[0] ?? latest;
              const best = Math.max(...journey.scores);
              const passed = journey.scores.filter((v) => v >= journey.pass_threshold).length;
              const delta = latest - first;
              return (
                <li key={journey.scenario_id} className="flex items-center gap-4 py-1.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={journey.href}
                      className="block truncate text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                    >
                      {journey.scenario_name}
                    </Link>
                    <p className="text-tiny text-text-tertiary">
                      {DIFFICULTY_LABEL[journey.difficulty] ?? journey.difficulty} · {journey.scores.length} 次 · 及格 {passed}/{journey.scores.length}
                    </p>
                  </div>
                  <Sparkline values={journey.scores} threshold={journey.pass_threshold} />
                  <div className="flex w-28 shrink-0 items-baseline justify-end gap-1.5 tabular-nums">
                    <span className="text-[1.6rem] font-semibold leading-none">{latest}</span>
                    <span className="text-tiny text-text-tertiary">最佳 {best}</span>
                    <span className="text-tiny font-medium" style={{ color: delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {delta >= 0 ? '+' : ''}{delta}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </GlassCard>

        <GlassCard className="flex min-h-0 flex-col p-4">
          <div className="flex items-center gap-2">
            <Flame size={14} strokeWidth={1.8} aria-hidden className="text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]" />
            <h2 className="text-card-title">最近的練習</h2>
          </div>
          <ul className="mt-1 flex min-h-0 flex-1 flex-col justify-around divide-y divide-border-soft/70">
            {sessions.slice(0, 4).map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <Link
                    href={session.href}
                    className="block truncate text-body-sm hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                  >
                    {session.scenario_name}
                  </Link>
                  <p className="text-tiny text-text-tertiary">
                    {session.days_ago === 0 ? '今天' : `${session.days_ago} 天前`} · {session.turn_count} 輪 · {session.duration_min} 分
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
          </ul>
        </GlassCard>

        <GlassCard className="flex min-h-0 flex-col p-4">
          <div className="flex items-center gap-2">
            <Target size={14} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
            <h2 className="text-card-title">接下來該做什麼</h2>
          </div>
          <p className="mt-1 text-tiny text-text-secondary">
            依最弱維度推薦：{DEMO_HISTORY_RECOMMENDATION.weak_skills.map((skill) => SKILL_LABEL[skill]).join('、')}。
          </p>
          <ul className="mt-2 space-y-2 text-body-sm">
            <li>
              <Link href={DEMO_HISTORY_RECOMMENDATION.retry_href} className="font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                再練一次：續保費率調漲的情緒應對——張若瑄
              </Link>
            </li>
            <li>
              <Link href={DEMO_HISTORY_RECOMMENDATION.next_href} className="font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                下一個情境：投資型保單的合規對談——周敏惠
              </Link>
            </li>
            {DEMO_HISTORY_RECOMMENDATION.knowledge_material.map((material) => (
              <li key={material.document_id} className="text-tiny text-text-secondary">
                延伸閱讀：{material.reason}
              </li>
            ))}
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}

/** 迷你折線：一眼看出起伏與是否跨過及格線，不佔版面。 */
function Sparkline({ values, threshold }: { values: number[]; threshold: number }) {
  const w = 150;
  const h = 36;
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
