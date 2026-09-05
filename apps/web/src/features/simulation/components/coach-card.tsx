'use client';

/**
 * AI Coach card — spec §23 (Part II) with the reference "Notes & Key Points"
 * structure: a short summary paragraph, then `✦` key points, then the
 * `[ AI Coaching ]` footer with an indigo → blue → mint status pill.
 *
 * Assessment Mode (§8.4): this card renders a *locked* state instead of
 * content. Insights whose `allowed_in_assessment` is false never reach the
 * client store in the first place (see `reduceEvent`), so there is nothing to
 * reveal here — the lock is honest, not decorative. Insights explicitly marked
 * `allowed_in_assessment: true` (e.g. post-session notes) still show.
 */
import type { CoachInsight, SessionMode } from '@ai-coach/shared';

import { formatClock } from '../lib/format';
import { COACH_KIND_LABEL, COACH_KIND_TONE } from '../lib/labels';
import { insetSurface, toneText } from '../lib/tone';
import { CardTitle, TonePill } from './atoms';
import { LightbulbIcon, ShieldIcon, SparkleIcon } from './icons';
import { cn, GlassCard, GradientPill } from './kit';

export interface CoachCardProps {
  mode: SessionMode;
  insights: CoachInsight[];
  /** Count of coaching payloads the store dropped because this is an assessment. */
  suppressedCount: number;
  startedAtMs: number | null;
  /** Training only. Omitted for assessments so the control cannot be reached. */
  onAskCoach?: () => void;
  className?: string;
}

export function CoachCard({
  mode,
  insights,
  suppressedCount,
  startedAtMs,
  onAskCoach,
  className,
}: CoachCardProps) {
  const visible = insights.filter((insight) => mode !== 'assessment' || insight.allowed_in_assessment);
  const latest = visible.length > 0 ? visible[visible.length - 1] : undefined;
  const keyPoints = visible.slice(Math.max(0, visible.length - 4), visible.length - 1).reverse();

  // ---- Assessment: locked / deferred -------------------------------------
  if (mode === 'assessment' && visible.length === 0) {
    return (
      <GlassCard className={cn('sim-float-in p-5', className)}>
        <CardTitle eyebrow="AI 教練">教練提示已暫緩</CardTitle>
        <div
          className="mt-3 flex items-start gap-2.5 rounded-card-sm border p-3.5"
          style={insetSurface('indigo', 9)}
        >
          <ShieldIcon size={15} style={{ color: toneText('indigo') }} className="mt-[2px] shrink-0" />
          <p className="text-body-sm text-text-secondary">
            這是一場評測。為了讓分數反映你自己的表現，提示、建議回覆與即時教練都會保留。完整的教練報告會在練習結束時解鎖。
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <TonePill tone="indigo" fill={15} icon={<ShieldIcon size={11} />}>
            評測模式
          </TonePill>
          {suppressedCount > 0 ? (
            <span className="text-tiny text-text-tertiary">
              {suppressedCount} 則筆記將收錄於報告中
            </span>
          ) : null}
        </div>
      </GlassCard>
    );
  }

  // ---- Training (or an assessment-safe note) -----------------------------
  return (
    <GlassCard className={cn('sim-float-in sim-lift p-5', className)}>
      <CardTitle
        eyebrow="AI 教練"
        action={
          latest ? (
            <TonePill tone={COACH_KIND_TONE[latest.kind] ?? 'violet'} fill={15}>
              {COACH_KIND_LABEL[latest.kind] ?? '教練'}
            </TonePill>
          ) : null
        }
      >
        摘要
      </CardTitle>

      {latest ? (
        <>
          <p className="mt-3 text-body font-medium text-text-primary">{latest.title}</p>
          <p className="mt-1.5 text-body text-text-secondary">{latest.body}</p>
          <p className="mt-2 text-tiny tabular-nums text-text-tertiary">
            {formatClock(
              startedAtMs === null ? latest.timestamp_ms : Math.max(0, latest.timestamp_ms - startedAtMs),
            )}
          </p>
        </>
      ) : (
        <p className="mt-3 text-body text-text-secondary">
          教練正在觀察對話。筆記會隨著對話進展出現在這裡——卡關時也可以主動要求提示。
        </p>
      )}

      {keyPoints.length > 0 ? (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">重點筆記</div>
          <ul className="mt-2 grid gap-2">
            {keyPoints.map((insight) => (
              <li key={insight.id} className="flex items-start gap-2 text-body-sm text-text-secondary">
                <SparkleIcon
                  size={12}
                  className="mt-[3px] shrink-0"
                  style={{ color: toneText(COACH_KIND_TONE[insight.kind] ?? 'violet') }}
                />
                <span>{insight.title}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3">
        <GradientPill className="flex items-center gap-1.5 px-3 py-1 text-tiny">
          <SparkleIcon size={11} />
          AI 教練
        </GradientPill>
        {onAskCoach ? (
          <button
            type="button"
            onClick={onAskCoach}
            className="sim-focusable sim-lift flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-meta"
            style={insetSurface('violet', 13)}
          >
            <LightbulbIcon size={13} style={{ color: toneText('violet') }} />
            <span style={{ color: toneText('violet') }}>詢問教練</span>
          </button>
        ) : null}
      </div>
    </GlassCard>
  );
}
