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
  ai_model: 'AI models',
  voice: 'Speech',
  vector: 'Vector database',
  compute: 'Compute',
  business: 'Business systems',
  identity: 'Identity',
  delivery: 'Notifications',
  storage: 'Object storage',
};

export const MOCK_CONNECTORS: Connector[] = [
  { id: 'int_openai', name: 'OpenAI', category: 'ai_model', summary: 'Primary LLM, embeddings and speech.', status: 'connected', last_sync: '2026-03-18T09:12:00.000Z', detail: 'gpt-4.1 · text-embedding-3-large', credential_hint: 'sk-…4f2c (server-side vault)', managed_by: 'Workspace admin' },
  { id: 'int_elevenlabs', name: 'ElevenLabs', category: 'voice', summary: 'Persona TTS voices for zh-TW and en.', status: 'connected', last_sync: '2026-03-18T08:40:00.000Z', detail: '4 voices mapped · 96 voice hours this month', credential_hint: 'el-…9a71 (server-side vault)' },
  { id: 'int_qdrant', name: 'Qdrant', category: 'vector', summary: 'Vector store for all knowledge bases.', status: 'connected', last_sync: '2026-03-18T09:22:00.000Z', detail: '6,474 vectors · 3 collections · p95 query 38 ms' },
  { id: 'int_amd_aup', name: 'AMD AUP', category: 'compute', summary: 'GPU inference capacity for batch evaluation.', status: 'connected', last_sync: '2026-03-17T22:05:00.000Z', detail: 'Region: apac-1 · 2 reserved nodes' },
  { id: 'int_chroma', name: 'ChromaDB', category: 'vector', summary: 'Alternative local vector store for air-gapped pilots.', status: 'not_connected' },
  { id: 'int_faiss', name: 'FAISS', category: 'vector', summary: 'In-process index for offline evaluation runs.', status: 'not_connected' },
  { id: 'int_crm', name: 'Salesforce CRM', category: 'business', summary: 'Pull real objection patterns and push training outcomes.', status: 'error', last_sync: '2026-03-16T03:11:00.000Z', detail: 'OAuth refresh token expired — reconnect required.' },
  { id: 'int_lms', name: 'Cornerstone LMS', category: 'business', summary: 'Sync assignments and completion records.', status: 'connected', last_sync: '2026-03-18T06:00:00.000Z', detail: '38 learners · nightly sync 06:00 CST' },
  { id: 'int_hris', name: 'Workday HRIS', category: 'business', summary: 'Team structure and department hierarchy.', status: 'connected', last_sync: '2026-03-18T05:30:00.000Z', detail: '3 teams · 42 seats' },
  { id: 'int_sso', name: 'Microsoft Entra ID', category: 'identity', summary: 'SSO and SCIM provisioning.', status: 'connected', last_sync: '2026-03-18T09:00:00.000Z', detail: 'SAML 2.0 · SCIM enabled · 42 provisioned users' },
  { id: 'int_google', name: 'Google Workspace', category: 'identity', summary: 'OAuth / OIDC sign-in for the B2C workspace.', status: 'not_connected' },
  { id: 'int_webhook', name: 'Outbound webhooks', category: 'delivery', summary: 'Session completion, report ready and security events.', status: 'connected', last_sync: '2026-03-18T09:21:00.000Z', detail: '3 endpoints · signed with HMAC-SHA256' },
  { id: 'int_teams', name: 'Microsoft Teams', category: 'delivery', summary: 'Assignment and deadline notifications.', status: 'connected', last_sync: '2026-03-18T07:45:00.000Z', detail: 'Channel: #agency-training' },
  { id: 'int_slack', name: 'Slack', category: 'delivery', summary: 'Notification mirror for the bancassurance channel.', status: 'not_connected' },
  { id: 'int_s3', name: 'MinIO / S3', category: 'storage', summary: 'Document and audio object storage with signed URLs.', status: 'connected', last_sync: '2026-03-18T09:20:00.000Z', detail: 'Bucket: ai-coach · SSE enabled · 128 GB used' },
];
