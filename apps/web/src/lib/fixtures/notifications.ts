/** §37 Part I / §81 — notification centre. */
export type NotificationKind =
  | 'training_assigned'
  | 'deadline_soon'
  | 'training_overdue'
  | 'report_ready'
  | 'manager_comment'
  | 'reviewer_request'
  | 'knowledge_updated'
  | 'security_warning'
  | 'review_required';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  at: string;
  read: boolean;
  href: string;
  /** Notifications must not be colour-only (§47) — each carries an explicit label. */
  severity: 'info' | 'attention' | 'critical' | 'success';
}

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  training_assigned: 'New training',
  deadline_soon: 'Deadline soon',
  training_overdue: 'Overdue',
  report_ready: 'Report ready',
  manager_comment: 'Manager comment',
  reviewer_request: 'Reviewer request',
  knowledge_updated: 'Knowledge updated',
  security_warning: 'Security warning',
  review_required: 'Review required',
};

export const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'ntf_01',
    kind: 'security_warning',
    title: 'Critical finding on an assessment session',
    body: 'ses_1205 — missing disclosure of waiting period and exclusions. Assessment marked as not passed pending review.',
    at: '2026-03-18T09:18:00.000Z',
    read: false,
    href: '/security',
    severity: 'critical',
  },
  {
    id: 'ntf_02',
    kind: 'review_required',
    title: '20 AI-generated questions await review',
    body: 'Generated from Product SOP v3 and 2026 Premium Bands. Nothing is published until a reviewer approves it.',
    at: '2026-03-18T09:10:00.000Z',
    read: false,
    href: '/questions?status=generated',
    severity: 'attention',
  },
  {
    id: 'ntf_03',
    kind: 'report_ready',
    title: 'Session report ready — Chang Wei-Ting',
    body: 'Overall 82 / 100 · passed · 1 acknowledged compliance finding.',
    at: '2026-03-18T07:56:00.000Z',
    read: false,
    href: '/simulations/ses_1207/review',
    severity: 'success',
  },
  {
    id: 'ntf_04',
    kind: 'knowledge_updated',
    title: 'Product SOP v3 re-indexed',
    body: '128 documents · 4,820 chunks. Retrieval is live for all scenarios using this knowledge base.',
    at: '2026-03-18T09:12:00.000Z',
    read: true,
    href: '/knowledge/kb_product_sop',
    severity: 'info',
  },
  {
    id: 'ntf_05',
    kind: 'deadline_soon',
    title: '「我已經有保險了」 due in 4 days',
    body: '10 of 14 assignees have met the minimum score of 80.',
    at: '2026-03-18T06:00:00.000Z',
    read: true,
    href: '/training',
    severity: 'attention',
  },
  {
    id: 'ntf_06',
    kind: 'training_overdue',
    title: 'Needs discovery drill is overdue',
    body: 'Kuo Chia-Hao — 1 attempt, best score 64 (minimum 70).',
    at: '2026-03-17T09:00:00.000Z',
    read: true,
    href: '/performance/usr_kuo',
    severity: 'attention',
  },
  {
    id: 'ntf_07',
    kind: 'manager_comment',
    title: 'Tsai Ming-Hui commented on your session',
    body: '「缺口計算那段很好，下次把它提前。」',
    at: '2026-03-17T04:20:00.000Z',
    read: true,
    href: '/simulations/ses_1207/review',
    severity: 'info',
  },
  {
    id: 'ntf_08',
    kind: 'reviewer_request',
    title: 'Compliance rubric v2 needs approval',
    body: 'Ong Li-Wei requested your sign-off on the updated weightings.',
    at: '2026-03-16T11:05:00.000Z',
    read: true,
    href: '/settings',
    severity: 'attention',
  },
  {
    id: 'ntf_09',
    kind: 'training_assigned',
    title: '合規話術年度考核 assigned to 3 teams',
    body: 'Assessment mode · 1 attempt · minimum score 85 · due in 11 days.',
    at: '2026-03-16T02:00:00.000Z',
    read: true,
    href: '/training',
    severity: 'info',
  },
];
