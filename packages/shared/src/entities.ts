/**
 * 核心 Entity — spec §53 / §10.
 * 每筆敏感資料都必須帶 tenant_id + workspace_id（§10）。
 */
import type {
  ContentStatus, Difficulty, DocumentState, Role, SessionMode, SessionState,
} from './state-machines';
import type {
  ComplianceRisk, PersonaHiddenState, PersonaSimulationState, PersonaTraits,
} from './persona';

export type ID = string;
export type ISODateTime = string;

/** 所有 tenant-scoped entity 的共同欄位（§10） */
export interface TenantScoped {
  id: ID;
  tenant_id: ID;
  workspace_id: ID;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Organization { id: ID; name: string; created_at: ISODateTime }
export interface Workspace extends Omit<TenantScoped, 'workspace_id'> { name: string; kind: 'b2b' | 'b2c' }
export interface Team extends TenantScoped { name: string; department?: string }
export interface User extends TenantScoped { email: string; display_name: string; roles: Role[]; team_ids: ID[] }

// ---------- Knowledge ----------
export type DocumentSourceKind = 'pdf' | 'docx' | 'pptx' | 'txt' | 'csv' | 'html' | 'url' | 'manual';

export interface KnowledgeBase extends TenantScoped {
  name: string;
  description?: string;
  status: ContentStatus;
  document_count: number;
  chunk_count: number;
  embedding_model: string;
  /** §39 Knowledge Access Control */
  acl: KnowledgeAcl;
}

export interface KnowledgeAcl {
  scope: 'organization' | 'workspace' | 'department' | 'team' | 'role' | 'user';
  subject_ids: ID[];
  permissions: Array<'view' | 'use_for_rag' | 'edit' | 'review' | 'publish' | 'export' | 'delete'>;
}

export interface KnowledgeDocument extends TenantScoped {
  knowledge_base_id: ID;
  filename: string;
  source_kind: DocumentSourceKind;
  size_bytes: number;
  state: DocumentState;
  /** 0–100，處理進度（§29 Document Processing Visual） */
  progress: number;
  active_version: number;
  failure_reason?: string;
}

export interface DocumentVersion {
  document_id: ID;
  version: number;
  uploaded_by: ID;
  uploaded_at: ISODateTime;
  change_summary?: string;
  embedding_version: string;
  archived: boolean;
}

export type ChunkStrategy =
  | 'auto' | 'semantic' | 'heading' | 'paragraph' | 'fixed_token' | 'table_aware' | 'faq_aware';

export interface Chunk {
  id: ID;
  document_id: ID;
  document_version: number;
  index: number;
  text: string;
  token_count: number;
  page?: number;
  section?: string;
  parent_chunk_id?: ID;
  metadata: Record<string, string | number | boolean>;
  tags: string[];
  excluded_from_retrieval: boolean;
}

/** §12.5 Citation — 每個知識性 claim 都要能追溯 */
export interface Citation {
  chunk_id: ID;
  document_id: ID;
  document_name: string;
  document_version: number;
  page?: number;
  section?: string;
  similarity: number;
  rerank_score?: number;
  snippet: string;
}

// ---------- Question Bank ----------
export type QuestionType =
  | 'multiple_choice' | 'true_false' | 'short_answer' | 'open_ended'
  | 'scenario' | 'voice_response' | 'role_play' | 'compliance'
  | 'objection_handling' | 'knowledge_check';

export interface Question extends TenantScoped {
  title: string;
  type: QuestionType;
  prompt: string;
  knowledge_base_id?: ID;
  category?: string;
  skill?: SkillKey;
  difficulty: Difficulty;
  correct_answer?: string;
  rubric?: string;
  required_keywords: string[];
  forbidden_claims: string[];
  compliance_rules: string[];
  explanation?: string;
  tags: string[];
  version: number;
  status: ContentStatus;
  /** AI 生成題目必須帶來源與審核紀錄（§15） */
  generated_by_model?: string;
  citations?: Citation[];
  reviewer_id?: ID;
  reviewed_at?: ISODateTime;
}

// ---------- Persona / Scenario ----------
export interface Persona extends TenantScoped {
  name: string;
  version: number;
  status: ContentStatus;
  age?: number;
  occupation?: string;
  industry?: string;
  background?: string;
  language: string;
  locale: string;
  traits: PersonaTraits;
  /** 只有 coach/admin 可讀（§16.3） */
  hidden?: PersonaHiddenState;
  voice: PersonaVoiceConfig;
  avatar_url?: string;
  /**
   * Presentation gender — chooses the 3D avatar body (male / female suit).
   * Optional: older rows have none, and the web falls back to a name / voice
   * heuristic (`features/avatar/lib/persona-gender.ts`).
   */
  gender?: PersonaGender;
}

export type PersonaGender = 'male' | 'female' | 'other';

export interface PersonaVoiceConfig {
  provider: 'openai' | 'elevenlabs' | 'none';
  voice_id?: string;
  language: string;
  speed: number;
  stability?: number;
  emotion_style?: string;
}

export interface Scenario extends TenantScoped {
  name: string;
  version: number;
  status: ContentStatus;
  description?: string;
  industry?: string;
  training_type?: string;
  persona_id: ID;
  knowledge_base_ids: ID[];
  difficulty: Difficulty;
  mode: SessionMode;
  opening_context: string;
  learning_objectives: string[];
  required_knowledge: string[];
  required_talking_points: string[];
  key_objections: string[];
  restricted_topics: string[];
  success_condition: string;
  failure_condition: string;
  time_limit_seconds?: number;
  max_turns?: number;
  minimum_score?: number;
  rubric_id?: ID;
}

// ---------- Evaluation ----------
/** §26.1 十個評估維度 */
export const SKILL_KEYS = [
  'professional_knowledge', 'empathy', 'needs_discovery', 'communication_clarity',
  'objection_handling', 'trust_building', 'product_knowledge', 'compliance',
  'closing_ability', 'goal_achievement',
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

export interface Rubric extends TenantScoped {
  name: string;
  version: number;
  status: ContentStatus;
  weights: Record<SkillKey, number>;
  pass_threshold: number;
  custom_skills?: Array<{ key: string; label: string; weight: number }>;
  required_evidence: string[];
  forbidden_behaviors: string[];
}

/** §27 Evidence-based Scoring — 禁止只給分數不給證據 */
export interface EvaluationEvidence {
  timestamp_ms: number;
  transcript_turn_ids: ID[];
  quote: string;
  issue?: string;
  better_approach?: string;
}

export interface SkillScore {
  skill: SkillKey | string;
  score: number;
  confidence: number;
  rubric_note?: string;
  evidence: EvaluationEvidence[];
  improvement_suggestion?: string;
}

export interface Evaluation {
  id: ID;
  session_id: ID;
  rubric_id: ID;
  overall_score: number;
  goal_achieved: boolean;
  passed: boolean;
  skills: SkillScore[];
  key_strength: string;
  main_improvement: string;
  compliance_status: ComplianceRisk;
  /** §28 Rubric Calibration */
  human_override?: { reviewer_id: ID; score: number; note?: string; at: ISODateTime };
  created_at: ISODateTime;
}

/** §32 Compliance Report */
export type ComplianceFindingType =
  | 'false_promise' | 'misleading_statement' | 'unsupported_claim' | 'privacy_issue'
  | 'unauthorized_advice' | 'sensitive_information' | 'missing_disclosure'
  | 'prompt_injection' | 'restricted_topic';

export interface ComplianceFinding {
  id: ID;
  session_id: ID;
  type: ComplianceFindingType;
  severity: ComplianceRisk;
  timestamp_ms: number;
  transcript_turn_id?: ID;
  evidence: string;
  policy_rule?: string;
  explanation: string;
  suggested_correction?: string;
  reviewer_status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
}

// ---------- Session ----------
export type SpeakerKind = 'trainee' | 'persona' | 'coach' | 'system' | 'compliance' | 'knowledge';

export interface TranscriptTurn {
  id: ID;
  session_id: ID;
  speaker: SpeakerKind;
  text: string;
  timestamp_ms: number;
  audio_url?: string;
  intent?: string;
  citations?: Citation[];
  /** 這一輪造成的 persona state 變化，供 timeline 標記（§31） */
  state_delta?: Partial<PersonaSimulationState>;
  score_event?: { skill: SkillKey; delta: number };
}

export interface CoachInsight {
  id: ID;
  session_id: ID;
  timestamp_ms: number;
  kind: 'hint' | 'missed_signal' | 'next_strategy' | 'post_session';
  title: string;
  body: string;
  /** Assessment Mode 下不得下發 hint / next_strategy（§8.4 / §24） */
  allowed_in_assessment: boolean;
  /**
   * 學員主動要求的（「詢問教練」或皺眉提示卡），而不是教練每輪主動給的。
   * 教練設為不主動時，只有這種會顯示——按了按鈕卻沒反應是最糟的行為。
   */
  requested?: boolean;
}

export interface TrainingSession {
  session_id: ID;
  tenant_id: ID;
  workspace_id: ID;
  user_id: ID;
  scenario_id: ID;
  /** version pinning — 報告必須可重現（§54） */
  scenario_version: number;
  persona_id: ID;
  persona_version: number;
  mode: SessionMode;
  status: SessionState;
  started_at: ISODateTime;
  ended_at?: ISODateTime;
  runtime: 'webgpu' | 'wasm' | 'server';
  voice_enabled: boolean;
  score_live_enabled: boolean;
  turn_count: number;
}

// ---------- Assignment / Analytics ----------
export interface Assignment extends TenantScoped {
  scenario_id: ID;
  assignee_user_ids: ID[];
  assignee_team_ids: ID[];
  deadline?: ISODateTime;
  max_attempts?: number;
  minimum_score: number;
  mandatory: boolean;
  prerequisite_assignment_id?: ID;
  mode: SessionMode;
}

export interface SkillProfile {
  user_id: ID;
  overall_score: number;
  skills: Record<SkillKey, number>;
  weakest_skill: SkillKey;
  strongest_skill: SkillKey;
  monthly_improvement: number;
  completed_sessions: number;
  compliance_trend: number[];
  days_to_readiness?: number;
}

export interface Recommendation {
  next_scenario_id?: ID;
  retry_scenario_id?: ID;
  knowledge_material: Array<{ document_id: ID; reason: string }>;
  question_set_ids: ID[];
  weak_skills: SkillKey[];
  suggested_difficulty: Difficulty;
}

// ---------- Audit ----------
export interface AuditEvent {
  id: ID;
  tenant_id: ID;
  workspace_id?: ID;
  at: ISODateTime;
  user_id?: ID;
  action: string;
  resource: string;
  ip?: string;
  session_ref?: string;
  result: 'success' | 'denied' | 'error';
  risk: ComplianceRisk;
}
