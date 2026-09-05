/** §43 Integrations — connector cards. */
export type ConnectorStatus = 'connected' | 'not_connected' | 'error';

export type ConnectorCategory =
  | 'ai_model'
  | 'voice'
  | 'vector'
  | 'compute'
  | 'business'
  | 'identity'
  | 'delivery'
  | 'storage';

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  summary: string;
  status: ConnectorStatus;
  last_sync?: string;
  detail?: string;
  /**
   * Credentials are stored and rotated server-side only (§56 / §70 / §71).
   * The UI shows a masked hint, never a key.
   */
  credential_hint?: string;
  managed_by?: string;
}

export const CONNECTOR_CATEGORY_LABEL: Record<ConnectorCategory, string> = {
  ai_model: 'AI 模型',
  voice: '語音服務',
  vector: '向量資料庫',
  compute: '運算資源',
  business: '企業系統',
  identity: '身分驗證',
  delivery: '通知推播',
  storage: '物件儲存',
};

export const MOCK_CONNECTORS: Connector[] = [
  { id: 'int_openai', name: 'OpenAI', category: 'ai_model', summary: '主要的大型語言模型、向量化與語音服務。', status: 'connected', last_sync: '2026-03-18T09:12:00.000Z', detail: 'gpt-4.1 · text-embedding-3-large', credential_hint: 'sk-…4f2c（伺服器端金鑰保管）', managed_by: '工作區管理員' },
  { id: 'int_elevenlabs', name: 'ElevenLabs', category: 'voice', summary: '客戶角色的中英文語音合成音色。', status: 'connected', last_sync: '2026-03-18T08:40:00.000Z', detail: '已對應 4 種音色 · 本月語音時數 96 小時', credential_hint: 'el-…9a71（伺服器端金鑰保管）' },
  { id: 'int_qdrant', name: 'Qdrant', category: 'vector', summary: '所有知識庫共用的向量資料庫。', status: 'connected', last_sync: '2026-03-18T09:22:00.000Z', detail: '6,474 筆向量 · 3 個集合 · p95 查詢 38 毫秒' },
  { id: 'int_amd_aup', name: 'AMD AUP', category: 'compute', summary: '批次評分所需的 GPU 推論資源。', status: 'connected', last_sync: '2026-03-17T22:05:00.000Z', detail: '區域：apac-1 · 2 個預留節點' },
  { id: 'int_chroma', name: 'ChromaDB', category: 'vector', summary: '封閉網路試辦時可用的本地向量資料庫。', status: 'not_connected' },
  { id: 'int_faiss', name: 'FAISS', category: 'vector', summary: '離線評估使用的行程內索引。', status: 'not_connected' },
  { id: 'int_crm', name: 'Salesforce CRM', category: 'business', summary: '匯入真實異議模式，並回寫訓練結果。', status: 'error', last_sync: '2026-03-16T03:11:00.000Z', detail: 'OAuth 更新權杖已過期 — 需重新連線。' },
  { id: 'int_lms', name: 'Cornerstone LMS', category: 'business', summary: '同步訓練指派與完成紀錄。', status: 'connected', last_sync: '2026-03-18T06:00:00.000Z', detail: '38 位學員 · 每日 06:00 同步' },
  { id: 'int_hris', name: 'Workday HRIS', category: 'business', summary: '團隊組織與部門層級資料。', status: 'connected', last_sync: '2026-03-18T05:30:00.000Z', detail: '3 個團隊 · 42 個名額' },
  { id: 'int_sso', name: 'Microsoft Entra ID', category: 'identity', summary: '單一登入與 SCIM 帳號佈建。', status: 'connected', last_sync: '2026-03-18T09:00:00.000Z', detail: 'SAML 2.0 · 已啟用 SCIM · 已佈建 42 位使用者' },
  { id: 'int_google', name: 'Google Workspace', category: 'identity', summary: 'B2C 工作區的 OAuth / OIDC 登入。', status: 'not_connected' },
  { id: 'int_webhook', name: '對外 Webhook', category: 'delivery', summary: '練習完成、報告產出與安全事件通知。', status: 'connected', last_sync: '2026-03-18T09:21:00.000Z', detail: '3 個接收端點 · 以 HMAC-SHA256 簽章' },
  { id: 'int_teams', name: 'Microsoft Teams', category: 'delivery', summary: '訓練指派與期限提醒通知。', status: 'connected', last_sync: '2026-03-18T07:45:00.000Z', detail: '頻道：#agency-training' },
  { id: 'int_slack', name: 'Slack', category: 'delivery', summary: '銀行保險通路的通知同步。', status: 'not_connected' },
  { id: 'int_s3', name: 'MinIO / S3', category: 'storage', summary: '文件與語音檔的物件儲存，使用簽章網址。', status: 'connected', last_sync: '2026-03-18T09:20:00.000Z', detail: 'Bucket：ai-coach · 已啟用 SSE · 已使用 128 GB' },
];
