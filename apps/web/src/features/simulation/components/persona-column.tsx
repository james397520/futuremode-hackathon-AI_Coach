'use client';

/**
 * The right-hand persona column — spec §14.1, §20–§23, §91.
 *
 * A stack of *floating* cards (not a panel): each card enters with the §43
 * translateX 12 → 0 motion, lifts 1px on hover, and the column is allowed to
 * overflow the container by 8–16px on large screens (see `TrainingGrid`) to get
 * the reference layout's floating depth.
 *
 * Order follows §14.1 / §91: Scenario → Persona stage → Objective → Live state
 * → Coach → Timeline.
 */
import type { ReactNode } from 'react';
import type {
  CoachInsight,
  Difficulty,
  PersonaSimulationState,
  ScenarioPhase,
  SessionMode,
  TranscriptTurn,
} from '@ai-coach/shared';

import type { AvatarBodyGender } from '@/features/avatar';

import type { PersonaStateSnapshot, TimelineMarker } from '../lib/types';
import { CoachCard } from './coach-card';
import { cn } from './kit';
import { PersonaObjectiveCard } from './persona-objective-card';
import { PersonaStage } from './persona-stage';
import { PersonaStateCard } from './persona-state-card';
import { ScenarioCard } from './scenario-card';
import { StateTimeline } from './state-timeline';

export interface PersonaColumnProps {
  mode: SessionMode;

  /** Training session id — scopes the Avatar Runtime session on the persona stage. */
  sessionId?: string;
  /** Timestamp of the last trainee barge-in; each increase interrupts the avatar (§44). */
  bargeInAtMs?: number;

  scenarioName: string;
  category?: string;
  industry?: string;
  trainingType?: string;
  difficulty: Difficulty;
  learningObjectives: string[];
  restrictedTopics?: string[];

  personaName: string;
  personaGender?: AvatarBodyGender;
  personaAge?: number | null;
  personaSubtitle?: string;
  personaAvatarUrl?: string;

  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  waveform?: ReactNode;
  onOpenProfile?: () => void;

  requiredTalkingPoints: string[];
  keyObjections: string[];
  successCondition: string;
  timeLimitSeconds?: number;
  remainingMs: number | null;
  overtime: boolean;
  scenarioPhase?: ScenarioPhase;
  turns: TranscriptTurn[];

  /**
   * `stage-fill`: the virtual human *is* the column — it fills the panel and the
   * context cards float over its lower-left as translucent glass, rather than
   * sitting in a scrolling stack beside it. `sidebar` is the original layout.
   */
  layout?: 'sidebar' | 'stage-fill';
  /** Trainee webcam picture, floated over the stage. Only used by `stage-fill`. */
  selfView?: ReactNode;
  personaState: PersonaSimulationState | null;
  personaStateUpdating: boolean;
  personaHistory: PersonaStateSnapshot[];
  timelineMarkers: TimelineMarker[];
  startedAtMs: number | null;
  elapsedMs: number;

  coachInsights: CoachInsight[];
  suppressedCoachCount: number;
  /** Training Mode only — absent for assessments so the control cannot exist. */
  onAskCoach?: () => void;

  className?: string;
}

export function PersonaColumn(props: PersonaColumnProps) {
  const {
    mode,
    sessionId,
    bargeInAtMs,
    scenarioName,
    category,
    industry,
    trainingType,
    difficulty,
    learningObjectives,
    restrictedTopics,
    personaName,
    personaGender,
    personaAge,
    personaSubtitle,
    personaAvatarUrl,
    speaking,
    listening,
    thinking,
    waveform,
    onOpenProfile,
    requiredTalkingPoints,
    keyObjections,
    successCondition,
    timeLimitSeconds,
    remainingMs,
    overtime,
    scenarioPhase,
    turns,
    layout = 'sidebar',
    selfView,
    personaState,
    personaStateUpdating,
    personaHistory,
    timelineMarkers,
    startedAtMs,
    elapsedMs,
    coachInsights,
    suppressedCoachCount,
    onAskCoach,
    className,
  } = props;

  const stage = (
    <PersonaStage
      personaName={personaName}
      personaGender={personaGender}
      personaAge={personaAge}
      subtitle={personaSubtitle}
      avatarUrl={personaAvatarUrl}
      speaking={speaking}
      listening={listening}
      thinking={thinking}
      waveform={waveform}
      onOpenProfile={onOpenProfile}
      // The avatar reads the same persona state the cards below render (§20).
      personaState={personaState}
      sessionId={sessionId}
      bargeInAtMs={bargeInAtMs}
      fill={layout === 'stage-fill'}
      className={layout === 'stage-fill' ? 'h-full min-h-0' : undefined}
    />
  );

  const cards = (
    <>
      <PersonaStateCard state={personaState} updating={personaStateUpdating} />

      <CoachCard
        mode={mode}
        insights={coachInsights}
        suppressedCount={suppressedCoachCount}
        startedAtMs={startedAtMs}
        onAskCoach={onAskCoach}
      />

      <ScenarioCard
        scenarioName={scenarioName}
        category={category}
        industry={industry}
        trainingType={trainingType}
        difficulty={difficulty}
        mode={mode}
        learningObjectives={learningObjectives}
        restrictedTopics={restrictedTopics}
      />

      <PersonaObjectiveCard
        requiredTalkingPoints={requiredTalkingPoints}
        keyObjections={keyObjections}
        successCondition={successCondition}
        timeLimitSeconds={timeLimitSeconds}
        remainingMs={remainingMs}
        overtime={overtime}
        scenarioPhase={scenarioPhase}
        turns={turns}
      />

      <StateTimeline
        markers={timelineMarkers}
        history={personaHistory}
        current={personaState}
        startedAtMs={startedAtMs}
        elapsedMs={elapsedMs}
      />
    </>
  );

  if (layout === 'stage-fill') {
    return (
      <section
        className={cn('relative h-full min-h-0 overflow-hidden', className)}
        aria-label="AI 模擬人物"
      >
        {stage}
        {selfView}

        {/*
          The context stack is a flat strip along the bottom of the stage, as wide
          as the stage itself: bottom-aligned, two columns, capped at 36% of the
          stage height with its own scrollbar, so it never climbs past the chest. Two columns rather than one is what buys the height
          back — shrinking the cards alone still stacked five of them past the
          shoulders.

          `sim-stage-overlay` turns each child into its own pane of glass and
          tightens their padding for this denser layout.
        */}
        {/* Full-height wrapper, bottom-aligned: the stack's `max-h` is a
            percentage, and against an auto-height `bottom-0` box it resolves to
            nothing — so the cards would grow until they covered the face.

            `pb-14` is not cosmetic spacing: the stage's own status chip
            (說話中／聆聽中／待命中) and the waveform sit in an `inset-x-0 bottom-0
            p-4` strip up to 48 px tall, and without this the bottom card was
            painted over 「待命中」. */}
        <div className="sim-stage-overlay-host pointer-events-none absolute inset-0 z-10 flex items-end p-3 pb-11">
          <div className="sim-stage-overlay pointer-events-auto grid max-h-[38%] w-full grid-cols-1 items-end gap-2 sm:grid-cols-2 [&>*]:sim-scroll [&>*]:max-h-full [&>*]:overflow-y-auto">
            {cards}
          </div>
        </div>
      </section>
    );
  }

  return (
    <aside
      className={cn(
        'sim-scroll grid h-full min-h-0 content-start gap-4 overflow-y-auto overflow-x-hidden pb-4 pr-1',
        className,
      )}
      aria-label="AI 模擬人物"
    >
      {stage}
      {cards}
    </aside>
  );
}
