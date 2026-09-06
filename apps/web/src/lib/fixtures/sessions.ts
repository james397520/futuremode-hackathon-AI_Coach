import type {
  CoachInsight,
  PersonaSimulationState,
  TranscriptTurn,
  TrainingSession,
} from '@ai-coach/shared';
import { SCOPE, daysAgo, minutesAgo } from './constants';
import { MOCK_CITATIONS } from './knowledge';

export const DEMO_SESSION_ID = 'ses_1207';

export const MOCK_SESSIONS: TrainingSession[] = [
  {
    session_id: DEMO_SESSION_ID,
    ...SCOPE,
    user_id: 'usr_chang',
    scenario_id: 'scn_already_insured',
    scenario_version: 6,
    persona_id: 'per_chen',
    persona_version: 4,
    mode: 'training',
    status: 'completed',
    started_at: minutesAgo(96),
    ended_at: minutesAgo(82),
    runtime: 'webgpu',
    voice_enabled: true,
    score_live_enabled: true,
    turn_count: 24,
  },
  {
    session_id: 'ses_1206',
    ...SCOPE,
    user_id: 'usr_hsu',
    scenario_id: 'scn_needs_discovery',
    scenario_version: 3,
    persona_id: 'per_bank_walkin',
    persona_version: 3,
    mode: 'training',
    status: 'completed',
    started_at: daysAgo(0, 5),
    ended_at: daysAgo(0, 4),
    runtime: 'wasm',
    voice_enabled: false,
    score_live_enabled: true,
    turn_count: 18,
  },
  {
    session_id: 'ses_1205',
    ...SCOPE,
    user_id: 'usr_kuo',
    scenario_id: 'scn_compliance_assessment',
    scenario_version: 2,
    persona_id: 'per_lady_wu',
    persona_version: 2,
    mode: 'assessment',
    status: 'completed',
    started_at: daysAgo(1),
    ended_at: daysAgo(1),
    runtime: 'server',
    voice_enabled: true,
    score_live_enabled: false,
    turn_count: 21,
  },
  {
    session_id: 'ses_1204',
    ...SCOPE,
    user_id: 'usr_kuo',
    scenario_id: 'scn_already_insured',
    scenario_version: 6,
    persona_id: 'per_chen',
    persona_version: 4,
    mode: 'training',
    status: 'completed',
    started_at: daysAgo(2),
    ended_at: daysAgo(2),
    runtime: 'server',
    voice_enabled: false,
    score_live_enabled: true,
    turn_count: 31,
  },
  {
    session_id: 'ses_1203',
    ...SCOPE,
    user_id: 'usr_chang',
    scenario_id: 'scn_needs_discovery',
    scenario_version: 3,
    persona_id: 'per_bank_walkin',
    persona_version: 3,
    mode: 'training',
    status: 'error',
    started_at: daysAgo(3),
    ended_at: daysAgo(3),
    runtime: 'wasm',
    voice_enabled: true,
    score_live_enabled: true,
    turn_count: 4,
  },
];

/**
 * §25 Part I — the transcript is a *document*, not a chat. Each turn carries the
 * speaker, timestamp, optional intent, citations, persona state delta and score
 * event so the review surfaces can annotate it without inventing data.
 */
export const MOCK_TRANSCRIPT: TranscriptTurn[] = [
  {
    id: 'trn_01',
    session_id: DEMO_SESSION_ID,
    speaker: 'system',
    text: '模擬開始 · 情境：週三晚間視訊約訪 · 客戶：陳先生（38 歲工程師）· 模式：訓練',
    timestamp_ms: 0,
  },
  {
    id: 'trn_02',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '不好意思，我時間有點趕。你上次說要幫我看保單，可是我已經有保險了，為什麼還要多買？',
    timestamp_ms: 4_000,
    intent: 'objection_already_insured',
    state_delta: { scenario_phase: 'opening', emotion: 'skeptical', resistance: 68 },
  },
  {
    id: 'trn_03',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text: '了解，那我先跟你介紹我們新的重大疾病主約，保障範圍比舊的完整很多。',
    timestamp_ms: 12_500,
    intent: 'product_pitch',
    score_event: { skill: 'needs_discovery', delta: -6 },
    state_delta: { resistance: 74, trust: 34, emotion: 'skeptical' },
  },
  {
    id: 'trn_04',
    session_id: DEMO_SESSION_ID,
    speaker: 'coach',
    text: '客戶剛提出的是「必要性」的疑問，不是「商品」的疑問。先確認他現有保障的內容，再談新商品。',
    timestamp_ms: 13_200,
  },
  {
    id: 'trn_05',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '等一下，我的意思是我公司有團保，也有一張以前買的儲蓄型。你要說的是哪裡不夠？',
    timestamp_ms: 20_400,
    intent: 'clarification_request',
    state_delta: { emotion: 'skeptical', patience: 52, scenario_phase: 'needs_discovery' },
  },
  {
    id: 'trn_06',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text:
      '那我先確認一下，你的團保保額大概是年薪的幾倍？另外，房貸還有多少年？我想先把數字算出來，再看要不要調整。',
    timestamp_ms: 31_800,
    intent: 'needs_discovery',
    score_event: { skill: 'needs_discovery', delta: 12 },
    state_delta: { trust: 46, interest: 55, resistance: 62 },
  },
  {
    id: 'trn_07',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '團保我記得是兩倍年薪。房貸還有 620 萬，大概 18 年。',
    timestamp_ms: 41_000,
    intent: 'information_sharing',
    state_delta: { trust: 52, interest: 61 },
  },
  {
    id: 'trn_08',
    session_id: DEMO_SESSION_ID,
    speaker: 'knowledge',
    text: '引用商品 SOP v3 §3.3：團保保額通常為年薪之一至二倍，且不含重大疾病一次金。',
    timestamp_ms: 42_100,
    citations: MOCK_CITATIONS.slice(0, 2),
  },
  {
    id: 'trn_09',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text:
      '所以團保這部分大約 180 萬，而且離職就終止。你的房貸 620 萬加上家庭三年必要支出，缺口大概是 700 萬出頭。這個數字你看合理嗎？',
    timestamp_ms: 58_600,
    intent: 'gap_explanation',
    citations: [MOCK_CITATIONS[1]!],
    score_event: { skill: 'professional_knowledge', delta: 14 },
    state_delta: { trust: 63, interest: 72, resistance: 48, hidden_need_revealed: false },
  },
  {
    id: 'trn_10',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '……說實話，我最近其實壓力滿大的。小孩才三歲跟六歲，我不太敢想那種事。',
    timestamp_ms: 71_200,
    intent: 'emotional_disclosure',
    state_delta: { emotion: 'interested', trust: 66, hidden_need_revealed: true },
  },
  {
    id: 'trn_11',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text: '了解，那我先跟你說明這個方案的保障內容。',
    timestamp_ms: 79_900,
    intent: 'product_pitch',
    score_event: { skill: 'empathy', delta: -11 },
    state_delta: { emotion: 'skeptical', patience: 38, trust: 58 },
  },
  {
    id: 'trn_12',
    session_id: DEMO_SESSION_ID,
    speaker: 'coach',
    text: '你跳過了客戶的情緒訊號。先承接壓力，再回到保障需求。',
    timestamp_ms: 80_400,
  },
  {
    id: 'trn_13',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '嗯。那保費呢？我先聽數字。',
    timestamp_ms: 88_000,
    intent: 'price_objection',
    state_delta: { scenario_phase: 'objection_handling', emotion: 'skeptical', resistance: 58 },
  },
  {
    id: 'trn_14',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text:
      '以你的年齡跟 300 萬保額，年繳大約在 3 萬 8 到 4 萬 3 之間，實際要看職業等級。我不會叫你一次補到 700 萬，我們可以先補最急的那一段。',
    timestamp_ms: 104_500,
    intent: 'premium_explanation',
    citations: [MOCK_CITATIONS[2]!],
    score_event: { skill: 'objection_handling', delta: 9 },
    state_delta: { trust: 64, interest: 70, resistance: 44 },
  },
  {
    id: 'trn_15',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '那如果我真的中間出事，這個一定會賠吧？',
    timestamp_ms: 116_300,
    intent: 'guarantee_probe',
    state_delta: { emotion: 'curious', compliance_risk: 'medium' },
  },
  {
    id: 'trn_16',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text: '基本上都會賠啦，我做這麼久沒看過拒賠的。',
    timestamp_ms: 121_800,
    intent: 'guarantee_claim',
    score_event: { skill: 'compliance', delta: -22 },
    state_delta: { compliance_risk: 'high' },
  },
  {
    id: 'trn_17',
    session_id: DEMO_SESSION_ID,
    speaker: 'compliance',
    text:
      '合規警示 · 不實承諾：「基本上都會賠」暗示必然理賠。應說明等待期與除外責任。政策：CP-2026-11。',
    timestamp_ms: 122_100,
  },
  {
    id: 'trn_18',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text:
      '抱歉，我要修正一下：有等待期九十天，也有除外責任，我等等把條款那一頁給你看，不能說一定賠。',
    timestamp_ms: 136_400,
    intent: 'compliance_correction',
    citations: [MOCK_CITATIONS[0]!],
    score_event: { skill: 'compliance', delta: 10 },
    state_delta: { compliance_risk: 'low', trust: 68 },
  },
  {
    id: 'trn_19',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '好，那你把那一頁跟缺口的算法寄給我，我跟太太討論一下。',
    timestamp_ms: 149_000,
    intent: 'soft_commitment',
    state_delta: { scenario_phase: 'closing', emotion: 'reassured', trust: 72, interest: 76 },
  },
  {
    id: 'trn_20',
    session_id: DEMO_SESSION_ID,
    speaker: 'trainee',
    text: '沒問題，我今天晚上寄給你，週五我再打給你確認，這樣可以嗎？',
    timestamp_ms: 157_300,
    intent: 'next_step',
    score_event: { skill: 'closing_ability', delta: 8 },
    state_delta: { trust: 74, scenario_phase: 'closing' },
  },
  {
    id: 'trn_21',
    session_id: DEMO_SESSION_ID,
    speaker: 'persona',
    text: '可以。謝謝。',
    timestamp_ms: 162_000,
    state_delta: { scenario_phase: 'ended', emotion: 'ready', trust: 74 },
  },
  {
    id: 'trn_22',
    session_id: DEMO_SESSION_ID,
    speaker: 'system',
    text: '模擬結束 · 24 個回合 · 14 分 12 秒 · 評估中',
    timestamp_ms: 166_000,
  },
];

/** §20 / §22 — the persona state at end of session (drives the right column). */
export const DEMO_PERSONA_STATE: PersonaSimulationState = {
  scenario_phase: 'ended',
  emotion: 'ready',
  trust: 74,
  interest: 76,
  resistance: 41,
  patience: 48,
  intent: 'soft_commitment',
  current_goal: 'discuss_with_spouse',
  budget: 4500,
  hidden_need_revealed: true,
  compliance_risk: 'low',
  time_pressure: 62,
};

/** §40 Emotion / State timeline — derived from `state_delta`, never from faces. */
export interface StateTimelinePoint {
  at_ms: number;
  turn_id: string;
  emotion: PersonaSimulationState['emotion'];
  phase: PersonaSimulationState['scenario_phase'];
  trust: number;
  resistance: number;
  marker?: 'key_response' | 'missed_signal' | 'compliance_warning' | 'state_change';
  note?: string;
}

export const DEMO_STATE_TIMELINE: StateTimelinePoint[] = [
  { at_ms: 4_000, turn_id: 'trn_02', emotion: 'skeptical', phase: 'opening', trust: 38, resistance: 68, marker: 'state_change', note: '開場異議' },
  { at_ms: 13_200, turn_id: 'trn_03', emotion: 'skeptical', phase: 'opening', trust: 34, resistance: 74, marker: 'missed_signal', note: '探索前就先推商品' },
  { at_ms: 31_800, turn_id: 'trn_06', emotion: 'curious', phase: 'needs_discovery', trust: 46, resistance: 62, marker: 'key_response', note: '轉向保障缺口的數字' },
  { at_ms: 58_600, turn_id: 'trn_09', emotion: 'interested', phase: 'presentation', trust: 63, resistance: 48, marker: 'key_response', note: '量化了保障缺口' },
  { at_ms: 71_200, turn_id: 'trn_10', emotion: 'interested', phase: 'presentation', trust: 66, resistance: 46, marker: 'state_change', note: '隱藏需求浮現' },
  { at_ms: 79_900, turn_id: 'trn_11', emotion: 'skeptical', phase: 'presentation', trust: 58, resistance: 52, marker: 'missed_signal', note: '略過了情緒訊號' },
  { at_ms: 121_800, turn_id: 'trn_16', emotion: 'curious', phase: 'objection_handling', trust: 60, resistance: 50, marker: 'compliance_warning', note: '暗示保證給付' },
  { at_ms: 136_400, turn_id: 'trn_18', emotion: 'reassured', phase: 'objection_handling', trust: 68, resistance: 44, marker: 'key_response', note: '引用條款自我修正' },
  { at_ms: 162_000, turn_id: 'trn_21', emotion: 'ready', phase: 'ended', trust: 74, resistance: 41, marker: 'state_change', note: '同意後續約訪' },
];

/** §23 AI Coach card + §29 post-session insights. */
export const MOCK_COACH_INSIGHTS: CoachInsight[] = [
  {
    id: 'ins_01',
    session_id: DEMO_SESSION_ID,
    timestamp_ms: 13_200,
    kind: 'missed_signal',
    title: '「為什麼需要」的問題被商品推介帶過',
    body: '客戶問的是「為什麼需要」，不是「有什麼商品」。先盤點現有保障，再帶到差異。',
    allowed_in_assessment: false,
  },
  {
    id: 'ins_02',
    session_id: DEMO_SESSION_ID,
    timestamp_ms: 80_400,
    kind: 'missed_signal',
    title: '略過了情緒訊號',
    body: '「壓力滿大」是最關鍵的一句話。承接它，再回到保障需求，信任分數會直接反映。',
    allowed_in_assessment: false,
  },
  {
    id: 'ins_03',
    session_id: DEMO_SESSION_ID,
    timestamp_ms: 116_300,
    kind: 'next_strategy',
    title: '客戶即將試探「保證」',
    body: '客戶正在測試你會不會給出保證。用等待期與除外責任回應，比模糊帶過更能建立信任。',
    allowed_in_assessment: false,
  },
  {
    id: 'ins_04',
    session_id: DEMO_SESSION_ID,
    timestamp_ms: 166_000,
    kind: 'post_session',
    title: '最強的一回合：保障缺口的換算',
    body:
      '你在第 9 輪把 620 萬房貸換算成保障缺口，那是整場信任上升最快的一刻。下一次把這一步提前到第 4 輪之前。',
    allowed_in_assessment: true,
  },
  {
    id: 'ins_05',
    session_id: DEMO_SESSION_ID,
    timestamp_ms: 166_100,
    kind: 'post_session',
    title: '合規失誤後要更快回穩',
    body: '你自我修正得很好，但中間隔了 14 秒。合規修正越即時，客戶越不會記住那句錯話。',
    allowed_in_assessment: true,
  },
];

export function sessionById(id: string): TrainingSession | undefined {
  return MOCK_SESSIONS.find((session) => session.session_id === id);
}

export function transcriptTurnById(id: string): TranscriptTurn | undefined {
  return MOCK_TRANSCRIPT.find((turn) => turn.id === id);
}
