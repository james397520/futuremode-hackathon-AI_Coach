/**
 * Local view models. These are *derived* shapes only — every field that describes
 * the simulation itself comes from `@ai-coach/shared` (consume, never modify).
 */
import type {
  Citation,
  Difficulty,
  Evaluation,
  ID,
  PersonaEmotion,
  PersonaSimulationState,
  ScenarioPhase,
  SessionMode,
  SkillKey,
} from '@ai-coach/shared';

/** Everything the page needs before the socket opens (REST bootstrap or mock fixture). */
export interface SessionBootstrap {
  sessionId: ID;
  mode: SessionMode;
  runtime: 'webgpu' | 'wasm' | 'server';
  voiceEnabled: boolean;
  scoreLiveEnabled: boolean;
  startedAtMs: number;
  turnCount: number;
  scenario: {
    id: ID;
    name: string;
    version: number;
    category?: string;
    industry?: string;
    trainingType?: string;
    difficulty: Difficulty;
    openingContext: string;
    learningObjectives: string[];
    requiredTalkingPoints: string[];
    keyObjections: string[];
    restrictedTopics: string[];
    successCondition: string;
    timeLimitSeconds?: number;
    maxTurns?: number;
    minimumScore?: number;
  };
  persona: {
    id: ID;
    name: string;
    version: number;
    age?: number;
    occupation?: string;
    background?: string;
    subtitle?: string;
    avatarUrl?: string;
    traitSummary: string[];
    language: string;
  };
}

/** §31 / §40 timeline markers. */
export type TimelineMarkerKind =
  | 'state_transition'
  | 'key_response'
  | 'missed_signal'
  | 'compliance_warning'
  | 'score_event'
  | 'phase_change';

export interface TimelineMarker {
  id: string;
  kind: TimelineMarkerKind;
  atMs: number;
  label: string;
  detail?: string;
  emotion?: PersonaEmotion;
  phase?: ScenarioPhase;
}

export interface LiveScore {
  skill: SkillKey;
  score: number;
  confidence: number;
  atMs: number;
}

export interface PersonaStateSnapshot {
  atMs: number;
  state: PersonaSimulationState;
}

/** Pending citations that arrived before (or after) their transcript turn. */
export type CitationsByTurn = Record<ID, Citation[]>;

export interface RuntimeStatus {
  backend: 'webgpu' | 'wasm' | 'server';
  fallbackFrom?: string;
  fallbackReason?: string;
  degraded: boolean;
}

export interface ConnectionStatus {
  online: boolean;
  reconnectAttempt: number;
  lastSeq: number;
  droppedEvents: number;
  lastEventAtMs: number;
}

export interface SessionErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
}

/** §22.2 voice connection states. */
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'reconnecting'
  | 'ended';

export type MicPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface SessionSummaryView {
  evaluation: Evaluation | null;
  recommendedNextTraining?: { scenarioId?: ID; name: string; reason: string };
}
