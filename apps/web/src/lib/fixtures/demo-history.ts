/**
 * 成效回顧（/performance）用的示範歷史資料——聚焦三個示範情境。
 *
 * 圍繞林佳穎（需求探索）、周敏惠（合規檢查）、張若瑄（情緒應對）三個情境，生成一份
 * 完整、擬真、逐週上升的練習歷史：技能輪廓、月度趨勢、情境熟練度、最近練習逐場紀錄
 * 與下一步建議。數字看似隨機、實為固定（可重播），連結指向對應的示範情境。
 */
import type { Difficulty, Recommendation, SkillKey, SkillProfile } from '@ai-coach/shared';
import type { ScenarioMastery } from './reports';

/** 三個示範情境的基本資料（含連結到示範播放頁）。 */
export interface DemoScenarioRef {
  scenario_id: string;
  scenario_name: string;
  difficulty: Difficulty;
  href: string;
}

export const DEMO_SCENARIOS: DemoScenarioRef[] = [
  {
    scenario_id: 'demo_clarify',
    scenario_name: '模糊提問的釐清對談——林佳穎',
    difficulty: 'easy',
    href: '/demo/clarify',
  },
  {
    scenario_id: 'demo_compliance',
    scenario_name: '投資型保單的合規對談——周敏惠',
    difficulty: 'hard',
    href: '/demo/compliance',
  },
  {
    scenario_id: 'demo_affect',
    scenario_name: '續保費率調漲的情緒應對——張若瑄',
    difficulty: 'hard',
    href: '/demo',
  },
];

/** 個人技能輪廓（十維度）。合規與同理最弱——正是示範情境要練的。 */
export const DEMO_HISTORY_PROFILE: SkillProfile = {
  user_id: 'usr_demo',
  overall_score: 81,
  skills: {
    professional_knowledge: 86,
    empathy: 73,
    needs_discovery: 84,
    communication_clarity: 82,
    objection_handling: 79,
    trust_building: 80,
    product_knowledge: 85,
    compliance: 70,
    closing_ability: 77,
    goal_achievement: 83,
  },
  weakest_skill: 'compliance',
  strongest_skill: 'professional_knowledge',
  monthly_improvement: 5.2,
  completed_sessions: 27,
  compliance_trend: [54, 58, 60, 63, 67, 70],
  days_to_readiness: 16,
};

/** 六個月的總分與練習次數。 */
export const DEMO_HISTORY_TREND: Array<{ label: string; score: number; sessions: number }> = [
  { label: '4月', score: 68, sessions: 3 },
  { label: '5月', score: 72, sessions: 5 },
  { label: '6月', score: 74, sessions: 4 },
  { label: '7月', score: 77, sessions: 6 },
  { label: '8月', score: 79, sessions: 5 },
  { label: '9月', score: 82, sessions: 4 },
];

/** 三個示範情境的熟練度。 */
export const DEMO_HISTORY_MASTERY: Array<ScenarioMastery & { href: string }> = [
  {
    scenario_id: 'demo_clarify',
    scenario_name: '模糊提問的釐清對談——林佳穎',
    difficulty: 'easy',
    attempts: 11,
    pass_rate: 0.82,
    average_score: 84,
    href: '/demo/clarify',
  },
  {
    scenario_id: 'demo_compliance',
    scenario_name: '投資型保單的合規對談——周敏惠',
    difficulty: 'hard',
    attempts: 9,
    pass_rate: 0.56,
    average_score: 74,
    href: '/demo/compliance',
  },
  {
    scenario_id: 'demo_affect',
    scenario_name: '續保費率調漲的情緒應對——張若瑄',
    difficulty: 'hard',
    attempts: 7,
    pass_rate: 0.57,
    average_score: 76,
    href: '/demo',
  },
];

export interface DemoHistorySession {
  id: string;
  scenario_id: string;
  scenario_name: string;
  difficulty: Difficulty;
  score: number;
  passed: boolean;
  turn_count: number;
  /** 幾天前完成。 */
  days_ago: number;
  duration_min: number;
  compliance_flags: number;
  weakest_skill: SkillKey;
  href: string;
}

/**
 * 最近練習逐場紀錄，時間由近到遠、分數整體上升。合規情境早期會有未通過與合規旗標，
 * 後期改善——像一份真實的成長歷程。
 */
export const DEMO_HISTORY_SESSIONS: DemoHistorySession[] = [
  { id: 'demo_s01', scenario_id: 'demo_compliance', scenario_name: '投資型保單的合規對談——周敏惠', difficulty: 'hard', score: 83, passed: true, turn_count: 14, days_ago: 1, duration_min: 12, compliance_flags: 0, weakest_skill: 'empathy', href: '/demo/compliance' },
  { id: 'demo_s02', scenario_id: 'demo_clarify', scenario_name: '模糊提問的釐清對談——林佳穎', difficulty: 'easy', score: 88, passed: true, turn_count: 11, days_ago: 2, duration_min: 9, compliance_flags: 0, weakest_skill: 'closing_ability', href: '/demo/clarify' },
  { id: 'demo_s03', scenario_id: 'demo_affect', scenario_name: '續保費率調漲的情緒應對——張若瑄', difficulty: 'hard', score: 79, passed: true, turn_count: 16, days_ago: 4, duration_min: 13, compliance_flags: 0, weakest_skill: 'empathy', href: '/demo' },
  { id: 'demo_s04', scenario_id: 'demo_compliance', scenario_name: '投資型保單的合規對談——周敏惠', difficulty: 'hard', score: 68, passed: false, turn_count: 15, days_ago: 6, duration_min: 14, compliance_flags: 2, weakest_skill: 'compliance', href: '/demo/compliance' },
  { id: 'demo_s05', scenario_id: 'demo_clarify', scenario_name: '模糊提問的釐清對談——林佳穎', difficulty: 'easy', score: 85, passed: true, turn_count: 10, days_ago: 7, duration_min: 8, compliance_flags: 0, weakest_skill: 'trust_building', href: '/demo/clarify' },
  { id: 'demo_s06', scenario_id: 'demo_affect', scenario_name: '續保費率調漲的情緒應對——張若瑄', difficulty: 'hard', score: 74, passed: true, turn_count: 17, days_ago: 9, duration_min: 15, compliance_flags: 0, weakest_skill: 'empathy', href: '/demo' },
  { id: 'demo_s07', scenario_id: 'demo_compliance', scenario_name: '投資型保單的合規對談——周敏惠', difficulty: 'hard', score: 71, passed: true, turn_count: 16, days_ago: 11, duration_min: 13, compliance_flags: 1, weakest_skill: 'compliance', href: '/demo/compliance' },
  { id: 'demo_s08', scenario_id: 'demo_clarify', scenario_name: '模糊提問的釐清對談——林佳穎', difficulty: 'easy', score: 82, passed: true, turn_count: 12, days_ago: 13, duration_min: 9, compliance_flags: 0, weakest_skill: 'needs_discovery', href: '/demo/clarify' },
  { id: 'demo_s09', scenario_id: 'demo_affect', scenario_name: '續保費率調漲的情緒應對——張若瑄', difficulty: 'hard', score: 66, passed: false, turn_count: 18, days_ago: 16, duration_min: 16, compliance_flags: 1, weakest_skill: 'empathy', href: '/demo' },
  { id: 'demo_s10', scenario_id: 'demo_compliance', scenario_name: '投資型保單的合規對談——周敏惠', difficulty: 'hard', score: 64, passed: false, turn_count: 15, days_ago: 19, duration_min: 14, compliance_flags: 3, weakest_skill: 'compliance', href: '/demo/compliance' },
  { id: 'demo_s11', scenario_id: 'demo_clarify', scenario_name: '模糊提問的釐清對談——林佳穎', difficulty: 'easy', score: 80, passed: true, turn_count: 11, days_ago: 22, duration_min: 8, compliance_flags: 0, weakest_skill: 'closing_ability', href: '/demo/clarify' },
  { id: 'demo_s12', scenario_id: 'demo_affect', scenario_name: '續保費率調漲的情緒應對——張若瑄', difficulty: 'hard', score: 72, passed: true, turn_count: 17, days_ago: 26, duration_min: 15, compliance_flags: 0, weakest_skill: 'objection_handling', href: '/demo' },
  { id: 'demo_s13', scenario_id: 'demo_compliance', scenario_name: '投資型保單的合規對談——周敏惠', difficulty: 'hard', score: 62, passed: false, turn_count: 14, days_ago: 30, duration_min: 13, compliance_flags: 3, weakest_skill: 'compliance', href: '/demo/compliance' },
  { id: 'demo_s14', scenario_id: 'demo_clarify', scenario_name: '模糊提問的釐清對談——林佳穎', difficulty: 'easy', score: 76, passed: true, turn_count: 12, days_ago: 34, duration_min: 9, compliance_flags: 0, weakest_skill: 'communication_clarity', href: '/demo/clarify' },
];

export const DEMO_HISTORY_RECOMMENDATION: Recommendation & { retry_href: string; next_href: string } = {
  next_scenario_id: 'demo_compliance',
  retry_scenario_id: 'demo_affect',
  next_href: '/demo/compliance',
  retry_href: '/demo',
  knowledge_material: [
    { document_id: 'doc_forbidden_phrases', reason: '合規分數 70 — 禁用話術清單（保證獲利／保本／節稅）需重讀' },
    { document_id: 'doc_investment_risk', reason: '投資型商品的風險揭露與本金損失說明' },
  ],
  question_set_ids: ['qst_compliance_01', 'qst_empathy_02'],
  weak_skills: ['compliance', 'empathy'],
  suggested_difficulty: 'hard',
};
