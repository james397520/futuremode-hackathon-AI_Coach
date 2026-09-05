/**
 * Live Simulation client state — spec §48.4 (Zustand for session / persona / voice state).
 *
 * Two layers on purpose:
 *  1. `reduceEvent(state, event)` — a *pure*, deterministic reducer over the
 *     `StreamingEvent` union. No `Date.now()`, no randomness, no I/O, so it is
 *     directly unit-testable and replayable (§30 Conversation Replay reuses it).
 *  2. `useSessionStore` — the Zustand shell that owns actions and voice UI state.
 *
 * Invariants:
 *  - The session status only ever moves through `LEGAL_TRANSITIONS` (§92).
 *  - Persona state is *never* invented by the UI. It is only ever the payload of
 *    a `persona.state.updated` event (§20).
 *  - Assessment Mode drops coaching payloads at reduce time, so the data never
 *    reaches the component tree at all — gating is not a CSS concern (§8.4).
 *  - An unknown, duplicated or out-of-order event returns state unchanged. The
 *    reducer never throws (§62 / §94).
 */
import { create } from 'zustand';
import type {
  AgentName,
  Citation,
  CoachInsight,
  ComplianceFinding,
  Evaluation,
  ID,
  PersonaSimulationState,
  SessionMode,
  SessionState,
  SkillKey,
  StreamingEvent,
  TraineeAffect,
  TranscriptTurn,
} from '@ai-coach/shared';

import {
  COMPLIANCE_TYPE_LABEL,
  EMOTION_LABEL,
  PHASE_LABEL,
  SKILL_LABEL,
} from '../lib/labels';
import { transition } from '../lib/session-transitions';
import type {
  CitationsByTurn,
  ConnectionStatus,
  LiveScore,
  MicPermission,
  PersonaStateSnapshot,
  RuntimeStatus,
  SessionBootstrap,
  SessionErrorInfo,
  TimelineMarker,
  VoiceStatus,
} from '../lib/types';

const MAX_TIMELINE = 240;
const MAX_HISTORY = 240;
const MAX_INSIGHTS = 120;

// ---------------------------------------------------------------------------
// Data shape
// ---------------------------------------------------------------------------

export interface VoiceSliceState {
  status: VoiceStatus;
  muted: boolean;
  pushToTalkHeld: boolean;
  pushToTalkMode: boolean;
  captionsEnabled: boolean;
  /**
   * VAD is in the shared store because it flips a couple of times per turn.
   * The continuous input level and noise floor deliberately are NOT: they change
   * ~8×/s and live as local state inside `useVoiceSession`, so a level meter can
   * never cause a store-wide re-render of the transcript (§95).
   */
  vadActive: boolean;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  permission: MicPermission;
  lastError: string | null;
  bargeInCount: number;
}

export interface SimulationData {
  sessionId: ID;
  mode: SessionMode;
  status: SessionState;
  previousStatus: SessionState | null;
  bootstrap: SessionBootstrap | null;
  bootstrapError: string | null;
  loading: boolean;

  turns: TranscriptTurn[];
  /** turn_id → accumulated `agent.response.partial` deltas (§49.2 render immediately). */
  partials: Record<ID, string>;
  /** In-flight ASR / TTS text that has no turn yet. */
  speechPartial: { speaker: 'trainee' | 'persona'; text: string } | null;
  citationsByTurn: CitationsByTurn;
  /** Citations that arrived before their turn did. */
  pendingCitations: CitationsByTurn;

  personaState: PersonaSimulationState | null;
  /** Fused trainee affect (text + face). Null until the first turn reports one. */
  traineeAffect: TraineeAffect | null;
  personaHistory: PersonaStateSnapshot[];
  timeline: TimelineMarker[];

  coachInsights: CoachInsight[];
  /** Number of coaching payloads suppressed because this is an assessment (§8.4). */
  suppressedCoachCount: number;
  complianceFindings: ComplianceFinding[];
  liveScores: Partial<Record<SkillKey, LiveScore>>;
  scoreLiveEnabled: boolean;

  activeAgent: AgentName | null;
  agentActivityAtMs: number;

  runtime: RuntimeStatus;
  connection: ConnectionStatus;
  error: SessionErrorInfo | null;

  turnCount: number;
  startedAtMs: number | null;
  pausedAccumulatedMs: number;
  pausedAtMs: number | null;
  completedAtMs: number | null;
  evaluationId: ID | null;
  evaluation: Evaluation | null;

  voice: VoiceSliceState;
}

export const initialVoiceState: VoiceSliceState = {
  status: 'idle',
  muted: false,
  pushToTalkHeld: false,
  pushToTalkMode: false,
  captionsEnabled: true,
  vadActive: false,
  inputDeviceId: null,
  outputDeviceId: null,
  permission: 'unknown',
  lastError: null,
  bargeInCount: 0,
};

export function createInitialData(sessionId: ID, mode: SessionMode = 'training'): SimulationData {
  return {
    sessionId,
    mode,
    status: 'idle',
    previousStatus: null,
    bootstrap: null,
    bootstrapError: null,
    loading: true,

    turns: [],
    partials: {},
    speechPartial: null,
    citationsByTurn: {},
    pendingCitations: {},

    personaState: null,
    traineeAffect: null,
    personaHistory: [],
    timeline: [],

    coachInsights: [],
    suppressedCoachCount: 0,
    complianceFindings: [],
    liveScores: {},
    scoreLiveEnabled: true,

    activeAgent: null,
    agentActivityAtMs: 0,

    runtime: { backend: 'server', degraded: false },
    connection: {
      online: false,
      reconnectAttempt: 0,
      lastSeq: 0,
      droppedEvents: 0,
      lastEventAtMs: 0,
    },
    error: null,

    turnCount: 0,
    startedAtMs: null,
    pausedAccumulatedMs: 0,
    pausedAtMs: null,
    completedAtMs: null,
    evaluationId: null,
    evaluation: null,

    voice: { ...initialVoiceState },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export const LOCAL_TURN_PREFIX = 'local-';

function insertTurn(turns: TranscriptTurn[], turn: TranscriptTurn): TranscriptTurn[] {
  const existing = turns.findIndex((t) => t.id === turn.id);
  if (existing >= 0) {
    const next = turns.slice();
    next[existing] = turn;
    return next;
  }
  // Drop the optimistic local echo once the authoritative trainee turn lands.
  const withoutEcho =
    turn.speaker === 'trainee'
      ? turns.filter((t) => !(t.id.startsWith(LOCAL_TURN_PREFIX) && t.text.trim() === turn.text.trim()))
      : turns;

  const next = withoutEcho.slice();
  let index = next.length;
  while (index > 0) {
    const candidate = next[index - 1];
    if (!candidate || candidate.timestamp_ms <= turn.timestamp_ms) break;
    index -= 1;
  }
  next.splice(index, 0, turn);
  return next;
}

function pushCapped<T>(list: T[], item: T, max: number, dedupeKey?: (value: T) => string): T[] {
  /*
   * `marker()` ids are `${seq}-${kind}-${label}`. Two score events in the same
   * emit (e.g. a compound skill update) share `seq`, and same skill + same
   * rounded delta label collide, which handed React duplicate keys
   * ("Encountered two children with the same key") and let one silently
   * replace the other. Callers that carry a stable id opt in via `dedupeKey`;
   * `PersonaStateSnapshot` has none and keeps the old append-only behaviour.
   */
  if (dedupeKey) {
    const key = dedupeKey(item);
    if (list.some((existing) => dedupeKey(existing) === key)) return list;
  }
  const next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(item);
  return next;
}

function marker(
  event: StreamingEvent,
  kind: TimelineMarker['kind'],
  label: string,
  extra?: Partial<TimelineMarker>,
): TimelineMarker {
  return {
    id: `${event.seq}-${kind}-${label}`,
    kind,
    atMs: event.at_ms,
    label,
    ...extra,
  };
}

/** Merge citations into the turn object so `TranscriptTurn` stays the single source. */
function attachCitations(
  turns: TranscriptTurn[],
  turnId: ID,
  citations: Citation[],
): TranscriptTurn[] {
  const index = turns.findIndex((t) => t.id === turnId);
  if (index < 0) return turns;
  const target = turns[index];
  if (!target) return turns;
  const next = turns.slice();
  next[index] = { ...target, citations };
  return next;
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * Pure reduction of one streaming event. Safe to call with events in any order,
 * repeated events, or (at runtime) an event type this build does not know about.
 */
export function reduceEvent(state: SimulationData, event: StreamingEvent): SimulationData {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') return state;

  // Events for another session must never leak into this store.
  if (event.session_id && state.sessionId && event.session_id !== state.sessionId) return state;

  const seq = typeof event.seq === 'number' ? event.seq : 0;

  // A `session.started` restarts the server's sequence (a restart, or a fresh
  // stream after a remount), so it must never be judged stale against the old
  // high-water mark — otherwise every following event would be ignored.
  const resetsSequence = event.type === 'session.started';
  const stale = !resetsSequence && seq > 0 && seq <= state.connection.lastSeq;
  const gap =
    !resetsSequence && seq > 0 && state.connection.lastSeq > 0 && seq > state.connection.lastSeq + 1
      ? seq - state.connection.lastSeq - 1
      : 0;

  const connection: ConnectionStatus = {
    ...state.connection,
    online: true,
    lastSeq: resetsSequence ? seq : Math.max(state.connection.lastSeq, seq),
    droppedEvents: state.connection.droppedEvents + gap,
    lastEventAtMs: Math.max(state.connection.lastEventAtMs, event.at_ms || 0),
  };

  /** Apply a state-machine move, ignoring it for stale events. */
  const move = (to: SessionState): { status: SessionState; previousStatus: SessionState | null } => {
    if (stale) return { status: state.status, previousStatus: state.previousStatus };
    const next = transition(state.status, to);
    return next === state.status
      ? { status: state.status, previousStatus: state.previousStatus }
      : { status: next, previousStatus: state.status };
  };

  const base = { ...state, connection };

  switch (event.type) {
    case 'session.started': {
      const requested = event.state ?? 'ready';
      return {
        ...base,
        ...move(requested === 'idle' ? 'ready' : requested),
        error: null,
        startedAtMs: state.startedAtMs ?? event.at_ms,
        completedAtMs: null,
        connection: { ...connection, reconnectAttempt: 0 },
      };
    }

    case 'session.paused': {
      if (stale || state.status === 'paused') return base;
      return {
        ...base,
        ...move('paused'),
        pausedAtMs: event.at_ms,
        speechPartial: null,
      };
    }

    case 'session.resumed': {
      const pausedFor = state.pausedAtMs ? Math.max(0, event.at_ms - state.pausedAtMs) : 0;
      return {
        ...base,
        ...move('listening'),
        pausedAtMs: null,
        pausedAccumulatedMs: state.pausedAccumulatedMs + pausedFor,
      };
    }

    case 'session.completed': {
      return {
        ...base,
        ...move('completed'),
        completedAtMs: event.at_ms,
        speechPartial: null,
        partials: {},
        activeAgent: null,
        evaluationId: event.evaluation_id ?? state.evaluationId,
      };
    }

    case 'speech.started': {
      const next = event.speaker === 'persona' ? 'persona_speaking' : 'listening';
      return { ...base, ...move(next), speechPartial: null };
    }

    case 'speech.partial': {
      // Render partial ASR immediately — never wait for a full sentence (§49.2).
      const next = event.speaker === 'persona' ? 'persona_speaking' : 'transcribing';
      return {
        ...base,
        ...move(next),
        speechPartial: { speaker: event.speaker, text: event.text },
      };
    }

    case 'speech.final': {
      const turn = event.turn;
      if (!turn || typeof turn.id !== 'string') return base;
      const turns = insertTurn(base.turns, applyPending(turn, state.pendingCitations));
      const pending = clearPending(state.pendingCitations, turn.id);
      const isTrainee = turn.speaker === 'trainee';
      return {
        ...base,
        ...(isTrainee ? move('processing') : move('listening')),
        turns,
        pendingCitations: pending,
        citationsByTurn: turn.citations?.length
          ? { ...base.citationsByTurn, [turn.id]: turn.citations }
          : base.citationsByTurn,
        speechPartial: null,
        turnCount: turns.length,
        timeline: keyResponseMarker(base.timeline, event, turn),
      };
    }

    case 'agent.thinking': {
      return {
        ...base,
        ...move('processing'),
        activeAgent: event.agent,
        agentActivityAtMs: event.at_ms,
      };
    }

    case 'agent.response.partial': {
      // Incremental LLM output — appended, never buffered until the sentence ends.
      const current = base.partials[event.turn_id] ?? '';
      return {
        ...base,
        ...move('persona_speaking'),
        partials: { ...base.partials, [event.turn_id]: current + (event.delta ?? '') },
      };
    }

    case 'agent.response.final': {
      const turn = event.turn;
      if (!turn || typeof turn.id !== 'string') return base;
      const partials = { ...base.partials };
      delete partials[turn.id];
      const turns = insertTurn(base.turns, applyPending(turn, state.pendingCitations));
      return {
        ...base,
        ...move('listening'),
        turns,
        partials,
        pendingCitations: clearPending(state.pendingCitations, turn.id),
        citationsByTurn: turn.citations?.length
          ? { ...base.citationsByTurn, [turn.id]: turn.citations }
          : base.citationsByTurn,
        speechPartial: null,
        activeAgent: null,
        turnCount: turns.length,
      };
    }

    case 'trainee.affect.updated': {
      return { ...base, traineeAffect: event.affect };
    }

    case 'persona.state.updated': {
      const incoming = event.state;
      if (!incoming || typeof incoming !== 'object') return base;
      const previous = state.personaState;
      let timeline = base.timeline;
      if (!previous || previous.emotion !== incoming.emotion) {
        timeline = pushCapped(
          timeline,
          marker(event, 'state_transition', EMOTION_LABEL[incoming.emotion] ?? incoming.emotion, {
            emotion: incoming.emotion,
            phase: incoming.scenario_phase,
            detail: previous ? `from ${EMOTION_LABEL[previous.emotion] ?? previous.emotion}` : 'simulated opening state',
          }),
          MAX_TIMELINE,
          (m) => m.id,
        );
      }
      if (previous && previous.scenario_phase !== incoming.scenario_phase) {
        timeline = pushCapped(
          timeline,
          marker(event, 'phase_change', PHASE_LABEL[incoming.scenario_phase] ?? incoming.scenario_phase, {
            phase: incoming.scenario_phase,
            emotion: incoming.emotion,
          }),
          MAX_TIMELINE,
          (m) => m.id,
        );
      }
      return {
        ...base,
        personaState: incoming,
        personaHistory: pushCapped(base.personaHistory, { atMs: event.at_ms, state: incoming }, MAX_HISTORY),
        timeline,
      };
    }

    case 'coach.insight': {
      const insight = event.insight;
      if (!insight || typeof insight.id !== 'string') return base;
      // §8.4 — assessment sessions must not receive hints / strategies at all.
      if (state.mode === 'assessment' && !insight.allowed_in_assessment) {
        return { ...base, suppressedCoachCount: state.suppressedCoachCount + 1 };
      }
      if (base.coachInsights.some((i) => i.id === insight.id)) return base;
      const timeline =
        insight.kind === 'missed_signal'
          ? pushCapped(base.timeline, marker(event, 'missed_signal', insight.title, { detail: insight.body }), MAX_TIMELINE)
          : base.timeline;
      return {
        ...base,
        coachInsights: pushCapped(base.coachInsights, insight, MAX_INSIGHTS),
        timeline,
      };
    }

    case 'knowledge.citation': {
      const citations = Array.isArray(event.citations) ? event.citations : [];
      if (citations.length === 0) return base;
      const hasTurn = base.turns.some((t) => t.id === event.turn_id);
      if (!hasTurn) {
        return {
          ...base,
          pendingCitations: { ...base.pendingCitations, [event.turn_id]: citations },
        };
      }
      return {
        ...base,
        turns: attachCitations(base.turns, event.turn_id, citations),
        citationsByTurn: { ...base.citationsByTurn, [event.turn_id]: citations },
      };
    }

    case 'score.updated': {
      if (!state.scoreLiveEnabled) return base;
      const score: LiveScore = {
        skill: event.skill,
        score: event.score,
        confidence: event.confidence,
        atMs: event.at_ms,
      };
      // Built imperatively so the computed union key keeps its precise type.
      const liveScores: Partial<Record<SkillKey, LiveScore>> = { ...base.liveScores };
      liveScores[event.skill] = score;
      return {
        ...base,
        liveScores,
        timeline: pushCapped(
          base.timeline,
          marker(event, 'score_event', SKILL_LABEL[event.skill] ?? event.skill, {
            detail: `${Math.round(event.score)} / 100`,
          }),
          MAX_TIMELINE,
          (m) => m.id,
        ),
      };
    }

    case 'compliance.warning': {
      const finding = event.finding;
      if (!finding || typeof finding.id !== 'string') return base;
      if (base.complianceFindings.some((f) => f.id === finding.id)) return base;
      return {
        ...base,
        complianceFindings: pushCapped(base.complianceFindings, finding, MAX_INSIGHTS),
        timeline: pushCapped(
          base.timeline,
          marker(event, 'compliance_warning', COMPLIANCE_TYPE_LABEL[finding.type] ?? finding.type, {
            detail: finding.explanation,
          }),
          MAX_TIMELINE,
          (m) => m.id,
        ),
      };
    }

    case 'runtime.fallback': {
      // Acceleration is a layer, not a dependency — degrade quietly (§62 / §94).
      return {
        ...base,
        runtime: {
          backend: event.to,
          fallbackFrom: event.from,
          fallbackReason: event.reason,
          degraded: true,
        },
      };
    }

    case 'connection.reconnecting': {
      return {
        ...base,
        ...move('reconnecting'),
        connection: { ...connection, online: false, reconnectAttempt: event.attempt },
      };
    }

    case 'session.error': {
      const info: SessionErrorInfo = {
        code: event.code,
        message: event.message,
        recoverable: event.recoverable,
      };
      // A recoverable error is an inline notice, not a dead page (§94).
      return {
        ...base,
        ...(event.recoverable ? { status: state.status, previousStatus: state.previousStatus } : move('error')),
        error: info,
        activeAgent: null,
        speechPartial: null,
      };
    }

    default: {
      // Exhaustiveness guard: adding a variant to `StreamingEvent` breaks the
      // build here instead of silently going unhandled.
      const exhaustive: never = event;
      void exhaustive;
      return state;
    }
  }
}

function applyPending(turn: TranscriptTurn, pending: CitationsByTurn): TranscriptTurn {
  const early = pending[turn.id];
  if (!early || turn.citations?.length) return turn;
  return { ...turn, citations: early };
}

function clearPending(pending: CitationsByTurn, turnId: ID): CitationsByTurn {
  if (!(turnId in pending)) return pending;
  const next = { ...pending };
  delete next[turnId];
  return next;
}

function keyResponseMarker(
  timeline: TimelineMarker[],
  event: StreamingEvent,
  turn: TranscriptTurn,
): TimelineMarker[] {
  const scoreEvent = turn.score_event;
  if (!scoreEvent || scoreEvent.delta <= 0) return timeline;
  return pushCapped(
    timeline,
    marker(event, 'key_response', SKILL_LABEL[scoreEvent.skill] ?? scoreEvent.skill, {
      detail: `+${Math.round(scoreEvent.delta)}`,
    }),
    MAX_TIMELINE,
    (m) => m.id,
  );
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export interface SessionActions {
  /** Reset for a (possibly different) session id. Idempotent per session. */
  initSession: (sessionId: ID, mode?: SessionMode) => void;
  applyBootstrap: (bootstrap: SessionBootstrap) => void;
  setBootstrapError: (message: string | null) => void;
  applyEvent: (event: StreamingEvent) => void;
  requestStatus: (next: SessionState) => void;
  setConnectionOnline: (online: boolean, attempt?: number) => void;
  setRuntime: (runtime: Partial<RuntimeStatus>) => void;
  /** Optimistic local echo of the trainee's message (§49.2 perceived latency). */
  appendLocalTurn: (text: string, atMs: number) => ID;
  setVoice: (patch: Partial<VoiceSliceState>) => void;
  registerBargeIn: () => void;
  dismissError: () => void;
  setEvaluation: (evaluation: Evaluation | null) => void;
  resetForRestart: () => void;
}

export type SessionStore = SimulationData & { actions: SessionActions };

let localTurnCounter = 0;

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...createInitialData(''),
  actions: {
    initSession: (sessionId, mode = 'training') => {
      const current = get();
      if (current.sessionId === sessionId && current.bootstrap) return;
      localTurnCounter = 0;
      set({ ...createInitialData(sessionId, mode), actions: current.actions });
    },

    applyBootstrap: (bootstrap) => {
      set((state) => ({
        bootstrap,
        mode: bootstrap.mode,
        sessionId: bootstrap.sessionId,
        runtime: { ...state.runtime, backend: bootstrap.runtime },
        scoreLiveEnabled: bootstrap.scoreLiveEnabled,
        startedAtMs: state.startedAtMs ?? bootstrap.startedAtMs,
        loading: false,
        bootstrapError: null,
        voice: { ...state.voice, captionsEnabled: state.voice.captionsEnabled },
      }));
    },

    setBootstrapError: (message) => set({ bootstrapError: message, loading: false }),

    applyEvent: (event) => {
      try {
        set((state) => reduceEvent(state, event));
      } catch {
        // The reducer is defensive, but the UI must survive even a malformed
        // payload from an older / newer server build (§62 / §94).
        set((state) => ({
          connection: { ...state.connection, droppedEvents: state.connection.droppedEvents + 1 },
        }));
      }
    },

    requestStatus: (next) =>
      set((state) => {
        const moved = transition(state.status, next);
        if (moved === state.status) return {};
        return { status: moved, previousStatus: state.status };
      }),

    setConnectionOnline: (online, attempt) =>
      set((state) => ({
        connection: {
          ...state.connection,
          online,
          reconnectAttempt: attempt ?? (online ? 0 : state.connection.reconnectAttempt),
        },
        status: online
          ? state.status === 'reconnecting'
            ? transition(state.status, 'listening')
            : state.status
          : state.status,
      })),

    setRuntime: (runtime) => set((state) => ({ runtime: { ...state.runtime, ...runtime } })),

    appendLocalTurn: (text, atMs) => {
      localTurnCounter += 1;
      const id: ID = `${LOCAL_TURN_PREFIX}${localTurnCounter}`;
      const state = get();
      const turn: TranscriptTurn = {
        id,
        session_id: state.sessionId,
        speaker: 'trainee',
        text,
        timestamp_ms: atMs,
      };
      set((s) => {
        const turns = insertTurn(s.turns, turn);
        return {
          turns,
          turnCount: turns.length,
          speechPartial: null,
          status: transition(s.status, 'processing'),
          previousStatus: s.status,
        };
      });
      return id;
    },

    setVoice: (patch) =>
      set((state) => {
        // Skip the write (and therefore every subscriber re-render) when the
        // patch does not actually change anything.
        let changed = false;
        for (const key of Object.keys(patch) as Array<keyof VoiceSliceState>) {
          if (state.voice[key] !== patch[key]) {
            changed = true;
            break;
          }
        }
        return changed ? { voice: { ...state.voice, ...patch } } : {};
      }),

    registerBargeIn: () =>
      set((state) => ({
        voice: { ...state.voice, status: 'interrupted', bargeInCount: state.voice.bargeInCount + 1 },
        status: transition(state.status, 'listening'),
        previousStatus: state.status,
      })),

    dismissError: () => set({ error: null }),

    setEvaluation: (evaluation) => set({ evaluation }),

    resetForRestart: () =>
      set((state) => ({
        ...createInitialData(state.sessionId, state.mode),
        bootstrap: state.bootstrap,
        scoreLiveEnabled: state.scoreLiveEnabled,
        runtime: state.runtime,
        loading: false,
        voice: { ...initialVoiceState, captionsEnabled: state.voice.captionsEnabled },
        actions: state.actions,
      })),
  },
}));

// ---------------------------------------------------------------------------
// Selectors — atomic on purpose so a persona meter tick does not re-render the
// transcript, and a streaming delta does not re-render the persona column.
// ---------------------------------------------------------------------------

export const useSessionActions = (): SessionActions => useSessionStore((s) => s.actions);

export const useSessionStatus = (): SessionState => useSessionStore((s) => s.status);
export const useSessionMode = (): SessionMode => useSessionStore((s) => s.mode);
export const useIsTrainingMode = (): boolean => useSessionStore((s) => s.mode === 'training');
export const useBootstrap = (): SessionBootstrap | null => useSessionStore((s) => s.bootstrap);
export const useBootstrapError = (): string | null => useSessionStore((s) => s.bootstrapError);
export const useIsLoading = (): boolean => useSessionStore((s) => s.loading);

export const useTurns = (): TranscriptTurn[] => useSessionStore((s) => s.turns);
export const usePartials = (): Record<ID, string> => useSessionStore((s) => s.partials);
export const useSpeechPartial = (): SimulationData['speechPartial'] =>
  useSessionStore((s) => s.speechPartial);

export const usePersonaState = (): PersonaSimulationState | null =>
  useSessionStore((s) => s.personaState);
export const useTraineeAffect = (): TraineeAffect | null =>
  useSessionStore((s) => s.traineeAffect);
export const usePersonaHistory = (): PersonaStateSnapshot[] => useSessionStore((s) => s.personaHistory);
export const useTimeline = (): TimelineMarker[] => useSessionStore((s) => s.timeline);

export const useCoachInsights = (): CoachInsight[] => useSessionStore((s) => s.coachInsights);
export const useSuppressedCoachCount = (): number => useSessionStore((s) => s.suppressedCoachCount);
export const useComplianceFindings = (): ComplianceFinding[] =>
  useSessionStore((s) => s.complianceFindings);
export const useLiveScores = (): Partial<Record<SkillKey, LiveScore>> =>
  useSessionStore((s) => s.liveScores);

export const useActiveAgent = (): AgentName | null => useSessionStore((s) => s.activeAgent);
export const useRuntimeStatus = (): RuntimeStatus => useSessionStore((s) => s.runtime);
export const useConnectionStatus = (): ConnectionStatus => useSessionStore((s) => s.connection);
export const useSessionError = (): SessionErrorInfo | null => useSessionStore((s) => s.error);

export const useTurnCount = (): number => useSessionStore((s) => s.turnCount);
export const useStartedAtMs = (): number | null => useSessionStore((s) => s.startedAtMs);
export const usePausedAtMs = (): number | null => useSessionStore((s) => s.pausedAtMs);
export const usePausedAccumulatedMs = (): number => useSessionStore((s) => s.pausedAccumulatedMs);
export const useCompletedAtMs = (): number | null => useSessionStore((s) => s.completedAtMs);
export const useEvaluation = (): Evaluation | null => useSessionStore((s) => s.evaluation);
export const useEvaluationId = (): ID | null => useSessionStore((s) => s.evaluationId);

export const useVoiceState = (): VoiceSliceState => useSessionStore((s) => s.voice);
export const useVoiceStatus = (): VoiceStatus => useSessionStore((s) => s.voice.status);
export const useCaptionsEnabled = (): boolean => useSessionStore((s) => s.voice.captionsEnabled);
export const useVoiceMuted = (): boolean => useSessionStore((s) => s.voice.muted);
export const usePushToTalkHeld = (): boolean => useSessionStore((s) => s.voice.pushToTalkHeld);
