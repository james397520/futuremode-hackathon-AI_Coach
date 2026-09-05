import type {
  Chunk,
  Citation,
  KnowledgeBase,
  KnowledgeDocument,
} from '@ai-coach/shared';
import { SCOPE, daysAgo, minutesAgo } from './constants';

export const MOCK_KNOWLEDGE_BASES: KnowledgeBase[] = [
  {
    id: 'kb_product_sop',
    ...SCOPE,
    name: '商品 SOP 與商品條款',
    description: '壽險、重疾、醫療三大主約與附約的核保與話術 SOP，含 2026 保費級距表。',
    status: 'published',
    document_count: 128,
    chunk_count: 4820,
    embedding_model: 'text-embedding-3-large',
    acl: {
      scope: 'workspace',
      subject_ids: ['ws_life_apac'],
      permissions: ['view', 'use_for_rag', 'edit', 'review', 'publish', 'export'],
    },
    created_at: daysAgo(410),
    updated_at: minutesAgo(12),
  },
  {
    id: 'kb_compliance',
    ...SCOPE,
    name: '2026 合規政策',
    description: '主管機關規範、禁用話術清單、除外責任揭露標準、客訴案例。',
    status: 'published',
    document_count: 43,
    chunk_count: 1164,
    embedding_model: 'text-embedding-3-large',
    acl: {
      scope: 'role',
      subject_ids: ['coach', 'manager', 'admin', 'reviewer'],
      permissions: ['view', 'use_for_rag', 'review', 'publish'],
    },
    created_at: daysAgo(300),
    updated_at: daysAgo(6),
  },
  {
    id: 'kb_playbook',
    ...SCOPE,
    name: '頂尖業務話術手冊',
    description: '由知識探勘產出的黃金話術與異議模式，需人工覆核後才會發布。',
    status: 'review_required',
    document_count: 19,
    chunk_count: 402,
    embedding_model: 'text-embedding-3-large',
    acl: {
      scope: 'team',
      subject_ids: ['team_taipei_north', 'team_taichung'],
      permissions: ['view', 'use_for_rag', 'review'],
    },
    created_at: daysAgo(64),
    updated_at: daysAgo(2),
  },
  {
    id: 'kb_onboarding',
    ...SCOPE,
    name: '新人業務員入門',
    description: '新人 30 天訓練教材與內部術語表。',
    status: 'draft',
    document_count: 7,
    chunk_count: 88,
    embedding_model: 'text-embedding-3-small',
    acl: {
      scope: 'department',
      subject_ids: ['直營通路'],
      permissions: ['view', 'edit'],
    },
    created_at: daysAgo(18),
    updated_at: daysAgo(1),
  },
];

export const MOCK_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'doc_sop_v3',
    ...SCOPE,
    knowledge_base_id: 'kb_product_sop',
    filename: '商品SOP-v3.pdf',
    source_kind: 'pdf',
    size_bytes: 8_412_160,
    state: 'ready',
    progress: 100,
    active_version: 3,
    created_at: daysAgo(190),
    updated_at: daysAgo(9),
  },
  {
    id: 'doc_premium_2026',
    ...SCOPE,
    knowledge_base_id: 'kb_product_sop',
    filename: '2026保費級距表.csv',
    source_kind: 'csv',
    size_bytes: 264_120,
    state: 'ready',
    progress: 100,
    active_version: 2,
    created_at: daysAgo(40),
    updated_at: daysAgo(5),
  },
  {
    id: 'doc_ci_definitions',
    ...SCOPE,
    knowledge_base_id: 'kb_product_sop',
    filename: '重大疾病定義-2026.docx',
    source_kind: 'docx',
    size_bytes: 1_884_400,
    state: 'embedding',
    progress: 68,
    active_version: 1,
    created_at: minutesAgo(22),
    updated_at: minutesAgo(2),
  },
  {
    id: 'doc_group_vs_personal',
    ...SCOPE,
    knowledge_base_id: 'kb_product_sop',
    filename: '團保與個人保單比較.pptx',
    source_kind: 'pptx',
    size_bytes: 5_120_000,
    state: 'parsing',
    progress: 34,
    active_version: 1,
    created_at: minutesAgo(6),
    updated_at: minutesAgo(1),
  },
  {
    id: 'doc_scanned_claims',
    ...SCOPE,
    knowledge_base_id: 'kb_product_sop',
    filename: '理賠案例彙編-掃描版.pdf',
    source_kind: 'pdf',
    size_bytes: 41_902_080,
    state: 'failed',
    progress: 41,
    active_version: 1,
    failure_reason:
      'OCR 信心值在 27 頁上低於門檻（含手寫註記）。請改用高精度 OCR 設定重跑，或上傳清晰的掃描檔。',
    created_at: daysAgo(2),
    updated_at: daysAgo(2),
  },
  {
    id: 'doc_forbidden_phrases',
    ...SCOPE,
    knowledge_base_id: 'kb_compliance',
    filename: '禁用話術清單-2026.txt',
    source_kind: 'txt',
    size_bytes: 18_240,
    state: 'ready',
    progress: 100,
    active_version: 5,
    created_at: daysAgo(280),
    updated_at: daysAgo(6),
  },
  {
    id: 'doc_regulator_circular',
    ...SCOPE,
    knowledge_base_id: 'kb_compliance',
    filename: '主管機關函令-2026-04.pdf',
    source_kind: 'pdf',
    size_bytes: 962_000,
    state: 'indexing',
    progress: 88,
    active_version: 1,
    created_at: minutesAgo(48),
    updated_at: minutesAgo(3),
  },
  {
    id: 'doc_top_transcripts',
    ...SCOPE,
    knowledge_base_id: 'kb_playbook',
    filename: '頂尖業務逐字稿-Q1.csv',
    source_kind: 'csv',
    size_bytes: 3_204_000,
    state: 'ready',
    progress: 100,
    active_version: 1,
    created_at: daysAgo(30),
    updated_at: daysAgo(2),
  },
];

/** §29 Document Processing Visual — the pipeline steps, in DOCUMENT_STATES order. */
export const DOCUMENT_PIPELINE_STEPS = [
  { state: 'validating', label: '檔案驗證' },
  { state: 'parsing', label: '文字擷取' },
  { state: 'chunking', label: '結構辨識與切片' },
  { state: 'embedding', label: '向量化' },
  { state: 'indexing', label: '建立索引' },
  { state: 'ready', label: '可供檢索' },
] as const;

export const MOCK_CHUNKS: Chunk[] = [
  {
    id: 'chk_0182',
    document_id: 'doc_sop_v3',
    document_version: 3,
    index: 182,
    text:
      '重大疾病保險金之給付，以被保險人於等待期屆滿後首次經診斷確定罹患本契約約定之重大疾病為限。等待期為契約生效日起算九十日。團體保險之保障於被保險人離職或契約終止時同時終止，不具持續性。',
    token_count: 168,
    page: 12,
    section: '3.2 重大疾病定義與等待期',
    metadata: { product_line: 'critical_illness', jurisdiction: 'TW', reviewed: true },
    tags: ['critical_illness', 'waiting_period', 'group_cover'],
    excluded_from_retrieval: false,
  },
  {
    id: 'chk_0183',
    document_id: 'doc_sop_v3',
    document_version: 3,
    index: 183,
    text:
      '團體保險與個人保險之比較：團保保額通常為年薪之一至二倍，且不含重大疾病一次金；個人保單可依家庭負債與必要支出設定保額，並於離職後持續有效。',
    token_count: 132,
    page: 13,
    section: '3.3 團保與個人保單比較',
    parent_chunk_id: 'chk_0182',
    metadata: { product_line: 'critical_illness', jurisdiction: 'TW', reviewed: true },
    tags: ['group_cover', 'comparison'],
    excluded_from_retrieval: false,
  },
  {
    id: 'chk_0411',
    document_id: 'doc_premium_2026',
    document_version: 2,
    index: 411,
    text:
      '38 歲男性、非吸菸、保額 300 萬之重大疾病主約，年繳保費區間為 38,400 – 42,900 元（依職業等級與體位加費）。月繳係數 0.088。',
    token_count: 96,
    page: 4,
    section: '保費級距表 — 重大疾病主約',
    metadata: { product_line: 'critical_illness', table: true, reviewed: true },
    tags: ['premium', 'table_aware'],
    excluded_from_retrieval: false,
  },
  {
    id: 'chk_0904',
    document_id: 'doc_forbidden_phrases',
    document_version: 5,
    index: 904,
    text:
      '禁用話術：「保證獲利」「一定賠」「穩賺不賠」「絕對不會拒賠」。任何暗示保證報酬或必然理賠之表述皆屬不實招攬。',
    token_count: 74,
    section: '禁用話術清單',
    metadata: { policy_rule: 'CP-2026-11', reviewed: true },
    tags: ['compliance', 'forbidden'],
    excluded_from_retrieval: false,
  },
  {
    id: 'chk_1022',
    document_id: 'doc_sop_v3',
    document_version: 2,
    index: 1022,
    text: '（舊版 v2 內容，已由 v3 第 3.2 節取代，保留供稽核追溯。）',
    token_count: 42,
    page: 11,
    section: '已淘汰 — v2 第 3.2 節',
    metadata: { deprecated: true, reviewed: true },
    tags: ['deprecated'],
    excluded_from_retrieval: true,
  },
  {
    id: 'chk_1310',
    document_id: 'doc_top_transcripts',
    document_version: 1,
    index: 1310,
    text:
      '（頂尖業務，已去識別化）「我不是要你多買一張保單，是想確認萬一你三個月不能工作，房貸誰付。我們先把這個數字算出來，再談要不要調整。」',
    token_count: 88,
    section: '異議：我已經有保險了',
    metadata: { anonymised: true, reviewed: false },
    tags: ['golden_phrase', 'objection_already_insured'],
    excluded_from_retrieval: false,
  },
];

/** §12.5 / §31 — retrieval playground results for the demo query. */
export const MOCK_CITATIONS: Citation[] = [
  {
    chunk_id: 'chk_0182',
    document_id: 'doc_sop_v3',
    document_name: '商品 SOP v3',
    document_version: 3,
    page: 12,
    section: '3.2 重大疾病定義與等待期',
    similarity: 0.91,
    rerank_score: 0.97,
    snippet:
      '團體保險之保障於被保險人離職或契約終止時同時終止，不具持續性。等待期為契約生效日起算九十日。',
  },
  {
    chunk_id: 'chk_0183',
    document_id: 'doc_sop_v3',
    document_name: '商品 SOP v3',
    document_version: 3,
    page: 13,
    section: '3.3 團保與個人保單比較',
    similarity: 0.88,
    rerank_score: 0.94,
    snippet: '團保保額通常為年薪之一至二倍，且不含重大疾病一次金。',
  },
  {
    chunk_id: 'chk_0411',
    document_id: 'doc_premium_2026',
    document_name: '2026 保費級距表',
    document_version: 2,
    page: 4,
    section: '保費級距表 — 重大疾病主約',
    similarity: 0.79,
    rerank_score: 0.86,
    snippet: '38 歲男性、非吸菸、保額 300 萬之重大疾病主約，年繳保費區間為 38,400 – 42,900 元。',
  },
  {
    chunk_id: 'chk_0904',
    document_id: 'doc_forbidden_phrases',
    document_name: '禁用話術清單 2026',
    document_version: 5,
    section: '禁用話術清單',
    similarity: 0.74,
    rerank_score: 0.62,
    snippet: '禁用話術：「保證獲利」「一定賠」「穩賺不賠」。',
  },
  {
    chunk_id: 'chk_1310',
    document_id: 'doc_top_transcripts',
    document_name: '頂尖業務逐字稿 Q1',
    document_version: 1,
    section: '異議：我已經有保險了',
    similarity: 0.72,
    rerank_score: 0.41,
    snippet: '「我不是要你多買一張保單，是想確認萬一你三個月不能工作，房貸誰付。」',
  },
];

export const RETRIEVAL_DEFAULTS = {
  top_k: 5,
  threshold: 0.72,
  hybrid: true,
  rerank: true,
} as const;

export const DEMO_RETRIEVAL_QUERY = '客戶說已經有公司團保了，個人保單還有必要嗎？';

/* ───────────────────────────── §13 Knowledge Mining ─────────────────────── */

export type MiningKind =
  | 'golden_phrase'
  | 'objection_pattern'
  | 'best_practice'
  | 'anti_pattern'
  | 'rubric_evidence'
  | 'scenario_seed';

export interface MiningCandidate {
  id: string;
  kind: MiningKind;
  title: string;
  extract: string;
  source_label: string;
  source_session_ref: string;
  anonymised: boolean;
  confidence: number;
  occurrences: number;
  suggested_target: string;
  status: 'pending_review' | 'approved' | 'rejected';
}

export const MINING_KIND_LABEL: Record<MiningKind, string> = {
  golden_phrase: '黃金話術',
  objection_pattern: '異議模式',
  best_practice: '最佳實務',
  anti_pattern: '錯誤示範',
  rubric_evidence: '建議的評分佐證',
  scenario_seed: '情境素材',
};

/** Nothing here is usable until a human approves it (§13: human review required). */
export const MOCK_MINING_CANDIDATES: MiningCandidate[] = [
  {
    id: 'mine_001',
    kind: 'golden_phrase',
    title: '把「多買一張」翻轉成「誰付房貸」',
    extract:
      '「我不是要你多買一張保單，是想確認萬一你三個月不能工作，房貸誰付。我們先把這個數字算出來，再談要不要調整。」',
    source_label: '頂尖業務 — 台北北區',
    source_session_ref: '練習 #1187（已去識別化）',
    anonymised: true,
    confidence: 0.93,
    occurrences: 14,
    suggested_target: '頂尖業務話術手冊 → 異議：我已經有保險了',
    status: 'pending_review',
  },
  {
    id: 'mine_002',
    kind: 'objection_pattern',
    title: '團保萬能論',
    extract:
      '客戶在 62% 的已投保案例中以「公司團保已經夠了」作為第二層拒絕，通常出現在首次報價之後。',
    source_label: '彙整自 214 場練習',
    source_session_ref: '模式分群 #12',
    anonymised: true,
    confidence: 0.88,
    occurrences: 214,
    suggested_target: '客戶角色 陳先生 → 常見異議',
    status: 'pending_review',
  },
  {
    id: 'mine_003',
    kind: 'anti_pattern',
    title: '用「絕對」承諾理賠',
    extract: '「這個絕對不會拒賠啦，我做十年了。」',
    source_label: '被標記的練習 — 台中',
    source_session_ref: '練習 #1204',
    anonymised: true,
    confidence: 0.97,
    occurrences: 6,
    suggested_target: '2026 合規政策 → 禁用話術',
    status: 'pending_review',
  },
  {
    id: 'mine_004',
    kind: 'best_practice',
    title: '先算缺口再談保費',
    extract:
      '高分學員在報價前平均完成 4.2 項需求探索，低分組為 1.3 項；缺口數字先出現時，價格異議下降 41%。',
    source_label: '教練筆記＋練習數據分析',
    source_session_ref: '2026 第一季分析',
    anonymised: true,
    confidence: 0.81,
    occurrences: 96,
    suggested_target: '評分規準 壽險與健康險核心 → 需求探索佐證',
    status: 'approved',
  },
  {
    id: 'mine_005',
    kind: 'scenario_seed',
    title: '客戶親屬剛因病離世',
    extract:
      '客服升級紀錄中出現 11 次「客戶剛失去親人且情緒激動」的情境，現有情境尚未涵蓋。',
    source_label: '客服升級紀錄',
    source_session_ref: '升級案件分群 #4',
    anonymised: true,
    confidence: 0.76,
    occurrences: 11,
    suggested_target: '新情境草稿',
    status: 'pending_review',
  },
  {
    id: 'mine_006',
    kind: 'rubric_evidence',
    title: '同理心 — 承接情緒的具體句型',
    extract: '「你剛剛提到壓力很大，是工作上的還是家裡的？」— 出現此類回應時，同理心分數平均高 18 分。',
    source_label: '主管教練筆記',
    source_session_ref: '2026 年 2 月筆記',
    anonymised: true,
    confidence: 0.84,
    occurrences: 38,
    suggested_target: '評分規準 壽險與健康險核心 → 同理心必要佐證',
    status: 'rejected',
  },
];

/**
 * §26 "Knowledge readiness" — a knowledge-base level figure the API will supply.
 * It is deliberately NOT computed from whatever documents a page happens to have
 * loaded, or a view showing five recent uploads would contradict the base total.
 */
export function knowledgeReadiness(kb: KnowledgeBase): number {
  if (kb.status === 'published') return 96;
  if (kb.status === 'review_required') return 72;
  return 41;
}

export function knowledgeBaseById(id: string): KnowledgeBase | undefined {
  return MOCK_KNOWLEDGE_BASES.find((kb) => kb.id === id);
}

export function documentsForKb(kbId: string): KnowledgeDocument[] {
  return MOCK_DOCUMENTS.filter((doc) => doc.knowledge_base_id === kbId);
}

export function documentById(id: string): KnowledgeDocument | undefined {
  return MOCK_DOCUMENTS.find((doc) => doc.id === id);
}

export function chunksForDocument(documentId: string): Chunk[] {
  return MOCK_CHUNKS.filter((chunk) => chunk.document_id === documentId);
}
