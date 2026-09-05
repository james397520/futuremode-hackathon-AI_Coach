/**
 * Display labels + tone mapping. Every visible string for enums lives here so the
 * components stay layout-only and nothing invents an enum value the contract
 * (`packages/shared`) does not define.
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
} from '@ai-coach/shared';

import type { ToneKey } from './tone';

// The enum → Chinese maps themselves live in `lib/enum-labels` so `components/`
// can use them too (via `titleize`); this module keeps the tones and the rest.
export {
  COMPLIANCE_RISK_LABEL, COMPLIANCE_TYPE_LABEL, DIFFICULTY_LABEL, EMOTION_LABEL, INTENT_LABEL,
  PHASE_LABEL, REVIEWER_STATUS_LABEL, SESSION_STATE_LABEL, SKILL_LABEL,
} from '@/lib/enum-labels';

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

export const PHASE_ORDER: readonly ScenarioPhase[] = [
  'opening',
  'needs_discovery',
  'presentation',
  'objection_handling',
  'closing',
  'ended',
];

export const COMPLIANCE_RISK_TONE: Record<ComplianceRisk, ToneKey> = {
  safe: 'success',
  low: 'mint',
  medium: 'warning',
  high: 'warning',
  critical: 'danger',
};

/** Where the avatar/inference ran for this session. */
export const RUNTIME_LABEL: Record<string, string> = {
  server: '伺服器',
  browser: '瀏覽器',
  webgpu: '瀏覽器 WebGPU',
  wasm: '瀏覽器 WASM',
  cloud: '雲端',
  local: '本機',
};

/**
 * `Scenario.training_type` is a free-form string on the API (not a strict
 * enum), so this is a lookup, not a `Record`. Seeded data uses snake_case
 * slugs ("objection_handling"); older fixtures used "Title Case" phrases —
 * both normalise to the same key. Rendering the raw value (as the scenario
 * card used to) showed English slugs like "objection_handling" verbatim in an
 * otherwise Chinese UI; an unrecognised value still falls back to itself
 * rather than disappearing.
 */
const TRAINING_TYPE_LABEL: Record<string, string> = {
  objection_handling: '異議處理', needs_discovery: '需求探索', compliance_assessment: '合規考核',
  compliance_check: '合規檢查', conversation_control: '對話掌控', difficult_conversation: '困難對話',
  executive_pitch: '高階主管提案', negotiation: '議價協商', product_pitch: '商品說明',
  closing: '締結成交', discovery: '需求探索',
};

export function trainingTypeLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return TRAINING_TYPE_LABEL[key] ?? value;
}

export const DIFFICULTY_TONE: Record<Difficulty, ToneKey> = {
  easy: 'mint',
  medium: 'blue',
  hard: 'violet',
  expert: 'danger',
};

/** §19 multi-agent names — one tasteful line, never an engineering dump (§93). */
export const AGENT_LABEL: Record<AgentName, string> = {
  orchestrator: '正在協調對話', scenario_director: '正在調整情境', customer: '客戶正在思考',
  coach: '教練正在檢視回覆', knowledge: '正在查找核准資料', evaluator: '正在評量此回合', compliance: '正在檢查合規性',
};

export const SPEAKER_LABEL: Record<SpeakerKind, string> = {
  trainee: '你', persona: '客戶', coach: 'AI 教練', system: '系統', compliance: '合規', knowledge: '知識庫',
};

export const SPEAKER_ROLE_TAG: Record<SpeakerKind, string> = {
  trainee: '學員', persona: '客戶', coach: '教練', system: '系統', compliance: '合規', knowledge: '來源',
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
  hint: '提示', missed_signal: '錯過的訊號', next_strategy: '下一步策略', post_session: '練習後建議',
};

export const COACH_KIND_TONE: Record<'hint' | 'missed_signal' | 'next_strategy' | 'post_session', ToneKey> = {
  hint: 'violet',
  missed_signal: 'warning',
  next_strategy: 'indigo',
  post_session: 'blue',
};

export const RUNTIME_BADGE: Record<'webgpu' | 'wasm' | 'server', { label: string; sub: string; tone: ToneKey }> = {
  // §15: show the acceleration tier, never the GPU model.
  webgpu: { label: 'GPU 加速', sub: 'WebGPU', tone: 'mint' },
  wasm: { label: 'WASM 模式', sub: '本機 CPU', tone: 'blue' },
  server: { label: '伺服器模式', sub: '伺服器推論', tone: 'indigo' },
};

export const VOICE_STATUS_LABEL: Record<
  'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'interrupted' | 'reconnecting' | 'ended',
  string
> = {
  idle: '準備完成', connecting: '連線中', listening: '聆聽中', transcribing: '轉錄中',
  thinking: '思考中', speaking: '說話中', interrupted: '已中斷', reconnecting: '重新連線中', ended: '通話已結束',
};

/** 學員臉部情緒標籤（webcam channel）。模型輸出的英文代碼 -> 顯示字。 */
export const AFFECT_LABEL: Record<string, string> = {
  neutral: '平靜',
  happy: '愉快',
  surprised: '驚訝',
  sad: '低落',
  angry: '不悅',
  fearful: '緊張',
  disgusted: '排斥',
  contempt: '不以為然',
};
