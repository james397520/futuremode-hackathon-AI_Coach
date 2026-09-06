'use client';

/**
 * 首頁 hero — 高級 SaaS 著陸頁的構圖：置中大標與副標、CTA，其下是一組「螢幕＋手機」
 * 裝置模型，螢幕裡放的是用真實圖表元件組成的產品儀表板、手機裡是一段迷你對談；四周
 * 漂浮產品裡真的會出現的卡片（目前狀態、合規攔截統計、語音播放器、知識庫引用）與整合
 * 服務的柔色圖示。白底玻璃、柔和陰影、大量留白，紫色只留給重點與圖表線。
 */
import Link from 'next/link';
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  Hash,
  MessageCircle,
  Mic,
  Play,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { ScoreBar, TrendLine } from '@/components/data-viz';
import { DEMO_HISTORY_PROFILE, DEMO_HISTORY_SESSIONS, DEMO_HISTORY_TREND } from '@/lib/fixtures/demo-history';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';

/* ------------------------------------------------------------------ */
/* small building blocks                                              */
/* ------------------------------------------------------------------ */

const CARD =
  'rounded-card border border-white/70 bg-white/85 shadow-[0_18px_50px_-24px_rgba(63,52,140,0.35)] backdrop-blur-card dark:border-white/10 dark:bg-white/[0.06]';

function Waveform({ bars = 42, className = '' }: { bars?: number; className?: string }) {
  // Deterministic pseudo-random heights so the wave looks organic yet renders the same each time.
  const heights = Array.from({ length: bars }, (_, i) => 30 + Math.abs(Math.sin(i * 1.7) * 45) + Math.abs(Math.cos(i * 0.6) * 20));
  return (
    <div className={`flex h-6 items-center gap-[2px] ${className}`} aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full"
          style={{ height: `${h}%`, background: i < bars * 0.55 ? 'var(--accent-indigo)' : 'color-mix(in srgb, var(--accent-indigo) 30%, transparent)' }}
        />
      ))}
    </div>
  );
}

function AppTile({ icon, tint, className, delay = '0s' }: { icon: React.ReactNode; tint: string; className: string; delay?: string }) {
  return (
    <div
      className={`hero-float absolute z-20 flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/80 bg-white shadow-[0_14px_36px_-18px_rgba(63,52,140,0.45)] dark:border-white/10 dark:bg-white/[0.08] ${className}`}
      style={{ animationDelay: delay, color: tint }}
      aria-hidden
    >
      {icon}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the hero                                                             */
/* ------------------------------------------------------------------ */

export function HeroLanding() {
  const profile = DEMO_HISTORY_PROFILE;
  const recent = DEMO_HISTORY_SESSIONS.slice(0, 3);
  const latest = DEMO_HISTORY_TREND[DEMO_HISTORY_TREND.length - 1]?.score ?? profile.overall_score;

  return (
    <section
      className="relative overflow-hidden rounded-shell border border-white/60 dark:border-white/10"
      aria-label="SkillCoach 首頁"
      style={{
        background:
          'radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, var(--accent-indigo) 14%, transparent), transparent 70%), ' +
          'radial-gradient(50% 40% at 50% 100%, color-mix(in srgb, var(--accent-blue) 12%, transparent), transparent 70%), ' +
          'color-mix(in srgb, white 88%, var(--glass-card))',
      }}
    >
      {/* Copy ------------------------------------------------------------ */}
      <div className="relative z-10 mx-auto max-w-3xl px-6 pt-14 text-center lg:pt-16">
        <h1 className="text-[clamp(2.2rem,4.4vw,3.9rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-text-primary">
          SkillCoach
          <br />
          Practice every conversation before it counts.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-body text-text-secondary">
          SkillCoach 用會反問的 AI 客戶、即時提醒的教練與自動攔截的合規，把每一次練習變成有憑有據的成長紀錄。
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <Button variant="primary" size="md" asChild>
            <Link href="/simulations">
              <Play size={15} strokeWidth={2} aria-hidden />
              預約示範
            </Link>
          </Button>
          <Link
            href="/simulations"
            aria-label="前往模擬練習"
            className="flex h-11 w-11 items-center justify-center rounded-button border border-white/80 bg-white/90 text-accent-indigo shadow-[0_10px_28px_-14px_rgba(63,52,140,0.5)] transition-transform hover:-translate-y-0.5 dark:border-white/10 dark:bg-white/[0.08]"
          >
            <CalendarDays size={18} strokeWidth={1.8} aria-hidden />
          </Link>
        </div>
      </div>

      {/* Device composition -------------------------------------------- */}
      <div className="relative z-10 mx-auto mt-10 h-[560px] w-full max-w-6xl px-6 lg:h-[600px]">
        {/* Floating: persona state (top-left) */}
        <div className={`hero-float absolute left-[3%] top-[6%] z-20 w-56 p-4 ${CARD}`} style={{ animationDelay: '0.6s' }}>
          <p className="text-tiny text-text-tertiary">目前狀態</p>
          <p className="mt-0.5 text-body-sm font-semibold">客戶：有興趣</p>
          <div className="mt-3 space-y-2">
            <ScoreBar compact label="信任度" score={68} />
            <ScoreBar compact label="興趣" score={82} />
            <ScoreBar compact label="抗拒" score={31} />
          </div>
        </div>

        {/* Floating: compliance stats (top-right) */}
        <div className={`hero-float absolute right-[3%] top-[4%] z-20 w-64 p-4 ${CARD}`} style={{ animationDelay: '1.8s' }}>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-body-sm font-semibold">
              <ShieldCheck size={14} strokeWidth={2} aria-hidden className="text-accent-indigo" />
              合規攔截
            </p>
            <span className="text-tiny text-text-tertiary">最近 7 天</span>
          </div>
          <div className="mt-3 divide-y divide-border-soft/70 text-body-sm">
            <div className="flex items-center justify-between py-1.5"><span className="text-text-secondary">攔截禁止話術</span><span className="font-semibold tabular-nums">12</span></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-text-secondary">引用核准資料</span><span className="font-semibold tabular-nums">48</span></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-text-secondary">當下修正</span><span className="font-semibold tabular-nums">11</span></div>
          </div>
        </div>

        {/* Floating: voice player (bottom-left) */}
        <div className={`hero-float absolute bottom-[14%] left-[2%] z-20 flex w-72 items-center gap-3 p-3 ${CARD}`} style={{ animationDelay: '2.6s' }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-indigo/12 text-accent-indigo">
            <Mic size={15} strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-tiny font-medium">林佳穎 · 客戶回應</p>
            <Waveform bars={34} className="mt-1" />
          </div>
          <span className="text-tiny tabular-nums text-text-tertiary">0:12</span>
        </div>

        {/* Floating: citation (bottom-right) */}
        <div className={`hero-float absolute bottom-[10%] right-[4%] z-20 w-72 p-3.5 ${CARD}`} style={{ animationDelay: '1.2s' }}>
          <p className="flex items-center gap-1.5 text-tiny font-medium text-text-tertiary">
            <BookOpen size={13} strokeWidth={2} aria-hidden />
            來源 · 商品 SOP v3 §3.3
          </p>
          <p className="mt-1.5 text-body-sm text-text-secondary">團保是基礎，個人保單負責延續性——離職或退休時保障不會跟著消失。</p>
          <p className="mt-2 text-tiny text-text-tertiary">相似度 0.91 · 重排序 0.96</p>
        </div>

        {/* Floating: integrations */}
        <AppTile icon={<MessageCircle size={22} strokeWidth={1.8} />} tint="#06C755" className="left-[22%] top-[54%]" delay="0.3s" />
        <AppTile icon={<Users size={22} strokeWidth={1.8} />} tint="#5B5FC7" className="right-[20%] top-[46%]" delay="2.1s" />
        <AppTile icon={<Hash size={22} strokeWidth={1.8} />} tint="#E01E5A" className="right-[27%] top-[8%]" delay="1.5s" />
        <AppTile icon={<Briefcase size={22} strokeWidth={1.8} />} tint="#00A1E0" className="left-[27%] bottom-[6%]" delay="0.9s" />

        {/* Monitor */}
        <div className="absolute left-1/2 top-[8%] w-[min(760px,78%)] -translate-x-1/2">
          <div className="rounded-[22px] border border-white/80 bg-gradient-to-b from-white to-[#eef0f7] p-2.5 shadow-[0_40px_90px_-30px_rgba(63,52,140,0.45)] dark:border-white/10 dark:from-white/[0.10] dark:to-white/[0.04]">
            <div className="overflow-hidden rounded-[14px] border border-border-soft bg-[color:var(--glass-card-strong)]">
              {/* mini dashboard */}
              <div className="flex items-center gap-2 border-b border-border-soft px-4 py-2.5">
                <span className="h-5 w-5 rounded-md bg-accent-indigo" aria-hidden />
                <span className="text-tiny font-semibold">SkillCoach</span>
                <span className="ml-auto flex gap-1.5" aria-hidden>
                  <span className="h-2 w-2 rounded-full bg-border-soft" /><span className="h-2 w-2 rounded-full bg-border-soft" /><span className="h-2 w-2 rounded-full bg-border-soft" />
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3 p-4">
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ['技能總分', String(profile.overall_score), `本月 +${profile.monthly_improvement}`],
                      ['已完成練習', String(profile.completed_sessions), '三個情境'],
                      ['合規分數', String(profile.skills.compliance), '關卡型維度'],
                    ].map(([label, value, hint]) => (
                      <div key={label} className="rounded-card-sm border border-border-soft px-3 py-2">
                        <p className="text-[10px] text-text-tertiary">{label}</p>
                        <p className="text-[18px] font-semibold leading-tight tabular-nums">{value}</p>
                        <p className="text-[10px] text-text-tertiary">{hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-card-sm border border-border-soft px-3 py-2">
                    <p className="text-[10px] text-text-tertiary">分數趨勢 · 最新 {latest}</p>
                    <TrendLine
                      height={96}
                      points={DEMO_HISTORY_TREND.map((p) => ({ label: p.label, value: p.score }))}
                      ariaLabel="每月總分"
                      min={55}
                      max={95}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="rounded-card-sm border border-border-soft px-3 py-2">
                    <p className="text-[10px] text-text-tertiary">十項維度</p>
                    <div className="mt-1.5 space-y-1.5">
                      {(['needs_discovery', 'objection_handling', 'compliance', 'empathy'] as const).map((k) => (
                        <ScoreBar key={k} compact label={SKILL_LABEL[k]} score={profile.skills[k]} />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-card-sm border border-border-soft px-3 py-2">
                    <p className="text-[10px] text-text-tertiary">最近的練習</p>
                    <ul className="mt-1 space-y-1 text-[11px]">
                      {recent.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-text-secondary">{s.scenario_name.split('——')[0]}</span>
                          <span className="font-semibold tabular-nums" style={{ color: s.passed ? 'var(--success)' : 'var(--danger)' }}>{s.score}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* stand */}
          <div className="mx-auto h-16 w-24 bg-gradient-to-b from-[#dfe2ee] to-[#c9cddd] [clip-path:polygon(35%_0,65%_0,100%_100%,0_100%)] dark:from-white/[0.08] dark:to-white/[0.04]" aria-hidden />
          <div className="mx-auto h-2.5 w-64 rounded-full bg-gradient-to-b from-[#d6d9e6] to-[#f2f3f8] shadow-[0_20px_40px_-20px_rgba(63,52,140,0.5)] dark:from-white/[0.08] dark:to-transparent" aria-hidden />
        </div>

        {/* Phone */}
        <div className="absolute left-[16%] top-[30%] z-10 w-[176px] rounded-[30px] border border-white/80 bg-gradient-to-b from-white to-[#eef0f7] p-2 shadow-[0_30px_70px_-26px_rgba(63,52,140,0.5)] dark:border-white/10 dark:from-white/[0.10] dark:to-white/[0.04]">
          <div className="h-[330px] overflow-hidden rounded-[22px] border border-border-soft bg-[color:var(--glass-card-strong)] px-3 py-3 text-[11px]">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-border-soft" aria-hidden />
            <p className="text-[10px] font-semibold text-text-tertiary">語音模擬 · 林佳穎</p>
            <div className="mt-2 space-y-2">
              <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-accent-indigo/10 px-2.5 py-1.5 text-text-primary">你說的划算，是想問每個月要繳多少、還是之後領得回來多少？</div>
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-[color:color-mix(in_srgb,var(--text-primary)_6%,transparent)] px-2.5 py-1.5 text-text-primary">我先確認一下，你比較在意每月保費負擔，還是保障範圍？</div>
              <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-accent-indigo/10 px-2.5 py-1.5 text-text-primary">應該是保費吧，我怕每個月繳不起。</div>
              <div className="flex items-center gap-1.5 rounded-xl border border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_8%,transparent)] px-2.5 py-1.5 text-[10px] font-medium" style={{ color: 'color-mix(in srgb, var(--danger) 70%, var(--text-primary))' }}>
                <ShieldCheck size={11} strokeWidth={2} aria-hidden />
                合規提醒：不得保證理賠
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-full border border-border-soft px-2.5 py-1.5">
              <Mic size={11} strokeWidth={2} aria-hidden className="text-accent-indigo" />
              <Waveform bars={22} className="h-4 flex-1" />
            </div>
          </div>
        </div>
      </div>

      <div id="dashboard-overview-cue" className="pb-8" />
    </section>
  );
}
