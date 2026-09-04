/**
 * Expression Controller (browser side) — §9, §10, §12, §13, §70.
 *
 * The simulation's `PersonaSimulationState` is a *product* state (trust /
 * interest / resistance / phase). LivePortrait has no `emotion="angry"` API, so
 * something has to turn semantics into an `ExpressionState`. On the server that
 * something drives motion templates; in the browser the same mapping drives the
 * fallback's CSS so the two never disagree about what the customer is feeling.
 *
 *   persona state → semantic emotion → ExpressionState → (runtime | fallback CSS)
 *
 * Head and gaze are clamped to the §70 v1 envelope: yaw ±10°, pitch ±6°, roll ±5°.
 */
import type { PersonaEmotion, PersonaSimulationState } from '@ai-coach/shared';

import type {
  AvatarExpressionName,
  AvatarExpressionState,
  AvatarGaze,
  AvatarPersonaStatePayload,
} from '../types';

export const HEAD_YAW_LIMIT = 10;
export const HEAD_PITCH_LIMIT = 6;
export const HEAD_ROLL_LIMIT = 5;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const unit = (value: number): number => clamp(value, 0, 1);
/** 0–100 product scale → 0–1. */
const ratio = (value: number | undefined): number => unit((value ?? 50) / 100);

/**
 * §10 presets, trimmed to the §69 "six expressions first" rule plus `thinking`
 * and `ready`, which the simulation already emits.
 */
export const EXPRESSION_PRESETS: Record<AvatarExpressionName, AvatarExpressionState> = {
  neutral: {
    name: 'neutral',
    intensity: 0.2,
    head_yaw: 0,
    head_pitch: 0,
    head_roll: 0,
    eye_open: 1,
    blink_rate: 0.2,
    gaze_x: 0,
    gaze_y: 0,
    motion_energy: 0.35,
  },
  listening: {
    name: 'listening',
    intensity: 0.3,
    head_yaw: -3,
    head_pitch: 1.5,
    head_roll: 0,
    eye_open: 1,
    blink_rate: 0.26,
    gaze_x: -0.06,
    gaze_y: 0,
    motion_energy: 0.42,
  },
  skeptical: {
    name: 'skeptical',
    intensity: 0.55,
    head_yaw: 6,
    head_pitch: -2,
    head_roll: 2,
    eye_open: 0.86,
    blink_rate: 0.18,
    gaze_x: 0.1,
    gaze_y: -0.04,
    motion_energy: 0.4,
  },
  concerned: {
    name: 'concerned',
    intensity: 0.5,
    head_yaw: -2,
    head_pitch: 3,
    head_roll: -1.5,
    eye_open: 0.92,
    blink_rate: 0.24,
    gaze_x: -0.05,
    gaze_y: 0.08,
    motion_energy: 0.38,
  },
  frustrated: {
    name: 'frustrated',
    intensity: 0.72,
    head_yaw: -6,
    head_pitch: -3,
    head_roll: -2.5,
    eye_open: 0.8,
    blink_rate: 0.14,
    gaze_x: -0.12,
    gaze_y: -0.02,
    motion_energy: 0.62,
  },
  interested: {
    name: 'interested',
    intensity: 0.58,
    head_yaw: 2,
    head_pitch: 2.5,
    head_roll: 0.5,
    eye_open: 1,
    blink_rate: 0.28,
    gaze_x: 0.02,
    gaze_y: 0.02,
    motion_energy: 0.55,
  },
  thinking: {
    name: 'thinking',
    intensity: 0.42,
    head_yaw: -8,
    head_pitch: -1,
    head_roll: 1.5,
    eye_open: 0.9,
    blink_rate: 0.16,
    gaze_x: -0.16,
    gaze_y: 0.1,
    motion_energy: 0.3,
  },
  ready: {
    name: 'ready',
    intensity: 0.5,
    head_yaw: 0,
    head_pitch: 1,
    head_roll: 0,
    eye_open: 1,
    blink_rate: 0.24,
    gaze_x: 0,
    gaze_y: 0,
    motion_energy: 0.5,
  },
};

/** §13 — product emotion → curated expression. `reassured` has no bank entry yet. */
const EMOTION_TO_EXPRESSION: Record<PersonaEmotion, AvatarExpressionName> = {
  neutral: 'neutral',
  curious: 'interested',
  skeptical: 'skeptical',
  frustrated: 'frustrated',
  interested: 'interested',
  reassured: 'ready',
  ready: 'ready',
};

/** Plain-language label for the caption chip — never shown as a raw enum. */
export const EXPRESSION_LABEL: Record<AvatarExpressionName, string> = {
  neutral: 'Neutral',
  listening: 'Listening',
  skeptical: 'Skeptical',
  concerned: 'Concerned',
  frustrated: 'Frustrated',
  interested: 'Interested',
  thinking: 'Considering',
  ready: 'Ready to decide',
};

/** Tone key per expression, so the stage's wash matches the persona state card. */
export const EXPRESSION_TONE: Record<
  AvatarExpressionName,
  'indigo' | 'blue' | 'cyan' | 'mint' | 'violet' | 'warning' | 'danger' | 'neutral'
> = {
  neutral: 'neutral',
  listening: 'cyan',
  skeptical: 'warning',
  concerned: 'warning',
  frustrated: 'danger',
  interested: 'mint',
  thinking: 'indigo',
  ready: 'mint',
};

export interface ExpressionInputs {
  personaState: PersonaSimulationState | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
}

/**
 * §12 hysteresis lives on the runtime (it owns the motion templates and must not
 * flicker between banks). The browser mirror only needs the *displayed* name, so
 * the ordering here is: explicit runtime activity first, then emotion.
 */
export function expressionNameFor(inputs: ExpressionInputs): AvatarExpressionName {
  const { personaState, speaking, listening, thinking } = inputs;
  const emotion = personaState?.emotion;
  const base: AvatarExpressionName = emotion ? EMOTION_TO_EXPRESSION[emotion] : 'neutral';

  // While the customer talks, the emotion is what the audience must read.
  if (speaking) return base;
  if (thinking) return base === 'neutral' ? 'thinking' : base;
  if (listening) return base === 'neutral' ? 'listening' : base;
  return base;
}

/**
 * Intensity from the persona's own numbers — a customer at resistance 78 must
 * look more skeptical than one at 40 (§13), otherwise the state card and the
 * face tell different stories.
 */
export function expressionIntensityFor(
  name: AvatarExpressionName,
  state: PersonaSimulationState | null,
): number {
  const preset = EXPRESSION_PRESETS[name];
  if (!state) return preset.intensity;

  const resistance = ratio(state.resistance);
  const interest = ratio(state.interest);
  const trust = ratio(state.trust);
  const patience = ratio(state.patience);

  switch (name) {
    case 'skeptical':
      return unit(0.3 + resistance * 0.6);
    case 'frustrated':
      return unit(0.35 + resistance * 0.4 + (1 - patience) * 0.3);
    case 'concerned':
      return unit(0.3 + (1 - trust) * 0.5);
    case 'interested':
      return unit(0.28 + interest * 0.6);
    case 'ready':
      return unit(0.3 + trust * 0.5);
    case 'thinking':
      return unit(0.25 + (1 - patience) * 0.3);
    case 'listening':
      return unit(0.22 + interest * 0.3);
    case 'neutral':
    default:
      return preset.intensity;
  }
}

/** §70 — gaze is one of three targets in v1, chosen from the product state. */
export function gazeFor(inputs: ExpressionInputs): AvatarGaze {
  const { personaState, thinking } = inputs;
  if (thinking) return 'slightly_away';
  if (!personaState) return 'user';
  if (personaState.emotion === 'frustrated' && personaState.resistance > 70) return 'slightly_away';
  if (personaState.emotion === 'skeptical' && personaState.trust < 30) return 'down';
  return 'user';
}

/**
 * The full `ExpressionState` (§9), scaled by intensity and clamped to §70.
 * This is what the fallback animates and what an admin sees in telemetry.
 */
export function expressionStateFor(inputs: ExpressionInputs): AvatarExpressionState {
  const name = expressionNameFor(inputs);
  const preset = EXPRESSION_PRESETS[name];
  const intensity = expressionIntensityFor(name, inputs.personaState);
  // Scale motion with intensity, but never below the preset's resting half —
  // a still face reads as a frozen stream, which §53 explicitly wants to avoid.
  const scale = 0.5 + intensity * 0.5;

  return {
    name,
    intensity,
    head_yaw: clamp(preset.head_yaw * scale, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT),
    head_pitch: clamp(preset.head_pitch * scale, -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT),
    head_roll: clamp(preset.head_roll * scale, -HEAD_ROLL_LIMIT, HEAD_ROLL_LIMIT),
    eye_open: unit(preset.eye_open),
    blink_rate: unit(preset.blink_rate),
    gaze_x: clamp(preset.gaze_x, -1, 1),
    gaze_y: clamp(preset.gaze_y, -1, 1),
    motion_energy: unit(preset.motion_energy * scale + (inputs.speaking ? 0.12 : 0)),
  };
}

/** §43 request body — the runtime maps this onto its own motion templates. */
export function toRuntimeStatePayload(inputs: ExpressionInputs): AvatarPersonaStatePayload {
  const { personaState, speaking, listening } = inputs;
  const name = expressionNameFor(inputs);
  return {
    emotion: personaState?.emotion ?? 'neutral',
    emotion_intensity: expressionIntensityFor(name, personaState),
    trust: personaState?.trust ?? 50,
    interest: personaState?.interest ?? 50,
    resistance: personaState?.resistance ?? 50,
    speaking,
    listening,
    gaze: gazeFor(inputs),
    energy: expressionStateFor(inputs).motion_energy,
  };
}

/** Cheap structural equality so we do not POST the same state twice (§43). */
export function samePayload(
  a: AvatarPersonaStatePayload | null,
  b: AvatarPersonaStatePayload,
): boolean {
  if (!a) return false;
  return (
    a.emotion === b.emotion &&
    Math.abs(a.emotion_intensity - b.emotion_intensity) < 0.02 &&
    a.trust === b.trust &&
    a.interest === b.interest &&
    a.resistance === b.resistance &&
    a.speaking === b.speaking &&
    a.listening === b.listening &&
    a.gaze === b.gaze &&
    Math.abs(a.energy - b.energy) < 0.02
  );
}
