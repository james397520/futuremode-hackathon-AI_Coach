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

  scenarioName: string;
  category?: string;
  industry?: string;
  trainingType?: string;
  difficulty: Difficulty;
  learningObjectives: string[];
  restrictedTopics?: string[];

  personaName: string;
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
    scenarioName,
    category,
    industry,
    trainingType,
    difficulty,
    learningObjectives,
    restrictedTopics,
    personaName,
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

  return (
    <aside
      className={cn('sim-scroll grid content-start gap-4 overflow-y-auto pb-4 pr-1', className)}
      aria-label="AI persona"
    >
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

      <PersonaStage
        personaName={personaName}
        subtitle={personaSubtitle}
        avatarUrl={personaAvatarUrl}
        speaking={speaking}
        listening={listening}
        thinking={thinking}
        waveform={waveform}
        onOpenProfile={onOpenProfile}
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

      <PersonaStateCard state={personaState} updating={personaStateUpdating} />

      <CoachCard
        mode={mode}
        insights={coachInsights}
        suppressedCount={suppressedCoachCount}
        startedAtMs={startedAtMs}
        onAskCoach={onAskCoach}
      />

      <StateTimeline
        markers={timelineMarkers}
        history={personaHistory}
        current={personaState}
        startedAtMs={startedAtMs}
        elapsedMs={elapsedMs}
      />
    </aside>
  );
}
