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
import { formatRelative } from '@/lib/utils';

/** `titleize()` on the raw enum values below produced English ("Server", "Completed")
 * in an otherwise all-Chinese list; small local maps instead. */
const RUNTIME_LABEL: Record<'webgpu' | 'wasm' | 'server', string> = {
  webgpu: 'WebGPU', wasm: '本機 WASM', server: '伺服器運算',
};
const SESSION_STATUS_LABEL: Record<string, string> = {
  idle: '尚未開始', connecting: '連線中', ready: '進行中', listening: '聆聽中',
  transcribing: '轉錄中', processing: '處理中', persona_speaking: '對方說話中',
  paused: '已暫停', reconnecting: '重新連線中', completed: '已完成', error: '發生錯誤',
};

/**
 * §13 Dashboard.
 *
 * Layout follows §13.1: a hero + two-column grid of large glass cards rather than
 * eight little KPI squares (§13.3). Charts stay restrained — one activity bar
 * group and one score trend line, no pies and no gauges (§38 / §99).
 */
/** 依現在時段給出對應的中文問候語，不再永遠顯示「晚上好」。 */
function greetingForHour(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早安';
  if (hour < 18) return '午安';
  return '晚安';
}

export function DashboardPage() {
  const { user, workspace } = useAuth();
  const firstName = user?.display_name.split(' ')[0] ?? '你好';
  const greeting = greetingForHour(new Date().getHours());

  const todaysFocus = MOCK_ASSIGNMENT_PROGRESS.find((item) => item.status !== 'completed');
  const recentSessions = MOCK_SESSIONS.slice(0, 4);

  return (
    <div className="space-y-6 pb-4">
      <PageHeader
        title={`${greeting}，${firstName}`}
        description={`${workspace?.name ?? '此工作區'} 的訓練總覽 — 指派任務、準備度與今日目標。`}
        meta={
          <>
            <Pill tone="neutral" size="sm">第 12 週 · 2026</Pill>
            <Pill tone="success" size="sm">本週有 2 項指派即將到期</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/reports/team">
                團隊報表
                <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />
              </Link>
            </Button>
            <Button variant="primary" size="sm" asChild>
              <Link href="/simulations">
                <Play size={15} strokeWidth={2} aria-hidden />
                開始模擬練習
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
            <p className="meta-label">訓練總覽</p>
            <h2 className="mt-2 text-display">
              {Math.round(MOCK_ASSIGNMENT_PROGRESS.reduce((sum, item) => sum + item.completion_rate, 0) / MOCK_ASSIGNMENT_PROGRESS.length * 100)}%
            </h2>
            <p className="mt-1 text-body text-text-secondary">
              {MOCK_ASSIGNMENT_PROGRESS.length} 項進行中指派的平均完成率
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {DASHBOARD_KPIS.slice(0, 3).map((kpi) => (
                <div key={kpi.id} className="border-l border-border-soft pl-4 first:border-l-0 first:pl-0">
                  <p className="meta-label">{kpi.label}</p>
                  <p className="mt-1 flex items-baseline gap-2">
                    <span className="text-section tabular-nums">{kpi.value}</span>
                    {kpi.delta ? (
                      <span className="text-tiny font-medium text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">
                        {kpi.delta}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-tiny text-text-tertiary">{kpi.hint}</p>
                  {kpi.trend ? <Sparkline values={kpi.trend} /> : null}
                </div>
              ))}
            </div>
          </div>

          {/* §13.1 "Today / Objective" floating card. */}
          <div className="rounded-card border border-border-soft bg-[var(--surface-purple)] p-5">
            <div className="flex items-center gap-2">
              <Target size={16} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <p className="meta-label">今日目標</p>
            </div>
            {todaysFocus ? (
              <>
                <h3 className="mt-2.5 text-card-title">{todaysFocus.scenario_name}</h3>
                <p className="mt-1 text-body-sm text-text-secondary">
                  模擬人物：{todaysFocus.persona_name}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <DifficultyPill difficulty={todaysFocus.difficulty} />
                  <ModePill mode={todaysFocus.mode} />
                  {todaysFocus.mandatory ? <Pill tone="warning" size="sm">必修</Pill> : null}
                </div>
                <dl className="mt-4 space-y-2 text-body-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">及格分數</dt>
                    <dd className="tabular-nums">{todaysFocus.minimum_score}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">已嘗試次數</dt>
                    <dd className="tabular-nums">
                      {todaysFocus.attempts_used} / {todaysFocus.max_attempts ?? '∞'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-text-tertiary">狀態</dt>
                    <dd>{ASSIGNMENT_STATUS_LABEL[todaysFocus.status]}</dd>
                  </div>
                </dl>
                <Button variant="primary" size="sm" className="mt-4 w-full" asChild>
                  <Link href={`/simulations/${todaysFocus.scenario_id}/setup`}>前往設定練習</Link>
                </Button>
              </>
            ) : (
              <p className="mt-3 text-body-sm text-text-secondary">
                目前沒有待完成的項目。可從情境庫挑選任一情境繼續練習。
              </p>
            )}
          </div>
        </div>
      </GlassCard>

      {/* §13.3 KPI row — big tiles, not a grid of small squares. */}
      <GlassCard className="grid overflow-hidden p-0 sm:grid-cols-2 lg:grid-cols-3">
        {DASHBOARD_KPIS.map((kpi) => (
          <StatTile
            key={kpi.id}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            hint={kpi.hint}
            className="border-b border-border-soft last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
          />
        ))}
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Assigned training */}
        <GlassCard className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">指派訓練</h2>
              <p className="text-tiny text-text-tertiary">
                需嘗試 ≥ 2 次、分數 ≥ 及格門檻，且無重大合規風險，才算完成。
              </p>
            </div>
            <Link
              href="/training"
              className="shrink-0 text-body-sm text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
            >
              查看全部指派
            </Link>
          </div>

          <ul className="divide-y divide-border-soft">
            {MOCK_ASSIGNMENT_PROGRESS.map((item) => (
              <li key={item.assignment_id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/simulations/${item.scenario_id}/setup`}
                      className="text-body font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                    >
                      {item.scenario_name}
                    </Link>
                    <p className="mt-0.5 text-tiny text-text-tertiary">
                      {item.persona_name}
                      {item.deadline ? ` · 到期 ${formatRelative(item.deadline)}` : ''}
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
                    最高 {item.best_score ?? '—'} / 及格 {item.minimum_score}
                  </span>
                  <span className="tabular-nums">
                    嘗試 {item.attempts_used}/{item.max_attempts ?? '∞'}
                  </span>
                  {item.blocking_skill ? (
                    <span>阻礙完成的技能：{SKILL_LABEL[item.blocking_skill]}</span>
                  ) : null}
                  {item.critical_findings > 0 ? (
                    <span className="font-medium text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">
                      {item.critical_findings} 項合規發現
                    </span>
                  ) : null}
                </div>

                <ProgressBar
                  value={Math.round(item.completion_rate * 100)}
                  label="團隊完成率"
                  valueLabel={`${item.assignee_count} 人中已完成 ${Math.round(item.completion_rate * 100)}%`}
                  tone="ai"
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
              <h2 className="text-card-title">準備度</h2>
            </div>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-display tabular-nums">{DEMO_SKILL_PROFILE.overall_score}</span>
              <span className="text-body-sm text-text-tertiary">/ 100 分（總分）</span>
            </p>
            <p className="text-body-sm font-medium text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">
              本月 +{DEMO_SKILL_PROFILE.monthly_improvement}
            </p>

            <dl className="mt-4 space-y-2.5 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">最擅長</dt>
                <dd>{SKILL_LABEL[DEMO_SKILL_PROFILE.strongest_skill]}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">待加強</dt>
                <dd className="text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]">
                  {SKILL_LABEL[DEMO_SKILL_PROFILE.weakest_skill]}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-tertiary">已完成練習</dt>
                <dd className="tabular-nums">{DEMO_SKILL_PROFILE.completed_sessions}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-1.5 text-text-tertiary">
                  <CalendarClock size={13} strokeWidth={1.8} aria-hidden />
                  預估達標天數
                </dt>
                <dd className="tabular-nums">{DEMO_SKILL_PROFILE.days_to_readiness ?? '—'}</dd>
              </div>
            </dl>

            <TrendLine
              className="mt-4"
              points={SCORE_TREND.map((point) => ({ label: point.label, value: point.score }))}
              ariaLabel="近六個月的總分趨勢"
              min={55}
              max={95}
            />

            <Link
              href="/performance"
              className="mt-3 inline-flex items-center gap-1 text-body-sm text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
            >
              個人進度
              <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
            </Link>
          </GlassCard>

          {/* Activity */}
          <GlassCard className="p-5">
            <h2 className="text-card-title">活動狀況</h2>
            <p className="text-tiny text-text-tertiary">每日練習場次 · 語音練習以醒目顏色標示</p>
            <MiniBars
              className="mt-4"
              data={ACTIVITY_BY_DAY.map((day) => ({
                label: day.label,
                value: day.sessions,
                secondary: day.voice,
              }))}
              ariaLabel="本週每日練習場次，語音練習以醒目顏色標示"
            />
          </GlassCard>
        </div>
      </div>

      {/* Recent sessions */}
      <GlassCard className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-card-title">最近的練習</h2>
          <Link
            href="/simulations"
            className="text-body-sm text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
          >
            模擬練習情境庫
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
                    className="text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
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
                  {session.voice_enabled ? <Pill tone="info" size="sm">語音</Pill> : null}
                  <Pill tone="neutral" size="sm">{RUNTIME_LABEL[session.runtime]}</Pill>
                  <Pill
                    tone={session.status === 'completed' ? 'success' : session.status === 'error' ? 'danger' : 'neutral'}
                    size="sm"
                  >
                    {SESSION_STATUS_LABEL[session.status] ?? session.status}
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
          <h2 className="text-card-title">合規狀況</h2>
          <p className="text-body-sm text-text-secondary">
            過去 30 天內，94% 的練習未出現高於低風險的合規發現。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RiskPill risk="low" />
          <Pill tone="warning" size="sm">2 項待處理發現</Pill>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/security">前往安全與稽核</Link>
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
