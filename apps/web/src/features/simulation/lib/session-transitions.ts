/**
 * Session state machine — spec §92 / §23.
 * The store may ONLY move between the transitions declared here; anything else is
 * dropped (never thrown), so a late / duplicated / hostile event can not corrupt
 * the UI or crash the page (§62 / §94).
 */
import type { SessionState } from '@ai-coach/shared';

export const LEGAL_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle: ['connecting', 'error'],
  connecting: ['ready', 'listening', 'reconnecting', 'completed', 'error'],
  ready: [
    'listening',
    'transcribing',
    'processing',
    'persona_speaking',
    'paused',
    'reconnecting',
    'completed',
    'error',
  ],
  listening: [
    'transcribing',
    'processing',
    'persona_speaking',
    'ready',
    'paused',
    'reconnecting',
    'completed',
    'error',
  ],
  transcribing: [
    'processing',
    'listening',
    'persona_speaking',
    'paused',
    'reconnecting',
    'completed',
    'error',
  ],
  processing: [
    'persona_speaking',
    'listening',
    'ready',
    'paused',
    'reconnecting',
    'completed',
    'error',
  ],
  persona_speaking: [
    'listening',
    'processing',
    'ready',
    'paused',
    'reconnecting',
    'completed',
    'error',
  ],
  paused: ['listening', 'ready', 'reconnecting', 'completed', 'error'],
  reconnecting: ['connecting', 'ready', 'listening', 'completed', 'error'],
  // `completed` is terminal for a session; only an explicit restart (idle) leaves it.
  completed: ['idle'],
  error: ['idle', 'connecting', 'reconnecting', 'completed'],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Returns `to` when the transition is legal, otherwise keeps `from`. Never throws. */
export function transition(from: SessionState, to: SessionState): SessionState {
  return canTransition(from, to) ? to : from;
}

/** States where the trainee may not type / talk (§18 — composer disabled + explained). */
export const INPUT_BLOCKED_STATES: readonly SessionState[] = [
  'idle',
  'connecting',
  'persona_speaking',
  'paused',
  'reconnecting',
  'completed',
  'error',
];

/** States that mean "the session is live" for the header pill (§15). */
export const LIVE_STATES: readonly SessionState[] = [
  'ready',
  'listening',
  'transcribing',
  'processing',
  'persona_speaking',
];

export function isLive(state: SessionState): boolean {
  return LIVE_STATES.includes(state);
}

export function isTerminal(state: SessionState): boolean {
  return state === 'completed';
}

/**
 * §22.2 voice connection states derived from the authoritative session state.
 * The voice UI never invents a state of its own — it re-labels the session
 * machine, plus the two states only the client can know (`interrupted` after a
 * barge-in, `idle` before the mic is live).
 */
export function voiceStatusFromSession(
  session: SessionState,
  micLive: boolean,
  interrupted: boolean,
): 'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'ended' {
  if (session === 'completed') return 'ended';
  if (session === 'reconnecting') return 'reconnecting';
  if (session === 'connecting') return 'connecting';
  if (interrupted) return 'interrupted';
  if (session === 'persona_speaking') return 'speaking';
  if (session === 'transcribing') return 'transcribing';
  if (session === 'processing') return 'thinking';
  if (!micLive) return 'idle';
  if (session === 'listening' || session === 'ready') return 'listening';
  return 'idle';
}
