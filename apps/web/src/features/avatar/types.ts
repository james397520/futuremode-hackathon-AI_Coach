/**
 * Avatar Runtime contract — the browser half of the LivePortrait + MuseTalk spec.
 *
 * Every shape here mirrors a section of the avatar spec so the two halves can be
 * diffed by eye:
 *   §39 `GET /health` · §40 `GET /capabilities` · §42 `POST /sessions`
 *   §43 `POST /sessions/{id}/state` · §44 `POST /sessions/{id}/interrupt`
 *   §45 `WS /ws/sessions/{id}` events · §76 error codes · §9 expression state
 *
 * Nothing in this file imports React or the DOM: it is the pure contract, shared
 * by the client, the store and the mock driver.
 */
import type { PersonaEmotion, PersonaSimulationState } from '@ai-coach/shared';

// ---------------------------------------------------------------------------
// §39 / §40 — service description
// ---------------------------------------------------------------------------

/** §39 — `platform` is free-form on purpose (`mac_mlx`, `rtx_cuda`, …). */
export interface AvatarHealth {
  status: string;
  platform: string;
  liveportrait: string;
  musetalk: string;
  encoder: string;
}

/** §40 — `max_recommended_fps` comes from the host benchmark, never hardcoded. */
export interface AvatarCapabilities {
  backend: string;
  state_bank: boolean;
  continuous_liveportrait: boolean;
  musetalk: boolean;
  webrtc: boolean;
  max_recommended_fps: number;
}

/** §42 — session creation body. */
export interface AvatarSessionRequest {
  avatar_id: string;
  fps: number;
  width: number;
  height: number;
  mode: AvatarRuntimeMode;
}

/** §3 — Mode A (expression state bank) is the P0 path; Mode B is continuous. */
export type AvatarRuntimeMode = 'state_bank' | 'continuous';

export interface AvatarSessionResponse {
  session_id: string;
  /** Optional: some builds return the prepared portrait so the fallback can use it. */
  portrait_url?: string;
}

/** §43 — the persona state the runtime accepts. Deliberately a subset of §8. */
export interface AvatarPersonaStatePayload {
  emotion: string;
  emotion_intensity: number;
  trust: number;
  interest: number;
  resistance: number;
  speaking: boolean;
  listening: boolean;
  gaze: AvatarGaze;
  energy: number;
}

/** §70 — three gaze targets in v1. No eye tracking. */
export type AvatarGaze = 'user' | 'slightly_away' | 'down';

// ---------------------------------------------------------------------------
// §9 / §10 — expression controller state
// ---------------------------------------------------------------------------

/** §69 — the first release ships a small, curated bank. */
export type AvatarExpressionName =
  | 'neutral'
  | 'listening'
  | 'skeptical'
  | 'concerned'
  | 'frustrated'
  | 'interested'
  | 'thinking'
  | 'ready';

/** §9 `ExpressionState`, mirrored for the browser so the fallback can animate it. */
export interface AvatarExpressionState {
  name: AvatarExpressionName;
  intensity: number;
  head_yaw: number;
  head_pitch: number;
  head_roll: number;
  eye_open: number;
  blink_rate: number;
  gaze_x: number;
  gaze_y: number;
  motion_energy: number;
}

// ---------------------------------------------------------------------------
// §45 — WebSocket control events
// ---------------------------------------------------------------------------

export type AvatarEventType =
  | 'avatar.ready'
  | 'avatar.loading'
  | 'avatar.state.changed'
  | 'avatar.expression.transition'
  | 'avatar.audio.buffering'
  | 'avatar.speaking.started'
  | 'avatar.speaking.ended'
  | 'avatar.interrupted'
  | 'avatar.frame.drop'
  | 'avatar.runtime.degraded'
  | 'avatar.error';

export interface AvatarEventBase {
  type: AvatarEventType;
  /** Runtime clock in ms. Optional: not every build stamps every event. */
  at_ms?: number;
}

export interface AvatarReadyEvent extends AvatarEventBase {
  type: 'avatar.ready';
  backend?: string;
  fps?: number;
}

export interface AvatarLoadingEvent extends AvatarEventBase {
  type: 'avatar.loading';
  stage?: string;
  progress?: number;
}

export interface AvatarStateChangedEvent extends AvatarEventBase {
  type: 'avatar.state.changed';
  state?: Partial<AvatarPersonaStatePayload>;
}

export interface AvatarExpressionTransitionEvent extends AvatarEventBase {
  type: 'avatar.expression.transition';
  from?: AvatarExpressionName;
  to: AvatarExpressionName;
  duration_ms?: number;
  intensity?: number;
}

export interface AvatarAudioBufferingEvent extends AvatarEventBase {
  type: 'avatar.audio.buffering';
  buffered_ms?: number;
}

export interface AvatarSpeakingStartedEvent extends AvatarEventBase {
  type: 'avatar.speaking.started';
  utterance_id?: string;
}

export interface AvatarSpeakingEndedEvent extends AvatarEventBase {
  type: 'avatar.speaking.ended';
  utterance_id?: string;
}

export interface AvatarInterruptedEvent extends AvatarEventBase {
  type: 'avatar.interrupted';
  reason?: string;
}

export interface AvatarFrameDropEvent extends AvatarEventBase {
  type: 'avatar.frame.drop';
  dropped?: number;
  /** §51 — audio/video drift measured by the runtime, in ms. */
  av_drift_ms?: number;
}

export interface AvatarRuntimeDegradedEvent extends AvatarEventBase {
  type: 'avatar.runtime.degraded';
  /** §53 — which engine gave up: the other one keeps running. */
  component?: 'liveportrait' | 'musetalk' | 'encoder' | 'webrtc';
  reason?: string;
}

export interface AvatarErrorEvent extends AvatarEventBase {
  type: 'avatar.error';
  code?: AvatarErrorCode;
  message?: string;
}

export type AvatarEvent =
  | AvatarReadyEvent
  | AvatarLoadingEvent
  | AvatarStateChangedEvent
  | AvatarExpressionTransitionEvent
  | AvatarAudioBufferingEvent
  | AvatarSpeakingStartedEvent
  | AvatarSpeakingEndedEvent
  | AvatarInterruptedEvent
  | AvatarFrameDropEvent
  | AvatarRuntimeDegradedEvent
  | AvatarErrorEvent;

// ---------------------------------------------------------------------------
// §76 — error codes
// ---------------------------------------------------------------------------

export const AVATAR_ERROR_CODES = [
  'MODEL_LOAD_FAILED',
  'AVATAR_PREPARE_FAILED',
  'AUDIO_FORMAT_INVALID',
  'LIPSYNC_TIMEOUT',
  'FRAME_QUEUE_OVERFLOW',
  'ENCODER_FAILED',
  'WEBRTC_DISCONNECTED',
  'OUT_OF_MEMORY',
  // Browser-side additions — the runtime never sends these, but the UI needs a
  // code for "there is nothing listening on the loopback port".
  'RUNTIME_UNREACHABLE',
  'RUNTIME_TIMEOUT',
  'RUNTIME_BAD_RESPONSE',
  'SESSION_CREATE_FAILED',
  'SOCKET_FAILED',
] as const;

export type AvatarErrorCode = (typeof AVATAR_ERROR_CODES)[number];

export interface AvatarFailure {
  code: AvatarErrorCode;
  message: string;
}

/**
 * §53 — every call resolves. The avatar is decoration on top of a training
 * session; a failure must degrade the picture, never unmount the session.
 */
export type AvatarResult<T> = { ok: true; value: T } | { ok: false; error: AvatarFailure };

export function avatarOk<T>(value: T): AvatarResult<T> {
  return { ok: true, value };
}

export function avatarFail<T>(code: AvatarErrorCode, message: string): AvatarResult<T> {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Browser-side runtime status
// ---------------------------------------------------------------------------

/**
 * `unavailable` = nothing is listening (the common case on a laptop with no
 * engines installed). `degraded` = the runtime answered but one engine is down
 * (§53) — we still show something better than a dead image.
 */
export type AvatarRuntimeStatus =
  | 'unknown'
  | 'checking'
  | 'unavailable'
  | 'loading'
  | 'ready'
  | 'degraded';

/** Measured in the browser, reported to admins only (§50). */
export interface AvatarFrameStats {
  fps: number;
  decodedFrames: number;
  droppedFrames: number;
  lastFrameAtMs: number;
}

// ---------------------------------------------------------------------------
// §52 — preflight
// ---------------------------------------------------------------------------

export type PreflightCheckId =
  | 'backend'
  | 'model'
  | 'avatar_cache'
  | 'expression_bank'
  | 'musetalk_warmup'
  | 'tts'
  | 'webrtc'
  | 'audio_device';

export type PreflightCheckState = 'pending' | 'running' | 'ok' | 'skipped' | 'failed';

export interface PreflightCheck {
  id: PreflightCheckId;
  label: string;
  state: PreflightCheckState;
  detail?: string;
  /**
   * §52 lists eight checks, but §53 outranks it: only a check the *session*
   * genuinely needs may block Start. Avatar checks are advisory.
   */
  required: boolean;
}

/** Convenience alias so consumers do not need the shared package directly. */
export type { PersonaEmotion, PersonaSimulationState };
