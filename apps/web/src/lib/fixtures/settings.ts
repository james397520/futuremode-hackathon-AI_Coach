/** §44 Model / AI Runtime settings + §22.4 voice settings + §46 billing. */

export interface ModelSettingRow {
  id: string;
  label: string;
  value: string;
  options?: string[];
  note?: string;
  /** Free-text / numeric fields render as inputs, the rest as selects. */
  kind: 'select' | 'number' | 'text' | 'switch';
}

export interface ModelSettingGroup {
  id: string;
  title: string;
  description: string;
  rows: ModelSettingRow[];
}

export const MODEL_SETTING_GROUPS: ModelSettingGroup[] = [
  {
    id: 'llm',
    title: 'LLM',
    description: '驅動客戶、教練、評分與合規四個 AI 代理。',
    rows: [
      { id: 'llm_provider', label: '服務供應商', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure OpenAI', '自架（vLLM）'] },
      { id: 'llm_model', label: '模型', value: 'gpt-4.1', kind: 'select', options: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'] },
      { id: 'llm_temperature', label: '取樣溫度', value: '0.7', kind: 'number', note: '僅套用於客戶代理；評分代理固定為 0。' },
      { id: 'llm_max_tokens', label: '最大 token 數', value: '1200', kind: 'number' },
      { id: 'llm_timeout', label: '逾時（秒）', value: '30', kind: 'number' },
      { id: 'llm_routing', label: '路由策略', value: '延遲優先', kind: 'select', options: ['延遲優先', '成本優先', '品質優先'] },
      { id: 'llm_fallback', label: '備援模型', value: 'gpt-4.1-mini', kind: 'select', options: ['gpt-4.1-mini', 'o4-mini', '不使用'] },
    ],
  },
  {
    id: 'embedding',
    title: '向量化',
    description: '更換模型或維度後必須重新建立索引。',
    rows: [
      { id: 'emb_provider', label: '服務供應商', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure OpenAI', '自架（BGE-M3）'] },
      { id: 'emb_model', label: '模型', value: 'text-embedding-3-large', kind: 'select', options: ['text-embedding-3-large', 'text-embedding-3-small', 'bge-m3'] },
      { id: 'emb_dimension', label: '向量維度', value: '3072', kind: 'number', note: '更動此設定會觸發 6,474 筆向量的全量重建索引。' },
      { id: 'emb_batch', label: '批次大小', value: '64', kind: 'number' },
      { id: 'emb_vectordb', label: '向量資料庫', value: 'Qdrant', kind: 'select', options: ['Qdrant', 'ChromaDB', 'FAISS'] },
    ],
  },
  {
    id: 'reranker',
    title: '重排序',
    description: '在混合檢索之後、組裝上下文之前執行。',
    rows: [
      { id: 'rr_provider', label: '服務供應商', value: 'Cohere', kind: 'select', options: ['Cohere', '自架（bge-reranker）', '停用'] },
      { id: 'rr_model', label: '模型', value: 'rerank-multilingual-v3', kind: 'select', options: ['rerank-multilingual-v3', 'bge-reranker-v2-m3'] },
      { id: 'rr_topn', label: 'Top N', value: '5', kind: 'number' },
    ],
  },
  {
    id: 'speech',
    title: '語音',
    description: '語音練習使用的語音辨識與語音合成供應商。',
    rows: [
      { id: 'stt_provider', label: '語音辨識供應商', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure Speech', 'Deepgram'] },
      { id: 'tts_provider', label: '語音合成供應商', value: 'ElevenLabs', kind: 'select', options: ['ElevenLabs', 'OpenAI', 'Azure Speech'] },
      { id: 'tts_voice', label: '預設音色', value: 'zh-tw-male-mid', kind: 'select', options: ['zh-tw-male-mid', 'zh-tw-female-mature', 'en-male-brisk'] },
      { id: 'tts_language', label: '語言', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'zh-CN', 'en', 'ja'] },
    ],
  },
  {
    id: 'safety',
    title: '安全防護',
    description: '每一回合、雙向內容都在伺服器端強制執行。',
    rows: [
      { id: 'mod_provider', label: '內容審核供應商', value: 'OpenAI moderation', kind: 'select', options: ['OpenAI moderation', 'Azure Content Safety'] },
      { id: 'pii_policy', label: '個資處理政策', value: '寫入時遮蔽', kind: 'select', options: ['寫入時遮蔽', '顯示時遮蔽', '直接阻擋'] },
      { id: 'injection', label: '提示注入偵測', value: 'on', kind: 'switch' },
      { id: 'compliance_policy', label: '合規政策', value: '台灣保險 2026', kind: 'select', options: ['台灣保險 2026', '新加坡保險 2026', '自訂'] },
    ],
  },
];

export interface VoiceSetting {
  id: string;
  label: string;
  value: string;
  hint?: string;
  kind: 'select' | 'number' | 'switch' | 'slider';
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export const VOICE_SETTINGS: VoiceSetting[] = [
  { id: 'provider', label: '服務供應商', value: 'ElevenLabs', kind: 'select', options: ['ElevenLabs', 'OpenAI', 'Azure Speech'] },
  { id: 'language', label: '語言', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'zh-CN', 'en', 'ja'] },
  { id: 'voice', label: '音色', value: 'zh-tw-male-mid', kind: 'select', options: ['zh-tw-male-mid', 'zh-tw-female-mature', 'en-male-brisk'] },
  { id: 'speed', label: '語速', value: '1.02', kind: 'slider', min: 0.6, max: 1.6, step: 0.02, hint: '1.0 為供應商預設值' },
  { id: 'stability', label: '穩定度', value: '0.62', kind: 'slider', min: 0, max: 1, step: 0.02, hint: '數值越低越有情緒起伏，越高越一致' },
  { id: 'similarity', label: '相似度', value: '0.75', kind: 'slider', min: 0, max: 1, step: 0.05, hint: '僅 ElevenLabs 適用' },
  { id: 'emotion', label: '情緒風格', value: '沉穩、略帶戒心', kind: 'select', options: ['中性', '沉穩、略帶戒心', '親切、焦慮', '簡短、沒耐性'] },
  { id: 'interruptibility', label: '允許插話', value: 'on', kind: 'switch', hint: '學員可以打斷；語音合成會停止，練習回到聆聽狀態' },
  { id: 'silence_timeout', label: '靜音逾時（毫秒）', value: '1200', kind: 'number', hint: '以語音活動偵測判斷一回合結束' },
  { id: 'caption_language', label: '字幕語言', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'en', '關閉'] },
];

/** §46 Billing / Quota. */
export interface QuotaRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export const BILLING_PERIOD = { start: '2026-03-01', end: '2026-03-31', plan: '企業版 · 年繳' };

export const QUOTA_ROWS: QuotaRow[] = [
  { id: 'seats', label: '席次', used: 38, limit: 42, unit: '位' },
  { id: 'sim_minutes', label: '模擬練習分鐘數', used: 24_720, limit: 36_000, unit: '分鐘' },
  { id: 'voice_minutes', label: '語音分鐘數', used: 5_760, limit: 9_000, unit: '分鐘' },
  { id: 'storage', label: '文件儲存空間', used: 128, limit: 500, unit: 'GB' },
  { id: 'model_usage', label: '模型用量', used: 412, limit: 800, unit: '百萬 token' },
  { id: 'workspaces', label: '工作區', used: 3, limit: 5, unit: '個' },
];

export interface InvoiceRow {
  id: string;
  period: string;
  amount: string;
  status: 'paid' | 'due' | 'failed';
  issued: string;
}

export const INVOICES: InvoiceRow[] = [
  { id: 'inv_2026_03', period: '2026 年 3 月', amount: 'USD 6,480.00', status: 'due', issued: '2026-03-01' },
  { id: 'inv_2026_02', period: '2026 年 2 月', amount: 'USD 6,480.00', status: 'paid', issued: '2026-02-01' },
  { id: 'inv_2026_01', period: '2026 年 1 月', amount: 'USD 6,120.00', status: 'paid', issued: '2026-01-01' },
  { id: 'inv_2025_12', period: '2025 年 12 月', amount: 'USD 6,120.00', status: 'paid', issued: '2025-12-01' },
];
