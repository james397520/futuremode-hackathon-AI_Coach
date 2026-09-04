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
import type { ScenarioPhase, TranscriptTurn } from '@ai-coach/shared-types';

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
        eyebrow="Objective progress"
        action={
          scenarioPhase ? (
            <TonePill tone="indigo" fill={15}>
              {PHASE_LABEL[scenarioPhase] ?? scenarioPhase}
            </TonePill>
          ) : null
        }
      >
        {progress.coveredCount} of {progress.totalCount} talking points
      </CardTitle>

      <div className="mt-4 grid gap-3">
        <Meter label="Toward objective" value={progress.overall} tone="indigo" />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-tiny text-text-tertiary">
          <span>Scenario phase {progress.phase}%</span>
          <span>Talking points {progress.coverage}%</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
          Required talking points
        </div>
        <ul className="mt-2 grid gap-1.5">
          {progress.points.length === 0 ? (
            <li className="text-body-sm text-text-tertiary">None required.</li>
          ) : (
            progress.points.map((entry) => (
              <Bullet key={entry.point} done={entry.covered}>
                {entry.point}
              </Bullet>
            ))
          )}
        </ul>
        <p className="mt-2 text-tiny text-text-tertiary">
          Ticks mean the phrase was detected in your transcript — not a score.
        </p>
      </div>

      {keyObjections.length > 0 ? (
        <div className="mt-4">
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
            Expected objections
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
          Success condition
        </div>
        <p className="mt-1.5 text-body-sm text-text-secondary">{successCondition}</p>
      </InsetBlock>

      {timeLimitSeconds ? (
        <div className="mt-4 flex items-center justify-between text-meta">
          <span className="flex items-center gap-1.5 text-text-tertiary">
            <ClockIcon size={13} />
            Time limit {formatTimer(timeLimitSeconds * 1000)}
          </span>
          <span
            className="tabular-nums"
            style={{ color: overtime ? toneText('warning') : 'var(--text-secondary)' }}
          >
            {remainingMs === null
              ? '—'
              : overtime
                ? `${formatTimer(Math.abs(remainingMs))} over`
                : `${formatTimer(remainingMs)} left`}
          </span>
        </div>
      ) : null}
    </GlassCard>
  );
}
