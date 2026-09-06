'use client';

/**
 * Session completion — spec §29 (Part I).
 *
 * Overall Score · Goal Achievement · Key Strength · Main Improvement ·
 * Compliance Status · Recommended Next Training, then the buttons
 * Full Report / Replay / Retry / Compare / Share / Export PDF.
 *
 * The evaluation is produced server-side and may still be in flight when the
 * session ends, so this component renders a calm "scoring" state instead of
 * blank space or an error (§94).
 */
import type { ReactNode } from 'react';
import type { Evaluation, SkillKey } from '@ai-coach/shared';

import { formatScore } from '../lib/format';
import { COMPLIANCE_RISK_LABEL, COMPLIANCE_RISK_TONE, SKILL_LABEL } from '../lib/labels';
import { insetSurface, toneText } from '../lib/tone';
import type { LiveScore } from '../lib/types';
import { CardTitle, InsetBlock, Meter, TonePill } from './atoms';
import {
  CheckIcon,
  CompareIcon,
  DownloadIcon,
  RestartIcon,
  ReportIcon,
  ShareIcon,
  ShieldIcon,
  SparkleIcon,
  PlayIcon,
} from './icons';
import { cn, GlassCard, Skeleton } from './kit';

export interface SessionCompleteSummaryProps {
  evaluation: Evaluation | null;
  loading: boolean;
  scenarioName: string;
  personaName: string;
  /** Fallback while the evaluation is still being produced. */
  liveScores: Partial<Record<SkillKey, LiveScore>>;
  recommendedNextTraining?: { name: string; reason: string };
  minimumScore?: number;
  onFullReport: () => void;
  onReplay: () => void;
  onRetry: () => void;
  onCompare: () => void;
  onShare: () => void;
  onExportPdf: () => void;
  className?: string;
}

function ActionButton({
  label,
  icon,
  onClick,
  primary = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  if (primary) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="sim-focusable sim-lift flex items-center gap-2 rounded-input px-4 py-2.5 text-body font-medium"
        style={{
          background: 'var(--action-dark)',
          color: 'var(--text-on-accent)',
        }}
      >
        {icon}
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="sim-focusable sim-lift flex items-center gap-2 rounded-input px-4 py-2.5 text-body text-text-secondary"
      style={insetSurface('neutral', 9)}
    >
      {icon}
      {label}
    </button>
  );
}

export function SessionCompleteSummary({
  evaluation,
  loading,
  scenarioName,
  personaName,
  liveScores,
  recommendedNextTraining,
  minimumScore,
  onFullReport,
  onReplay,
  onRetry,
  onCompare,
  onShare,
  onExportPdf,
  className,
}: SessionCompleteSummaryProps) {
  const overall = evaluation?.overall_score ?? null;
  const passed = evaluation?.passed ?? null;
  const riskTone = evaluation ? (COMPLIANCE_RISK_TONE[evaluation.compliance_status] ?? 'neutral') : 'neutral';

  const fallbackScores = Object.values(liveScores).filter(
    (score): score is LiveScore => Boolean(score),
  );

  return (
    <GlassCard className={cn('sim-card-enter p-6', className)}>
      <CardTitle
        eyebrow="練習完成"
        action={
          evaluation ? (
            <TonePill tone={passed ? 'mint' : 'warning'} fill={17}>
              {passed ? '通過' : '再練一次會更好'}
            </TonePill>
          ) : null
        }
      >
        {scenarioName}
      </CardTitle>

      <p className="mt-1 text-meta text-text-tertiary">與 {personaName} 的模擬對話</p>

      {/* Headline ----------------------------------------------------------- */}
      <div className="mt-5 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
        <div
          className="flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-card border"
          style={insetSurface(passed === false ? 'warning' : 'indigo', 12)}
        >
          {overall === null ? (
            <Skeleton className="h-10 w-16 rounded-card-sm" />
          ) : (
            <span
              className="text-display tabular-nums"
              style={{ color: toneText(passed === false ? 'warning' : 'indigo') }}
            >
              {formatScore(overall)}
            </span>
          )}
          <span className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">總分</span>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {evaluation ? (
              <>
                <TonePill
                  tone={evaluation.goal_achieved ? 'mint' : 'warning'}
                  fill={16}
                  icon={<CheckIcon size={11} />}
                >
                  {evaluation.goal_achieved ? '目標達成' : '目標未達成'}
                </TonePill>
                <TonePill tone={riskTone} fill={16} icon={<ShieldIcon size={11} />}>
                  合規 · {COMPLIANCE_RISK_LABEL[evaluation.compliance_status] ?? evaluation.compliance_status}
                </TonePill>
                {typeof minimumScore === 'number' ? (
                  <span className="text-tiny text-text-tertiary">及格 {minimumScore} 分</span>
                ) : null}
              </>
            ) : (
              <span className="flex items-center gap-2 text-body-sm text-text-secondary">
                <SparkleIcon size={13} />
                {loading ? '正在為這場練習評分…' : '評分結果稍後會出現在這裡。'}
              </span>
            )}
          </div>

          {evaluation ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <InsetBlock tone="mint" fill={9}>
                <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
                  主要優勢
                </div>
                <p className="mt-1.5 text-body-sm text-text-secondary">{evaluation.key_strength}</p>
              </InsetBlock>
              <InsetBlock tone="warning" fill={9}>
                <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
                  首要改進
                </div>
                <p className="mt-1.5 text-body-sm text-text-secondary">{evaluation.main_improvement}</p>
              </InsetBlock>
            </div>
          ) : (
            <div className="grid gap-2">
              <Skeleton className="h-3 w-full rounded-pill" />
              <Skeleton className="h-3 w-4/5 rounded-pill" />
            </div>
          )}
        </div>
      </div>

      {/* Skills ------------------------------------------------------------- */}
      <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
          {evaluation ? '各項技能' : '本場練習的即時分數'}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {evaluation
            ? evaluation.skills.map((skill) => (
                <Meter
                  key={skill.skill}
                  label={SKILL_LABEL[skill.skill as SkillKey] ?? String(skill.skill)}
                  value={skill.score}
                  tone={skill.score >= 80 ? 'mint' : skill.score >= 60 ? 'blue' : 'warning'}
                  hint={`信心 ${Math.round(skill.confidence * 100)}%`}
                />
              ))
            : fallbackScores.map((score) => (
                <Meter
                  key={score.skill}
                  label={SKILL_LABEL[score.skill] ?? score.skill}
                  value={score.score}
                  tone={score.score >= 80 ? 'mint' : score.score >= 60 ? 'blue' : 'warning'}
                />
              ))}
          {!evaluation && fallbackScores.length === 0 ? (
            <p className="text-body-sm text-text-tertiary">這場練習沒有記錄到即時分數。</p>
          ) : null}
        </div>
      </div>

      {/* Recommendation ----------------------------------------------------- */}
      {recommendedNextTraining ? (
        <InsetBlock tone="indigo" fill={10} className="mt-5">
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
            建議的下一場訓練
          </div>
          <p className="mt-1.5 text-body font-medium text-text-primary">
            {recommendedNextTraining.name}
          </p>
          <p className="mt-1 text-body-sm text-text-secondary">{recommendedNextTraining.reason}</p>
        </InsetBlock>
      ) : null}

      {/* Actions ------------------------------------------------------------ */}
      <div className="mt-6 flex flex-wrap gap-2.5">
        <ActionButton label="完整報告" icon={<ReportIcon size={16} />} onClick={onFullReport} primary />
        <ActionButton label="重播" icon={<PlayIcon size={16} />} onClick={onReplay} />
        <ActionButton label="再練一次" icon={<RestartIcon size={16} />} onClick={onRetry} />
        <ActionButton label="比較" icon={<CompareIcon size={16} />} onClick={onCompare} />
        <ActionButton label="分享" icon={<ShareIcon size={16} />} onClick={onShare} />
        <ActionButton label="匯出逐字稿" icon={<DownloadIcon size={16} />} onClick={onExportPdf} />
      </div>
    </GlassCard>
  );
}
