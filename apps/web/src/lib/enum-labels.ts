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

/**
 * Persona simulation-state variables (`PersonaSimulationStateDelta`) and the
 * trait sliders that share their names. The builder renders these raw via
 * `titleize`, which without this map produced "Resistance +20".
 */
export const PERSONA_TRAIT_LABEL: Record<string, string> = {
  trust: '信任度', interest: '興趣', resistance: '抗拒', patience: '耐心',
  openness: '開放程度', risk_aversion: '風險趨避', price_sensitivity: '價格敏感度',
  time_pressure: '時間壓力', budget: '預算',
};

/** Persona goals (`PersonaSimulationState.current_goal`). */
export const PERSONA_GOAL_LABEL: Record<string, string> = {
  discuss_with_spouse: '和配偶討論', compare_quotes: '比價', delay_decision: '拖延決定',
  reduce_premium: '降低保費', understand_coverage: '弄懂保障內容', end_conversation: '結束對話',
};

/** Knowledge-base ACL permissions (§39). */
export const KB_PERMISSION_LABEL: Record<string, string> = {
  view: '檢視', use_for_rag: '供檢索使用', edit: '編輯',
  review: '審核', publish: '發布', export: '匯出', delete: '刪除',
};

/** Knowledge-base ACL scopes (§39). */
export const ACL_SCOPE_LABEL: Record<string, string> = {
  workspace: '工作區', role: '角色', team: '團隊', department: '部門',
};

// ---------------------------------------------------------------------------
// Ambiguous families — deliberately NOT in `enumLabel()`.
//
// `titleize()` resolves a bare slug with no idea which enum it came from, so a
// family whose slugs collide with another family's must be rendered through its
// own map at the call site. `ready` means 準備好 for a persona emotion, 已就緒
// for team readiness and 就緒 for a runtime; `high` means 高風險 for compliance
// but merely 高 for a memory class; `medium` is 中風險 or 中階 depending on who
// is asking. Putting any of these in the global lookup makes one of the two
// call sites silently wrong, which is worse than an untranslated slug.
// ---------------------------------------------------------------------------

export const DIFFICULTY_LABEL: Record<string, string> = {
  easy: '初階', medium: '中階', hard: '進階', expert: '專家',
};

export const SESSION_STATE_LABEL: Record<string, string> = {
  idle: '準備開始', connecting: '連線中', ready: '進行中', listening: '聆聽中',
  transcribing: '轉錄中', processing: '思考中', persona_speaking: '對方說話中',
  paused: '已暫停', reconnecting: '重新連線中', completed: '已完成', error: '發生錯誤',
};

/** §38 review workflow on scenarios, personas, questions and knowledge bases. */
export const CONTENT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿', in_review: '審核中', published: '已發布', archived: '已封存', rejected: '已退回',
};

export const COMPLIANCE_TYPE_LABEL: Record<string, string> = {
  false_promise: '不實承諾', misleading_statement: '誤導性陳述', unsupported_claim: '無佐證主張',
  privacy_issue: '隱私問題', unauthorized_advice: '未授權建議', sensitive_information: '敏感資訊',
  missing_disclosure: '缺少揭露', prompt_injection: '提示注入', restricted_topic: '受限制主題',
};

/** Reviewer workflow states on a compliance finding. */
export const REVIEWER_STATUS_LABEL: Record<string, string> = {
  open: '待處理', acknowledged: '已確認', resolved: '已處理', dismissed: '已排除',
};

/** Trainee / team readiness bands on the team and report pages. */
export const READINESS_LABEL: Record<string, string> = {
  ready: '已就緒', developing: '成長中', at_risk: '需要關注',
};

/** Where inference runs for this workspace or device. */
export const RUNTIME_BACKEND_LABEL: Record<string, string> = {
  server: '伺服器', browser: '瀏覽器', webgpu: '瀏覽器 WebGPU', wasm: '瀏覽器 WASM',
};

export const RUNTIME_STATE_LABEL: Record<string, string> = {
  unknown: '未知', detecting: '偵測中', supported: '支援', loading: '載入中',
  ready: '就緒', degraded: '降級中', fallback: '已改用備援', unavailable: '無法使用',
};

export const WORKER_STATUS_LABEL: Record<string, string> = {
  idle: '閒置', starting: '啟動中', alive: '運作中', crashed: '已當機', unavailable: '無法使用',
};

/** Device memory class reported by the runtime probe — a size, not a risk. */
export const MEMORY_CLASS_LABEL: Record<string, string> = {
  low: '低', medium: '中', high: '高', unknown: '未知',
};

/** Whether a local-AI consent prompt was answered. */
export const CONSENT_LABEL: Record<string, string> = {
  granted: '已啟用', declined: '已拒絕', unknown: '尚未詢問',
};

export const CONTROL_STATUS_LABEL: Record<string, string> = {
  enforced: '強制執行中', attention: '需要注意', monitoring: '監控中', disabled: '已停用',
};

export const AUDIT_RESULT_LABEL: Record<string, string> = {
  success: '成功', denied: '拒絕', error: '錯誤', failure: '失敗',
};

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  paid: '已付款', due: '待繳', failed: '付款失敗', refunded: '已退款',
};

/**
 * Slug → label for the families whose slugs are globally unambiguous, so
 * `titleize()` can resolve a bare slug safely. The maps under "Ambiguous
 * families" above are deliberately excluded — see the note there.
 */
export function enumLabel(key: string): string | undefined {
  const k = key.trim().toLowerCase();
  return (
    (SKILL_LABEL as Record<string, string>)[k] ??
    (EMOTION_LABEL as Record<string, string>)[k] ??
    (PHASE_LABEL as Record<string, string>)[k] ??
    (COMPLIANCE_RISK_LABEL as Record<string, string>)[k] ??
    INTENT_LABEL[k] ??
    PERSONA_TRAIT_LABEL[k] ??
    PERSONA_GOAL_LABEL[k] ??
    ACL_SCOPE_LABEL[k]
  );
}
