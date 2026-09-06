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
  training_assigned: '新的訓練指派',
  deadline_soon: '期限將至',
  training_overdue: '已逾期',
  report_ready: '報告已產出',
  manager_comment: '主管留言',
  reviewer_request: '審核者請求',
  knowledge_updated: '知識庫已更新',
  security_warning: '安全警示',
  review_required: '待審核',
};

export const MOCK_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'ntf_01',
    kind: 'security_warning',
    title: '評測練習出現重大合規缺失',
    body: 'ses_1205 — 未揭露等待期與除外責任。該場評測在覆核前先判定為不通過。',
    at: '2026-03-18T09:18:00.000Z',
    read: false,
    href: '/security',
    severity: 'critical',
  },
  {
    id: 'ntf_02',
    kind: 'review_required',
    title: '20 道 AI 生成題目待審核',
    body: '依據商品 SOP v3 與 2026 保費級距表生成；審核者核准前不會發布。',
    at: '2026-03-18T09:10:00.000Z',
    read: false,
    href: '/questions?status=generated',
    severity: 'attention',
  },
  {
    id: 'ntf_03',
    kind: 'report_ready',
    title: '練習報告已產出 — 張維庭',
    body: '總分 82 / 100 · 通過 · 1 項已確認的合規缺失。',
    at: '2026-03-18T07:56:00.000Z',
    read: false,
    href: '/simulations/ses_1207/review',
    severity: 'success',
  },
  {
    id: 'ntf_04',
    kind: 'knowledge_updated',
    title: '商品 SOP v3 已重新索引',
    body: '128 份文件 · 4,820 個切片。使用此知識庫的所有情境都已可即時檢索。',
    at: '2026-03-18T09:12:00.000Z',
    read: true,
    href: '/knowledge/kb_product_sop',
    severity: 'info',
  },
  {
    id: 'ntf_05',
    kind: 'deadline_soon',
    title: '「我已經有保險了」還有 4 天到期',
    body: '14 位受指派學員中已有 10 位達到 80 分的最低標準。',
    at: '2026-03-18T06:00:00.000Z',
    read: true,
    href: '/training',
    severity: 'attention',
  },
  {
    id: 'ntf_06',
    kind: 'training_overdue',
    title: '需求探索練習已逾期',
    body: '郭家豪 — 已練習 1 次，最佳成績 64 分（最低標準 70 分）。',
    at: '2026-03-17T09:00:00.000Z',
    read: true,
    href: '/performance/usr_kuo',
    severity: 'attention',
  },
  {
    id: 'ntf_07',
    kind: 'manager_comment',
    title: '蔡明慧在你的練習上留言',
    body: '「缺口計算那段很好，下次把它提前。」',
    at: '2026-03-17T04:20:00.000Z',
    read: true,
    href: '/simulations/ses_1207/review',
    severity: 'info',
  },
  {
    id: 'ntf_08',
    kind: 'reviewer_request',
    title: '合規考核評分規準 v2 待核准',
    body: '翁立偉請你確認更新後的權重配置。',
    at: '2026-03-16T11:05:00.000Z',
    read: true,
    href: '/settings',
    severity: 'attention',
  },
  {
    id: 'ntf_09',
    kind: 'training_assigned',
    title: '合規話術年度考核已指派給 3 個團隊',
    body: '評測模式 · 限 1 次 · 最低 85 分 · 11 天後到期。',
    at: '2026-03-16T02:00:00.000Z',
    read: true,
    href: '/training',
    severity: 'info',
  },
];
