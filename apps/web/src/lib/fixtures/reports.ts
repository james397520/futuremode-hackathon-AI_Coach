import type { ComplianceRisk, Difficulty, ID, SkillKey } from '@ai-coach/shared';

/** §35 Part I — Manager / Team analytics view models. */
export interface TeamKpi {
  team_id: ID;
  team_name: string;
  members: number;
  average_score: number;
  pass_rate: number;
  completion_rate: number;
  compliance_risk: ComplianceRisk;
  improvement: number;
  high_potential: number;
  low_readiness: number;
}

export const TEAM_KPIS: TeamKpi[] = [
  {
    team_id: 'team_taipei_north',
    team_name: '台北北區營業處',
    members: 14,
    average_score: 81,
    pass_rate: 0.79,
    completion_rate: 0.71,
    compliance_risk: 'low',
    improvement: 6.4,
    high_potential: 3,
    low_readiness: 2,
  },
  {
    team_id: 'team_taichung',
    team_name: '台中營業處',
    members: 11,
    average_score: 74,
    pass_rate: 0.58,
    completion_rate: 0.62,
    compliance_risk: 'medium',
    improvement: 2.1,
    high_potential: 1,
    low_readiness: 4,
  },
  {
    team_id: 'team_bank_desk',
    team_name: '銀行臨櫃顧問組',
    members: 13,
    average_score: 77,
    pass_rate: 0.68,
    completion_rate: 0.55,
    compliance_risk: 'medium',
    improvement: 4.8,
    high_potential: 2,
    low_readiness: 3,
  },
];

/** Skill matrix / weakness heatmap: rows = teams, cols = the ten §26.1 skills. */
export interface SkillMatrixRow {
  team_id: ID;
  team_name: string;
  scores: Record<SkillKey, number>;
}

export const SKILL_MATRIX: SkillMatrixRow[] = [
  {
    team_id: 'team_taipei_north',
    team_name: '台北北區',
    scores: {
      professional_knowledge: 85,
      empathy: 76,
      needs_discovery: 84,
      communication_clarity: 82,
      objection_handling: 80,
      trust_building: 78,
      product_knowledge: 83,
      compliance: 71,
      closing_ability: 77,
      goal_achievement: 86,
    },
  },
  {
    team_id: 'team_taichung',
    team_name: '台中',
    scores: {
      professional_knowledge: 76,
      empathy: 68,
      needs_discovery: 70,
      communication_clarity: 74,
      objection_handling: 66,
      trust_building: 71,
      product_knowledge: 78,
      compliance: 58,
      closing_ability: 69,
      goal_achievement: 75,
    },
  },
  {
    team_id: 'team_bank_desk',
    team_name: '銀行臨櫃',
    scores: {
      professional_knowledge: 80,
      empathy: 73,
      needs_discovery: 75,
      communication_clarity: 79,
      objection_handling: 72,
      trust_building: 74,
      product_knowledge: 81,
      compliance: 64,
      closing_ability: 70,
      goal_achievement: 78,
    },
  },
];

export interface LeaderboardRow {
  user_id: ID;
  display_name: string;
  team_name: string;
  overall_score: number;
  improvement: number;
  sessions: number;
  weakest_skill: SkillKey;
  readiness: 'ready' | 'developing' | 'at_risk';
}

export const TEAM_LEADERBOARD: LeaderboardRow[] = [
  { user_id: 'usr_chang', display_name: '張維庭', team_name: '台北北區', overall_score: 82, improvement: 6.4, sessions: 27, weakest_skill: 'compliance', readiness: 'developing' },
  { user_id: 'usr_hsu', display_name: '許美玲', team_name: '台北北區', overall_score: 89, improvement: 3.1, sessions: 34, weakest_skill: 'closing_ability', readiness: 'ready' },
  { user_id: 'usr_kuo', display_name: '郭家豪', team_name: '台中', overall_score: 63, improvement: -1.8, sessions: 11, weakest_skill: 'needs_discovery', readiness: 'at_risk' },
  { user_id: 'usr_yeh', display_name: '葉淑貞', team_name: '台中', overall_score: 91, improvement: 1.2, sessions: 41, weakest_skill: 'product_knowledge', readiness: 'ready' },
  { user_id: 'usr_tsai', display_name: '蔡明慧', team_name: '銀行臨櫃', overall_score: 78, improvement: 5.5, sessions: 19, weakest_skill: 'empathy', readiness: 'developing' },
];

/** §47 Part I — knowledge gap analysis feeding the skill report. */
export interface KnowledgeGap {
  topic: string;
  document_name: string;
  miss_rate: number;
  affected_users: number;
  linked_skill: SkillKey;
}

export const KNOWLEDGE_GAPS: KnowledgeGap[] = [
  { topic: '等待期與除外責任', document_name: '重大疾病定義 2026', miss_rate: 0.42, affected_users: 16, linked_skill: 'compliance' },
  { topic: '團保與個人保單差異', document_name: '商品 SOP v3 §3.3', miss_rate: 0.31, affected_users: 12, linked_skill: 'professional_knowledge' },
  { topic: '保障缺口計算', document_name: '2026 保費級距表', miss_rate: 0.27, affected_users: 9, linked_skill: 'needs_discovery' },
  { topic: '禁用話術清單', document_name: '禁用話術清單 2026', miss_rate: 0.24, affected_users: 21, linked_skill: 'compliance' },
];

export interface ScenarioMastery {
  scenario_id: ID;
  scenario_name: string;
  difficulty: Difficulty;
  attempts: number;
  pass_rate: number;
  average_score: number;
}

export const SCENARIO_MASTERY: ScenarioMastery[] = [
  { scenario_id: 'scn_needs_discovery', scenario_name: '首次面談 — 需求探索基本功', difficulty: 'easy', attempts: 96, pass_rate: 0.84, average_score: 81 },
  { scenario_id: 'scn_already_insured', scenario_name: '「我已經有保險了」', difficulty: 'hard', attempts: 74, pass_rate: 0.61, average_score: 76 },
  { scenario_id: 'scn_founder_speed', scenario_name: '高資產創辦人', difficulty: 'medium', attempts: 22, pass_rate: 0.55, average_score: 72 },
  { scenario_id: 'scn_compliance_assessment', scenario_name: '合規話術年度考核', difficulty: 'expert', attempts: 41, pass_rate: 0.46, average_score: 69 },
];

/** Dashboard KPI row (§13.3). */
export interface DashboardKpi {
  id: string;
  label: string;
  value: string;
  delta?: string;
  hint: string;
  trend?: number[];
}

export const DASHBOARD_KPIS: DashboardKpi[] = [
  { id: 'learners', label: '活躍學員', value: '38', delta: '+4', hint: '共 42 個名額', trend: [28, 30, 31, 34, 36, 38] },
  { id: 'completion', label: '完成率', value: '71%', delta: '+9 個百分點', hint: '必修指派', trend: [52, 55, 60, 63, 66, 71] },
  { id: 'avg-score', label: '平均分數', value: '79', delta: '+3.2', hint: '最近 30 天', trend: [72, 73, 75, 76, 78, 79] },
  { id: 'compliance', label: '合規安全率', value: '94%', delta: '−1 個百分點', hint: '2 項待處理的重大發現', trend: [96, 95, 96, 95, 95, 94] },
  { id: 'hours', label: '模擬練習時數', value: '412', delta: '+38', hint: '含 96 小時語音練習', trend: [280, 305, 330, 356, 374, 412] },
  { id: 'improvement', label: '進步幅度', value: '+6.4', hint: '每月平均分數變化', trend: [1.2, 2.4, 3.1, 4.6, 5.5, 6.4] },
];

export const ACTIVITY_BY_DAY: Array<{ label: string; sessions: number; voice: number }> = [
  { label: '一', sessions: 22, voice: 6 },
  { label: '二', sessions: 31, voice: 11 },
  { label: '三', sessions: 27, voice: 9 },
  { label: '四', sessions: 34, voice: 14 },
  { label: '五', sessions: 19, voice: 5 },
  { label: '六', sessions: 7, voice: 1 },
  { label: '日', sessions: 4, voice: 0 },
];
