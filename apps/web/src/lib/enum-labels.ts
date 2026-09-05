/**
 * Chinese display labels for the contract enums (`packages/shared`), kept in
 * `lib/` so both `components/` and `features/` can read them without a layering
 * inversion. `features/simulation/lib/labels.ts` re-exports these; `titleize`
 * in `lib/utils` consults them before falling back to Title Case, so a raw
 * slug such as `professional_knowledge` renders as 專業知識 everywhere instead
 * of "Professional Knowledge" leaking into an otherwise Chinese UI.
 */
import type { ComplianceRisk, PersonaEmotion, ScenarioPhase, SkillKey } from '@ai-coach/shared';

export const SKILL_LABEL: Record<SkillKey, string> = {
  professional_knowledge: '專業知識', empathy: '同理心', needs_discovery: '需求探索',
  communication_clarity: '表達清晰度', objection_handling: '異議處理', trust_building: '信任建立',
  product_knowledge: '產品知識', compliance: '合規', closing_ability: '締結能力', goal_achievement: '目標達成',
};

/** §31 / §40 — simulated persona emotion, never inferred from a real face or voice. */
export const EMOTION_LABEL: Record<PersonaEmotion, string> = {
  neutral: '平靜', curious: '好奇', skeptical: '懷疑', frustrated: '挫折',
  interested: '有興趣', reassured: '安心', ready: '準備好',
};

export const PHASE_LABEL: Record<ScenarioPhase, string> = {
  opening: '開場', needs_discovery: '需求探索', presentation: '說明方案',
  objection_handling: '異議處理', closing: '收尾', ended: '已結束',
};

export const COMPLIANCE_RISK_LABEL: Record<ComplianceRisk, string> = {
  safe: '安全', low: '低風險', medium: '中風險', high: '高風險', critical: '重大風險',
};

/**
 * Every `IntentLabel` the API can emit (`app/agents/intent.py`). Unknown values
 * fall back to the slug rather than being hidden: a missing translation should
 * be visible, not silently swallowed.
 */
export const INTENT_LABEL: Record<string, string> = {
  greeting: '寒暄', small_talk: '閒聊', question: '提問', needs_probe: '需求探詢',
  product_explanation: '商品說明', price_objection: '價格異議', objection_other: '其他異議',
  empathy_response: '同理回應', closing_attempt: '嘗試成交', agreement: '認同', off_topic: '離題',
  direct_answer_request: '索取標準答案', persona_break: '試圖跳出角色', prompt_injection: '注入嘗試',
  unauthorized_knowledge: '索取未授權資料', incomplete: '話沒說完', ambiguous: '語意不明',
  exit_intent: '想結束', other: '其他',
  // Finer-grained intents used by the demo transcript fixture (`lib/fixtures/sessions`).
  objection_already_insured: '已有保險的異議', product_pitch: '商品推介', clarification_request: '請求釐清',
  needs_discovery: '需求探索', information_sharing: '資訊分享', gap_explanation: '缺口說明',
  emotional_disclosure: '情緒表露', premium_explanation: '保費說明', guarantee_probe: '試探保證',
  guarantee_claim: '保證性聲稱', compliance_correction: '合規修正', soft_commitment: '初步承諾', next_step: '下一步',
};

/** Slug → label across every enum family above; `undefined` when unknown. */
export function enumLabel(key: string): string | undefined {
  const k = key.trim().toLowerCase();
  return (
    (SKILL_LABEL as Record<string, string>)[k] ??
    (EMOTION_LABEL as Record<string, string>)[k] ??
    (PHASE_LABEL as Record<string, string>)[k] ??
    (COMPLIANCE_RISK_LABEL as Record<string, string>)[k] ??
    INTENT_LABEL[k]
  );
}
