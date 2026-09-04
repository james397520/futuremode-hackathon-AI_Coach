import type { AuditEvent, ComplianceRisk } from '@ai-coach/shared-types';
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
    name: 'Prompt injection detection',
    description: 'Persona must stay in character and never reveal system instructions.',
    status: 'enforced',
    detail: '6 attempts blocked in the last 30 days · 0 escapes',
  },
  {
    id: 'ctl_pii',
    name: 'PII redaction',
    description: 'Identifiers are masked in transcripts before storage.',
    status: 'enforced',
    detail: 'National ID / card patterns masked at ingest',
  },
  {
    id: 'ctl_moderation',
    name: 'Content moderation',
    description: 'Both directions of the conversation are screened.',
    status: 'enforced',
    detail: 'Provider: server-side moderation endpoint',
  },
  {
    id: 'ctl_claims',
    name: 'Unsupported claim detection',
    description: 'Knowledge-grounded check on every product claim.',
    status: 'attention',
    detail: '5 unsupported claims flagged this week — 2 still open',
  },
  {
    id: 'ctl_tenant',
    name: 'Tenant / knowledge isolation',
    description: 'Retrieval is scoped to the workspace and the caller ACL.',
    status: 'enforced',
    detail: '0 cross-tenant retrievals · continuous assertion in CI',
  },
  {
    id: 'ctl_cache',
    name: 'Sensitive browser cache',
    description: 'Local model cache allowed; sensitive data cache off by default.',
    status: 'monitoring',
    detail: 'Cleared on logout for all users',
  },
];

export const RISK_LABEL: Record<ComplianceRisk, string> = {
  safe: 'Safe',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

/** §42 Audit Log — Time / User / Action / Resource / Workspace / IP / Result / Risk. */
export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  { id: 'aud_9001', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(3), user_id: 'usr_lin', action: 'knowledge.document.upload', resource: 'kb_product_sop/Critical-Illness-Definitions-2026.docx', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
  { id: 'aud_9002', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(18), user_id: 'usr_lin', action: 'model.settings.change', resource: 'llm.primary → gpt-4.1', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'medium' },
  { id: 'aud_9003', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(41), user_id: 'usr_chang', action: 'session.start', resource: 'scn_already_insured@6', ip: '198.51.100.77', session_ref: 'ses_1207', result: 'success', risk: 'safe' },
  { id: 'aud_9004', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(44), user_id: 'usr_chang', action: 'compliance.finding.raised', resource: 'fnd_301', ip: '198.51.100.77', session_ref: 'ses_1207', result: 'success', risk: 'high' },
  { id: 'aud_9005', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: minutesAgo(96), user_id: 'usr_kuo', action: 'knowledge.export', resource: 'kb_compliance', ip: '198.51.100.41', session_ref: 'web-2a9c', result: 'denied', risk: 'medium' },
  { id: 'aud_9006', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(0, 4), user_id: 'usr_ong', action: 'rubric.approve', resource: 'rub_compliance@2', ip: '203.0.113.9', session_ref: 'web-51bb', result: 'success', risk: 'low' },
  { id: 'aud_9007', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(1), user_id: 'usr_lin', action: 'permission.change', resource: 'usr_yeh: coach → coach,reviewer', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'high' },
  { id: 'aud_9008', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(1, 3), user_id: undefined, action: 'api.access', resource: 'POST /api/sessions (service token)', ip: '10.4.2.18', result: 'success', risk: 'safe' },
  { id: 'aud_9009', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(2), user_id: 'usr_hsu', action: 'report.export', resource: 'reports/team?range=30d', ip: '198.51.100.12', session_ref: 'web-88d1', result: 'success', risk: 'medium' },
  { id: 'aud_9010', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(2, 6), user_id: 'usr_kuo', action: 'auth.login', resource: 'sso/entra-id', ip: '198.51.100.41', session_ref: 'web-2a9c', result: 'error', risk: 'medium' },
  { id: 'aud_9011', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(3), user_id: 'usr_lin', action: 'chunk.edit', resource: 'chk_1022 (excluded from retrieval)', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
  { id: 'aud_9012', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, at: daysAgo(4), user_id: 'usr_lin', action: 'persona.change', resource: 'per_chen@3 → @4', ip: '203.0.113.24', session_ref: 'web-7f21', result: 'success', risk: 'low' },
];

export const AUDIT_ACTION_GROUPS = [
  { id: 'all', label: 'All activity' },
  { id: 'auth', label: 'Authentication', match: ['auth.'] },
  { id: 'knowledge', label: 'Knowledge & chunks', match: ['knowledge.', 'chunk.'] },
  { id: 'content', label: 'Persona / scenario / rubric', match: ['persona.', 'scenario.', 'rubric.', 'prompt.'] },
  { id: 'admin', label: 'Permissions & models', match: ['permission.', 'model.'] },
  { id: 'export', label: 'Exports & API', match: ['report.export', 'knowledge.export', 'api.'] },
  { id: 'security', label: 'Security findings', match: ['compliance.', 'security.'] },
] as const;
