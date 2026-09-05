'use client';

/**
 * Objective detail card — spec §21.
 *
 * Required talking points (with detected-in-transcript ticks), key objections,
 * success condition, time limit and progress toward the objective.
 *
 * Honesty rule: the phase half of the progress bar is the server's
 * `scenario_phase`; the talking-point half is a transcript text heuristic and is
 * labelled as such. Neither is a score — scoring is the Evaluator agent's job.
 */
import { useMemo } from 'react';
import type { ScenarioPhase, TranscriptTurn } from '@ai-coach/shared';

import { formatTimer } from '../lib/format';
import { PHASE_LABEL } from '../lib/labels';
import { objectiveProgress } from '../lib/objective';
import { toneText } from '../lib/tone';
import { Bullet, CardTitle, InsetBlock, Meter, TonePill } from './atoms';
import { ClockIcon, ShieldIcon } from './icons';
import { cn, GlassCard } from './kit';

export interface PersonaObjectiveCardProps {
  requiredTalkingPoints: string[];
  keyObjections: string[];
  successCondition: string;
  timeLimitSeconds?: number;
  remainingMs: number | null;
  overtime: boolean;
  scenarioPhase?: ScenarioPhase;
  turns: TranscriptTurn[];
  className?: string;
}

export function PersonaObjectiveCard({
  requiredTalkingPoints,
  keyObjections,
  successCondition,
  timeLimitSeconds,
  remainingMs,
  overtime,
  scenarioPhase,
  turns,
  className,
}: PersonaObjectiveCardProps) {
  const progress = useMemo(
    () => objectiveProgress(scenarioPhase, requiredTalkingPoints, turns),
    [requiredTalkingPoints, scenarioPhase, turns],
  );

  return (
    <GlassCard className={cn('sim-float-in sim-lift p-5', className)}>
      <CardTitle
        eyebrow="目標達成進度"
        action={
          scenarioPhase ? (
            <TonePill tone="indigo" fill={15}>
              {PHASE_LABEL[scenarioPhase] ?? scenarioPhase}
            </TonePill>
          ) : null
        }
      >
        已提及 {progress.coveredCount} / {progress.totalCount} 個重點
      </CardTitle>

      <div className="mt-4 grid gap-3">
        <Meter label="目標達成度" value={progress.overall} tone="indigo" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-tiny text-text-tertiary">
          <span>情境進度 {progress.phase}%</span>
          <span>重點涵蓋率 {progress.coverage}%</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
          必須提及的重點
        </div>
        <ul className="mt-2 grid gap-1.5">
          {progress.points.length === 0 ? (
            <li className="text-body-sm text-text-tertiary">此情境沒有必須提及的重點。</li>
          ) : (
            progress.points.map((entry) => (
              <Bullet key={entry.point} done={entry.covered}>
                {entry.point}
              </Bullet>
            ))
          )}
        </ul>
        <p className="mt-2 text-tiny text-text-tertiary">
          打勾表示逐字稿中偵測到這句話——不代表分數。
        </p>
      </div>

      {keyObjections.length > 0 ? (
        <div className="mt-4">
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
            預期異議
          </div>
          <ul className="mt-2 grid gap-1.5">
            {keyObjections.map((objection) => (
              <Bullet key={objection} tone="warning">
                {objection}
              </Bullet>
            ))}
          </ul>
        </div>
      ) : null}

      <InsetBlock tone="mint" fill={9} className="mt-4">
        <div className="flex items-center gap-1.5 text-tiny uppercase tracking-[0.08em] text-text-tertiary">
          <ShieldIcon size={12} />
          通過條件
        </div>
        <p className="mt-1.5 text-body-sm text-text-secondary">{successCondition}</p>
      </InsetBlock>

      {timeLimitSeconds ? (
        <div className="mt-4 flex items-center justify-between text-meta">
          <span className="flex items-center gap-1.5 text-text-tertiary">
            <ClockIcon size={13} />
            時間限制 {formatTimer(timeLimitSeconds * 1000)}
          </span>
          <span
            className="tabular-nums"
            style={{ color: overtime ? toneText('warning') : 'var(--text-secondary)' }}
          >
            {remainingMs === null
              ? '—'
              : overtime
                ? `超時 ${formatTimer(Math.abs(remainingMs))}`
                : `剩餘 ${formatTimer(remainingMs)}`}
          </span>
        </div>
      ) : null}
    </GlassCard>
  );
}
