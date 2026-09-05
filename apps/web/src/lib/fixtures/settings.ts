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
    description: 'Drives the customer, coach, evaluator and compliance agents.',
    rows: [
      { id: 'llm_provider', label: 'Provider', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure OpenAI', 'Self-hosted (vLLM)'] },
      { id: 'llm_model', label: 'Model', value: 'gpt-4.1', kind: 'select', options: ['gpt-4.1', 'gpt-4.1-mini', 'o4-mini'] },
      { id: 'llm_temperature', label: 'Temperature', value: '0.7', kind: 'number', note: 'Customer agent only; evaluator is pinned at 0.' },
      { id: 'llm_max_tokens', label: 'Max tokens', value: '1200', kind: 'number' },
      { id: 'llm_timeout', label: 'Timeout (s)', value: '30', kind: 'number' },
      { id: 'llm_routing', label: 'Routing', value: 'Latency-first', kind: 'select', options: ['Latency-first', 'Cost-first', 'Quality-first'] },
      { id: 'llm_fallback', label: 'Fallback model', value: 'gpt-4.1-mini', kind: 'select', options: ['gpt-4.1-mini', 'o4-mini', 'None'] },
    ],
  },
  {
    id: 'embedding',
    title: 'Embedding',
    description: 'Re-indexing is required when the model or dimension changes.',
    rows: [
      { id: 'emb_provider', label: 'Provider', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure OpenAI', 'Self-hosted (BGE-M3)'] },
      { id: 'emb_model', label: 'Model', value: 'text-embedding-3-large', kind: 'select', options: ['text-embedding-3-large', 'text-embedding-3-small', 'bge-m3'] },
      { id: 'emb_dimension', label: 'Dimension', value: '3072', kind: 'number', note: 'Changing this triggers a full re-index of 6,474 vectors.' },
      { id: 'emb_batch', label: 'Batch size', value: '64', kind: 'number' },
      { id: 'emb_vectordb', label: 'Vector DB', value: 'Qdrant', kind: 'select', options: ['Qdrant', 'ChromaDB', 'FAISS'] },
    ],
  },
  {
    id: 'reranker',
    title: 'Reranker',
    description: 'Applied after hybrid retrieval, before context assembly.',
    rows: [
      { id: 'rr_provider', label: 'Provider', value: 'Cohere', kind: 'select', options: ['Cohere', 'Self-hosted (bge-reranker)', 'Disabled'] },
      { id: 'rr_model', label: 'Model', value: 'rerank-multilingual-v3', kind: 'select', options: ['rerank-multilingual-v3', 'bge-reranker-v2-m3'] },
      { id: 'rr_topn', label: 'Top N', value: '5', kind: 'number' },
    ],
  },
  {
    id: 'speech',
    title: 'Speech',
    description: 'STT and TTS providers for voice simulations.',
    rows: [
      { id: 'stt_provider', label: 'STT provider', value: 'OpenAI', kind: 'select', options: ['OpenAI', 'Azure Speech', 'Deepgram'] },
      { id: 'tts_provider', label: 'TTS provider', value: 'ElevenLabs', kind: 'select', options: ['ElevenLabs', 'OpenAI', 'Azure Speech'] },
      { id: 'tts_voice', label: 'Default voice', value: 'zh-tw-male-mid', kind: 'select', options: ['zh-tw-male-mid', 'zh-tw-female-mature', 'en-male-brisk'] },
      { id: 'tts_language', label: 'Language', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'zh-CN', 'en', 'ja'] },
    ],
  },
  {
    id: 'safety',
    title: 'Safety',
    description: 'Enforced server-side on every turn, in both directions.',
    rows: [
      { id: 'mod_provider', label: 'Moderation provider', value: 'OpenAI moderation', kind: 'select', options: ['OpenAI moderation', 'Azure Content Safety'] },
      { id: 'pii_policy', label: 'PII policy', value: 'Mask at ingest', kind: 'select', options: ['Mask at ingest', 'Mask at display', 'Block'] },
      { id: 'injection', label: 'Injection detection', value: 'on', kind: 'switch' },
      { id: 'compliance_policy', label: 'Compliance policy', value: 'Insurance TW 2026', kind: 'select', options: ['Insurance TW 2026', 'Insurance SG 2026', 'Custom'] },
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
  { id: 'provider', label: 'Provider', value: 'ElevenLabs', kind: 'select', options: ['ElevenLabs', 'OpenAI', 'Azure Speech'] },
  { id: 'language', label: 'Language', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'zh-CN', 'en', 'ja'] },
  { id: 'voice', label: 'Voice', value: 'zh-tw-male-mid', kind: 'select', options: ['zh-tw-male-mid', 'zh-tw-female-mature', 'en-male-brisk'] },
  { id: 'speed', label: 'Speed', value: '1.02', kind: 'slider', min: 0.6, max: 1.6, step: 0.02, hint: '1.0 is the provider default' },
  { id: 'stability', label: 'Stability', value: '0.62', kind: 'slider', min: 0, max: 1, step: 0.02, hint: 'Lower is more expressive, higher is more consistent' },
  { id: 'similarity', label: 'Similarity', value: '0.75', kind: 'slider', min: 0, max: 1, step: 0.05, hint: 'ElevenLabs only' },
  { id: 'emotion', label: 'Emotion style', value: 'measured, slightly guarded', kind: 'select', options: ['neutral', 'measured, slightly guarded', 'warm, anxious', 'clipped, impatient'] },
  { id: 'interruptibility', label: 'Allow barge-in', value: 'on', kind: 'switch', hint: 'Trainee can interrupt; TTS cancels and the session returns to listening' },
  { id: 'silence_timeout', label: 'Silence timeout (ms)', value: '1200', kind: 'number', hint: 'VAD end-of-turn detection' },
  { id: 'caption_language', label: 'Caption language', value: 'zh-TW', kind: 'select', options: ['zh-TW', 'en', 'Off'] },
];

/** §46 Billing / Quota. */
export interface QuotaRow {
  id: string;
  label: string;
  used: number;
  limit: number;
  unit: string;
}

export const BILLING_PERIOD = { start: '2026-03-01', end: '2026-03-31', plan: 'Enterprise · Annual' };

export const QUOTA_ROWS: QuotaRow[] = [
  { id: 'seats', label: 'Seats', used: 38, limit: 42, unit: 'users' },
  { id: 'sim_minutes', label: 'Simulation minutes', used: 24_720, limit: 36_000, unit: 'min' },
  { id: 'voice_minutes', label: 'Voice minutes', used: 5_760, limit: 9_000, unit: 'min' },
  { id: 'storage', label: 'Document storage', used: 128, limit: 500, unit: 'GB' },
  { id: 'model_usage', label: 'Model usage', used: 412, limit: 800, unit: 'M tokens' },
  { id: 'workspaces', label: 'Workspaces', used: 3, limit: 5, unit: 'workspaces' },
];

export interface InvoiceRow {
  id: string;
  period: string;
  amount: string;
  status: 'paid' | 'due' | 'failed';
  issued: string;
}

export const INVOICES: InvoiceRow[] = [
  { id: 'inv_2026_03', period: 'Mar 2026', amount: 'USD 6,480.00', status: 'due', issued: '2026-03-01' },
  { id: 'inv_2026_02', period: 'Feb 2026', amount: 'USD 6,480.00', status: 'paid', issued: '2026-02-01' },
  { id: 'inv_2026_01', period: 'Jan 2026', amount: 'USD 6,120.00', status: 'paid', issued: '2026-01-01' },
  { id: 'inv_2025_12', period: 'Dec 2025', amount: 'USD 6,120.00', status: 'paid', issued: '2025-12-01' },
];
