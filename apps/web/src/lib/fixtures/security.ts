import type { AuditEvent, ComplianceRisk } from '@ai-coach/shared';
import { TENANT_ID, WORKSPACE_ID, daysAgo, minutesAgo } from './constants';

/** §41 Security & Audit summary tiles. */
export interface SecuritySummary {
  safe_sessions: number;
  warnings: number;
  critical: number;
  open_findings: number;
  sessions_reviewed: number;
  last_penetration_review: string;
}

export const SECURITY_SUMMARY: SecuritySummary = {
  safe_sessions: 1_182,
  warnings: 47,
  critical: 2,
  open_findings: 2,
  sessions_reviewed: 96,
  last_penetration_review: daysAgo(52),
};

/** §40 Part I — AI safety controls, shown as a posture list rather than a red dashboard. */
export interface SafetyControl {
  id: string;
  name: string;
  description: string;
  status: 'enforced' | 'monitoring' | 'attention';
  detail: string;
}

export const SAFETY_CONTROLS: SafetyControl[] = [
  {
    id: 'ctl_injection',
    name: '提示注入偵測',
    description: '客戶角色必須維持人設，絕不洩漏系統提示。',
    status: 'enforced',
    detail: '近 30 天攔截 6 次嘗試 · 0 次突破',
  },
  {
    id: 'ctl_pii',
    name: '個資遮蔽',
    description: '逐字稿在寫入儲存前先遮蔽個人識別資料。',
    status: 'enforced',
    detail: '身分證字號與卡號格式於寫入時即遮蔽',
  },
  {
    id: 'ctl_moderation',
    name: '內容審核',
    description: '對話的雙向內容都會經過審核。',
    status: 'enforced',
    detail: '提供者：伺服器端審核服務',
  },
  {
    id: 'ctl_claims',
    name: '無依據宣稱偵測',
    description: '每一項商品宣稱都以知識庫內容比對查核。',
    status: 'attention',
    detail: '本週標記 5 件無依據宣稱 — 2 件待處理',
  },
  {
    id: 'ctl_tenant',
    name: '租戶與知識庫隔離',
    description: '檢索範圍受限於該工作區與呼叫者的權限設定。',
    status: 'enforced',
    detail: '0 次跨租戶檢索 · CI 持續驗證',
  },
  {
    id: 'ctl_cache',
    name: '瀏覽器敏感快取',
    description: '允許本機模型快取；敏感資料快取預設關閉。',
    status: 'monitoring',
    detail: '所有使用者登出時一律清除',
  },
];

export const RISK_LABEL: Record<ComplianceRisk, string> = {
  safe: '安全',
  low: '低',
  medium: '中',
  high: '高',
  critical: '重大',
};

/** §42 Audit Log — Time / User / Action / Resource / Workspace / IP / Result / Risk. */
export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'aud_9001', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(3), user_id: 'usr_lin', action: 'knowledge.document.upload', resource: 'kb_product_sop/重大疾病定義-2026.docx', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
  { id: 'aud_9002', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(18), user_id: 'usr_lin', action: 'model.settings.change', resource: 'llm.primary → gpt-4.1', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'medium' },
  { id: 'aud_9003', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(41), user_id: 'usr_chang', action: 'session.start', resource: 'scn_already_insured@6', ip: '198.51.100.77', session_ref: 'ses_1207', result: 'success', risk: 'safe' },
  { id: 'aud_9004', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(44), user_id: 'usr_chang', action: 'compliance.finding.raised', resource: 'fnd_301', ip: '198.51.100.77', session_ref: 'ses_1207', result: 'success', risk: 'high' },
  { id: 'aud_9005', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(96), user_id: 'usr_kuo', action: 'knowledge.export', resource: 'kb_compliance', ip: '198.51.100.41', session_ref: 'web-2a9c', result: 'denied', risk: 'medium' },
  { id: 'aud_9006', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(0, 4), user_id: 'usr_ong', action: 'rubric.approve', resource: 'rub_compliance@2', ip: '203.0.113.9', session_ref: 'web-51bb', result: 'success', risk: 'low' },
  { id: 'aud_9007', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(1), user_id: 'usr_lin', action: 'permission.change', resource: 'usr_yeh: coach → coach,reviewer', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'high' },
  { id: 'aud_9008', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(1, 3), user_id: undefined, action: 'api.access', resource: 'POST /api/sessions（服務憑證）', ip: '10.4.2.18', result: 'success', risk: 'safe' },
  { id: 'aud_9009', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(2), user_id: 'usr_hsu', action: 'report.export', resource: 'reports/team?range=30d', ip: '198.51.100.12', session_ref: 'web-88d1', result: 'success', risk: 'medium' },
  { id: 'aud_9010', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(2, 6), user_id: 'usr_kuo', action: 'auth.login', resource: 'sso/entra-id', ip: '198.51.100.41', session_ref: 'web-2a9c', result: 'error', risk: 'medium' },
  { id: 'aud_9011', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(3), user_id: 'usr_lin', action: 'chunk.edit', resource: 'chk_1022（已排除檢索）', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
  { id: 'aud_9012', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(4), user_id: 'usr_lin', action: 'persona.change', resource: 'per_chen@3 → @4', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
];

export const AUDIT_ACTION_GROUPS = [
  { id: 'all', label: '全部活動' },
  { id: 'auth', label: '身分驗證', match: ['auth.'] },
  { id: 'knowledge', label: '知識庫與切片', match: ['knowledge.', 'chunk.'] },
  { id: 'content', label: '客戶角色 / 情境 / 評分規準', match: ['persona.', 'scenario.', 'rubric.', 'prompt.'] },
  { id: 'admin', label: '權限與模型', match: ['permission.', 'model.'] },
  { id: 'export', label: '匯出與 API', match: ['report.export', 'knowledge.export', 'api.'] },
  { id: 'security', label: '安全發現', match: ['compliance.', 'security.'] },
] as const;
