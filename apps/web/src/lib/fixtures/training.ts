import type { Assignment, Difficulty, ID, SessionMode, SkillKey } from '@ai-coach/shared';
import { SCOPE, daysAgo, inDays } from './constants';

/** §36 Part I — Training Assignment. */
export const MOCK_ASSIGNMENTS: Assignment[] = [
  {
    id: 'asg_501',
    ...SCOPE,
    scenario_id: 'scn_already_insured',
    assignee_user_ids: ['usr_chang', 'usr_hsu'],
    assignee_team_ids: ['team_taipei_north'],
    deadline: inDays(4),
    max_attempts: 3,
    minimum_score: 80,
    mandatory: true,
    mode: 'training',
    created_at: daysAgo(9),
    updated_at: daysAgo(2),
  },
  {
    id: 'asg_502',
    ...SCOPE,
    scenario_id: 'scn_compliance_assessment',
    assignee_user_ids: [],
    assignee_team_ids: ['team_taipei_north', 'team_taichung', 'team_bank_desk'],
    deadline: inDays(11),
    max_attempts: 1,
    minimum_score: 85,
    mandatory: true,
    prerequisite_assignment_id: 'asg_501',
    mode: 'assessment',
    created_at: daysAgo(6),
    updated_at: daysAgo(1),
  },
  {
    id: 'asg_503',
    ...SCOPE,
    scenario_id: 'scn_needs_discovery',
    assignee_user_ids: ['usr_kuo'],
    assignee_team_ids: [],
    deadline: inDays(-2),
    max_attempts: 5,
    minimum_score: 70,
    mandatory: false,
    mode: 'training',
    created_at: daysAgo(21),
    updated_at: daysAgo(14),
  },
  {
    id: 'asg_504',
    ...SCOPE,
    scenario_id: 'scn_founder_speed',
    assignee_user_ids: ['usr_hsu', 'usr_kuo'],
    assignee_team_ids: [],
    deadline: inDays(19),
    max_attempts: 3,
    minimum_score: 75,
    mandatory: false,
    mode: 'training',
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
  },
];

/**
 * View model for the trainee-facing assignment list and the dashboard.
 * Completion condition (§36): attempts ≥ 2, score ≥ 80, no critical compliance risk.
 */
export type AssignmentProgressStatus =
  | 'not_started'
  | 'in_progress'
  | 'awaiting_retry'
  | 'completed'
  | 'overdue';

export interface AssignmentProgress {
  assignment_id: ID;
  scenario_id: ID;
  scenario_name: string;
  persona_name: string;
  difficulty: Difficulty;
  mode: SessionMode;
  mandatory: boolean;
  deadline?: string;
  attempts_used: number;
  max_attempts?: number;
  best_score?: number;
  minimum_score: number;
  status: AssignmentProgressStatus;
  blocking_skill?: SkillKey;
  critical_findings: number;
  assignee_count: number;
  completion_rate: number;
}

export const MOCK_ASSIGNMENT_PROGRESS: AssignmentProgress[] = [
  {
    assignment_id: 'asg_501',
    scenario_id: 'scn_already_insured',
    scenario_name: '「我已經有保險了」— 保障缺口對話',
    persona_name: '陳先生 (Mr. Chen)',
    difficulty: 'hard',
    mode: 'training',
    mandatory: true,
    deadline: inDays(4),
    attempts_used: 2,
    max_attempts: 3,
    best_score: 82,
    minimum_score: 80,
    status: 'completed',
    critical_findings: 0,
    assignee_count: 14,
    completion_rate: 0.71,
  },
  {
    assignment_id: 'asg_502',
    scenario_id: 'scn_compliance_assessment',
    scenario_name: '合規話術年度考核',
    persona_name: '吳太太 (Mrs. Wu)',
    difficulty: 'expert',
    mode: 'assessment',
    mandatory: true,
    deadline: inDays(11),
    attempts_used: 0,
    max_attempts: 1,
    minimum_score: 85,
    status: 'not_started',
    blocking_skill: 'compliance',
    critical_findings: 0,
    assignee_count: 38,
    completion_rate: 0.18,
  },
  {
    assignment_id: 'asg_503',
    scenario_id: 'scn_needs_discovery',
    scenario_name: '首次面談 — 需求探索基本功',
    persona_name: '林小姐 (Bank walk-in)',
    difficulty: 'easy',
    mode: 'training',
    mandatory: false,
    deadline: inDays(-2),
    attempts_used: 1,
    max_attempts: 5,
    best_score: 64,
    minimum_score: 70,
    status: 'overdue',
    blocking_skill: 'needs_discovery',
    critical_findings: 0,
    assignee_count: 6,
    completion_rate: 0.33,
  },
  {
    assignment_id: 'asg_504',
    scenario_id: 'scn_founder_speed',
    scenario_name: 'High-income founder — 3 分鐘決策',
    persona_name: 'Daniel Ko',
    difficulty: 'medium',
    mode: 'training',
    mandatory: false,
    deadline: inDays(19),
    attempts_used: 1,
    max_attempts: 3,
    best_score: 71,
    minimum_score: 75,
    status: 'awaiting_retry',
    blocking_skill: 'communication_clarity',
    critical_findings: 1,
    assignee_count: 9,
    completion_rate: 0.44,
  },
];

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentProgressStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_retry: 'Retry required',
  completed: 'Completed',
  overdue: 'Overdue',
};
