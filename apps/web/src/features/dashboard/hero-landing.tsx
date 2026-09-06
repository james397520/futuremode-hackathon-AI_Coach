'use client';

/**
 * 首頁 hero — 參考「大字標題 ＋ 居中 3D 主體 ＋ 漂浮元素 ＋ 右側大數字 ＋ 底部像素字」
 * 的著陸頁構圖，換成 SkillCoach 的紫色玻璃語言：主體是真正的 3D 虛擬人（AvatarStage），
 * 漂浮的是產品裡真的會出現的三種卡片（合規攔截、知識庫引用、情緒提示），像素字用 5×7
 * 點陣自己畫、不依賴外部字型。整個區塊佔一個視窗高度，底下才是原本的訓練總覽。
 */
import Link from 'next/link';
import { ArrowRight, Mouse, Play, ShieldAlert, BookOpen, Smile } from 'lucide-react';
import { Button } from '@/components/ui';
import { AvatarStage } from '@/features/avatar/components/avatar-stage';
import { DEMO_HISTORY_JOURNEYS, DEMO_HISTORY_PROFILE, DEMO_HISTORY_TREND } from '@/lib/fixtures/demo-history';

// ---------------------------------------------------------------------------
// Pixel type — 5×7 bitmaps for the letters we need. No web font, no network.
// ---------------------------------------------------------------------------
const GLYPHS: Record<string, string[]> = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
};

function PixelWord({ word, px = 14, className = '' }: { word: string; px?: number; className?: string }) {
  return (
    <div className={`flex select-none items-end gap-[calc(var(--px)*0.9)] ${className}`} style={{ ['--px' as string]: `${px}px` }} aria-hidden>
      {word.split('').map((ch, i) => {
        const rows = GLYPHS[ch] ?? GLYPHS.O!;
        return (
          <div key={`${ch}${i}`} className="grid" style={{ gridTemplateColumns: 'repeat(5, var(--px))', gridAutoRows: 'var(--px)' }}>
            {rows.flatMap((row, r) =>
              row.split('').map((bit, c) => (
                <span
                  key={`${r}-${c}`}
                  className="block"
                  style={{
                    background: bit === '1' ? 'color-mix(in srgb, var(--accent-indigo) 34%, white)' : 'transparent',
                    boxShadow: bit === '1' ? '0 1px 0 color-mix(in srgb, var(--accent-indigo) 30%, transparent)' : 'none',
                  }}
                />
              )),
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating product chips — the three signals the demo shows for real.
// ---------------------------------------------------------------------------
function FloatChip({
  icon,
  text,
  tone,
  className,
  delay = '0s',
}: {
  icon: React.ReactNode;
  text: string;
  tone: 'danger' | 'indigo' | 'warning';
  className: string;
  delay?: string;
}) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warning' ? 'var(--warning)' : 'var(--accent-indigo)';
  return (
    <div
      className={`hero-float pointer-events-none absolute z-20 flex items-center gap-2 rounded-pill border px-3 py-1.5 text-tiny font-medium shadow-soft backdrop-blur-card ${className}`}
      style={{
        animationDelay: delay,
        borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
        background: `color-mix(in srgb, ${color} 12%, var(--glass-card))`,
        color: `color-mix(in srgb, ${color} 70%, var(--text-primary))`,
      }}
    >
      {icon}
      {text}
    </div>
  );
}

export function HeroLanding() {
  const latest = DEMO_HISTORY_TREND[DEMO_HISTORY_TREND.length - 1]?.score ?? DEMO_HISTORY_PROFILE.overall_score;
  const first = DEMO_HISTORY_TREND[0]?.score ?? latest;
  const growth = latest - first;

  return (
    <section
      className="relative min-h-[calc(100dvh-7.75rem)] overflow-hidden rounded-shell border border-border-soft"
      aria-label="SkillCoach 首頁"
      style={{
        background:
          'radial-gradient(60% 70% at 50% 40%, color-mix(in srgb, var(--accent-indigo) 30%, transparent), transparent 70%), ' +
          'radial-gradient(40% 50% at 12% 85%, color-mix(in srgb, var(--accent-violet) 26%, transparent), transparent 70%), ' +
          'radial-gradient(35% 45% at 88% 20%, color-mix(in srgb, var(--accent-blue) 22%, transparent), transparent 70%), ' +
          'var(--glass-card)',
      }}
    >
      <div className="dot-matrix pointer-events-none absolute inset-y-0 left-0 w-1/2 opacity-60" aria-hidden />

      {/* Giant pixel words — behind the figure, like the reference's brand mark. */}
      <PixelWord word="SKILL" px={15} className="absolute bottom-[26%] left-6 z-0 opacity-90 lg:bottom-[24%] lg:left-10" />
      <PixelWord word="COACH" px={15} className="absolute bottom-6 right-6 z-0 opacity-90 lg:right-10" />

      <div className="relative z-10 grid h-full min-h-[calc(100dvh-7.75rem)] grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,0.8fr)] lg:p-10">
        {/* Left — headline + copy + CTAs */}
        <div className="flex flex-col justify-between">
          <div>
            <p className="font-mono text-tiny tracking-[0.18em] text-text-tertiary">[ 1 / 3 ]</p>
            <h1 className="mt-5 text-[clamp(2.4rem,4.6vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-text-primary">
              <span className="block pl-[1.2em]">打造</span>
              <span className="block">會回話的</span>
              <span className="block pl-[0.6em]">銷售訓練</span>
            </h1>
          </div>
          <div className="mt-10 max-w-md">
            <p className="text-body text-text-secondary">
              AI 客戶會反問、教練會提醒、合規會攔截。每一句對話都有逐字稿佐證，每一分都追得到來源。
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="primary" size="md" asChild>
                <Link href="/demo">
                  <Play size={15} strokeWidth={2} aria-hidden />
                  開始模擬
                </Link>
              </Button>
              <Button variant="secondary" size="md" asChild>
                <Link href="/performance">查看成效</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Centre — the virtual human, with product signals floating around it */}
        <div className="relative flex min-h-[420px] items-end justify-center">
          <div
            className="pointer-events-none absolute inset-x-8 bottom-4 top-6 -z-10 rounded-[40%] opacity-90 blur-3xl"
            aria-hidden
            style={{ background: 'radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--accent-indigo) 55%, transparent), transparent 70%)' }}
          />
          <div className="relative h-[min(62vh,560px)] w-full max-w-[440px] [mask-image:radial-gradient(ellipse_62%_58%_at_50%_48%,black_52%,transparent_100%)]">
            <AvatarStage
              personaName="林佳穎"
              personaGender="female"
              personaAge={29}
              personaState={null}
              speaking={false}
              listening={false}
              thinking={false}
              surface="bare"
              showBadge={false}
              className="h-full w-full"
            />
          </div>
          <FloatChip
            icon={<ShieldAlert size={13} strokeWidth={2} aria-hidden />}
            text="不實承諾 · 已即時攔截"
            tone="danger"
            className="left-0 top-[14%]"
          />
          <FloatChip
            icon={<BookOpen size={13} strokeWidth={2} aria-hidden />}
            text="來源 · 商品 SOP v3 §3.3"
            tone="indigo"
            className="right-0 top-[30%]"
            delay="1.4s"
          />
          <FloatChip
            icon={<Smile size={13} strokeWidth={2} aria-hidden />}
            text="偵測到苦惱 → 提供協助"
            tone="warning"
            className="left-2 top-[58%]"
            delay="2.8s"
          />
        </div>

        {/* Right — headline number + the three demos */}
        <div className="flex flex-col justify-between">
          <div className="text-right">
            <p className="flex items-baseline justify-end gap-3">
              <span className="text-[clamp(2.6rem,4.2vw,3.8rem)] font-semibold leading-none tabular-nums tracking-tight">
                {growth >= 0 ? '+' : ''}{growth}
              </span>
              <span className="text-body-sm font-semibold uppercase tracking-[0.14em] text-text-tertiary">總分成長</span>
            </p>
            <p className="mt-3 text-body-sm text-text-secondary">
              三個示範情境累計 {DEMO_HISTORY_PROFILE.completed_sessions} 場練習，總分由 {first} 進步到 {latest}。
            </p>
          </div>

          <ul className="mt-8 flex flex-col gap-2 self-end">
            {DEMO_HISTORY_JOURNEYS.map((journey, i) => (
              <li key={journey.scenario_id}>
                <Link
                  href={journey.href}
                  className="group flex items-center gap-3 rounded-card border border-border-soft bg-glass-card px-3.5 py-2.5 text-body-sm backdrop-blur-card transition-transform hover:-translate-y-0.5"
                >
                  <span className="font-mono text-tiny text-text-tertiary">0{i + 1}</span>
                  <span className="max-w-[16rem] truncate">{journey.scenario_name}</span>
                  <ArrowRight size={14} strokeWidth={2} aria-hidden className="ml-auto text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-8 max-w-xs self-end text-right text-body-sm text-text-secondary">
            從第一句開場到成交收尾——一場練習，一份有憑有據的成長紀錄。
          </p>
        </div>
      </div>

      {/* Scroll cue */}
      <a
        href="#dashboard-overview"
        className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1 rounded-pill border border-border-soft bg-glass-card px-4 py-2 text-tiny text-text-secondary backdrop-blur-card hover:text-text-primary"
      >
        <Mouse size={14} strokeWidth={1.8} aria-hidden className="hero-float" />
        往下探索訓練總覽
      </a>
    </section>
  );
}
