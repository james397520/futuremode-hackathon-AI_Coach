/**
 * Display labels + tone mapping. Every visible string for enums lives here so the
 * components stay layout-only and nothing invents an enum value the contract
 * (`packages/shared-types`) does not define.
 */
import type {
  AgentName,
  ComplianceFindingType,
  ComplianceRisk,
  Difficulty,
  PersonaEmotion,
  ScenarioPhase,
  SessionState,
  SkillKey,
  SpeakerKind,
} from '@ai-coach/shared-types';

import type { ToneKey } from './tone';

/** §23 session states — user-facing wording (`Live`, `Thinking`) over raw enum names. */
export const SESSION_STATE_LABEL: Record<SessionState, string> = {
  idle: 'Ready to start',
  connecting: 'Connecting',
  ready: 'Live',
  listening: 'Listening',
  transcribing: 'Transcribing',
  processing: 'Thinking',
  persona_speaking: 'Speaking',
  paused: 'Paused',
  reconnecting: 'Reconnecting',
  completed: 'Completed',
  error: 'Error',
};

export const SESSION_STATE_TONE: Record<SessionState, ToneKey> = {
  idle: 'neutral',
  connecting: 'blue',
  ready: 'mint',
  listening: 'cyan',
  transcribing: 'blue',
  processing: 'indigo',
  persona_speaking: 'violet',
  paused: 'warning',
  reconnecting: 'warning',
  completed: 'success',
  error: 'danger',
};

/** §31 / §40 — simulated persona emotion, never inferred from a real face or voice. */
export const EMOTION_LABEL: Record<PersonaEmotion, string> = {
  neutral: 'Neutral',
  curious: 'Curious',
  skeptical: 'Skeptical',
  frustrated: 'Frustrated',
  interested: 'Interested',
  reassured: 'Reassured',
  ready: 'Ready',
};

export const EMOTION_TONE: Record<PersonaEmotion, ToneKey> = {
  neutral: 'neutral',
  curious: 'blue',
  skeptical: 'warning',
  frustrated: 'danger',
  interested: 'cyan',
  reassured: 'mint',
  ready: 'success',
};

/** Canonical order for the §31 timeline strip: Neutral → Skeptical → Frustrated → Interested → Ready. */
export const EMOTION_LADDER: readonly PersonaEmotion[] = [
  'neutral',
  'curious',
  'skeptical',
  'frustrated',
  'interested',
  'reassured',
  'ready',
];

export const PHASE_LABEL: Record<ScenarioPhase, string> = {
  opening: 'Opening',
  needs_discovery: 'Needs Discovery',
  presentation: 'Presentation',
  objection_handling: 'Objection Handling',
  closing: 'Closing',
  ended: 'Ended',
};

export const PHASE_ORDER: readonly ScenarioPhase[] = [
  'opening',
  'needs_discovery',
  'presentation',
  'objection_handling',
  'closing',
  'ended',
];

export const COMPLIANCE_RISK_LABEL: Record<ComplianceRisk, string> = {
  safe: 'Safe',
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
  critical: 'Critical risk',
};

export const COMPLIANCE_RISK_TONE: Record<ComplianceRisk, ToneKey> = {
  safe: 'success',
  low: 'mint',
  medium: 'warning',
  high: 'warning',
  critical: 'danger',
};

export const COMPLIANCE_TYPE_LABEL: Record<ComplianceFindingType, string> = {
  false_promise: 'False Promise',
  misleading_statement: 'Misleading Statement',
  unsupported_claim: 'Unsupported Claim',
  privacy_issue: 'Privacy Issue',
  unauthorized_advice: 'Unauthorized Advice',
  sensitive_information: 'Sensitive Information',
  missing_disclosure: 'Missing Disclosure',
  prompt_injection: 'Prompt Injection',
  restricted_topic: 'Restricted Topic',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
};

export const DIFFICULTY_TONE: Record<Difficulty, ToneKey> = {
  easy: 'mint',
  medium: 'blue',
  hard: 'violet',
  expert: 'danger',
};

/** §19 multi-agent names — one tasteful line, never an engineering dump (§93). */
export const AGENT_LABEL: Record<AgentName, string> = {
  orchestrator: 'Coordinating the session',
  scenario_director: 'Adjusting the scenario',
  customer: 'The customer is thinking',
  coach: 'Coach is reviewing your reply',
  knowledge: 'Looking up approved material',
  evaluator: 'Scoring this turn',
  compliance: 'Checking compliance',
};

export const SKILL_LABEL: Record<SkillKey, string> = {
  professional_knowledge: 'Professional Knowledge',
  empathy: 'Empathy',
  needs_discovery: 'Needs Discovery',
  communication_clarity: 'Communication Clarity',
  objection_handling: 'Objection Handling',
  trust_building: 'Trust Building',
  product_knowledge: 'Product Knowledge',
  compliance: 'Compliance',
  closing_ability: 'Closing Ability',
  goal_achievement: 'Goal Achievement',
};

export const SPEAKER_LABEL: Record<SpeakerKind, string> = {
  trainee: 'You',
  persona: 'Customer',
  coach: 'AI Coach',
  system: 'System',
  compliance: 'Compliance',
  knowledge: 'Knowledge',
};

export const SPEAKER_ROLE_TAG: Record<SpeakerKind, string> = {
  trainee: 'Trainee',
  persona: 'Customer',
  coach: 'Coach',
  system: 'System',
  compliance: 'Compliance',
  knowledge: 'Source',
};

export const SPEAKER_TONE: Record<SpeakerKind, ToneKey> = {
  trainee: 'blue',
  persona: 'indigo',
  coach: 'violet',
  system: 'neutral',
  compliance: 'warning',
  knowledge: 'cyan',
};

export const COACH_KIND_LABEL: Record<'hint' | 'missed_signal' | 'next_strategy' | 'post_session', string> = {
  hint: 'Hint',
  missed_signal: 'Missed signal',
  next_strategy: 'Next strategy',
  post_session: 'Post-session note',
};

export const COACH_KIND_TONE: Record<'hint' | 'missed_signal' | 'next_strategy' | 'post_session', ToneKey> = {
  hint: 'violet',
  missed_signal: 'warning',
  next_strategy: 'indigo',
  post_session: 'blue',
};

export const RUNTIME_BADGE: Record<'webgpu' | 'wasm' | 'server', { label: string; sub: string; tone: ToneKey }> = {
  // §15: show the acceleration tier, never the GPU model.
  webgpu: { label: 'GPU Accelerated', sub: 'WebGPU', tone: 'mint' },
  wasm: { label: 'WASM Mode', sub: 'Local CPU', tone: 'blue' },
  server: { label: 'Server Mode', sub: 'Server inference', tone: 'indigo' },
};

export const VOICE_STATUS_LABEL: Record<
  'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'ended',
  string
> = {
  idle: 'Ready',
  connecting: 'Connecting',
  listening: 'Listening',
  transcribing: 'Transcribing',
  thinking: 'Thinking',
  speaking: 'Speaking',
  interrupted: 'Interrupted',
  reconnecting: 'Reconnecting',
  ended: 'Call ended',
};
