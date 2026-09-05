/**
 * §9 RBAC — the permission vocabulary the UI gates on.
 *
 * The server is always authoritative; this map exists so we do not *render*
 * affordances a role cannot use (empty nav items, dead buttons, 403 round-trips).
 * Never treat a client-side check as a security boundary.
 */
import type { Role } from '@ai-coach/shared';

export const PERMISSIONS = [
  // trainee
  'training.view_assigned',
  'simulation.start',
  'simulation.voice',
  'performance.view_own',
  'session.retry',

  // coach / instructor
  'scenario.manage',
  'persona.manage',
  'rubric.manage',
  'question.manage',
  'transcript.review',
  'score.override',
  'coaching_note.write',
  'content.publish',

  // manager
  'training.assign',
  'team.review',
  'report.view_team',
  'report.export',
  'risk.view',

  // admin
  'workspace.manage',
  'team.manage',
  'user.manage',
  'knowledge.manage',
  'knowledge.acl.manage',
  'model.manage',
  'runtime.view_telemetry',
  'integration.manage',
  'security.view',
  'audit.view',
  'retention.manage',
  'billing.manage',

  // reviewer / compliance officer
  'finding.review',
  'finding.close',
  'compliance_rule.approve',

  // everybody
  'dashboard.view',
  'knowledge.view',
  'settings.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BASE: Permission[] = ['dashboard.view', 'settings.view'];

const TRAINEE: Permission[] = [
  ...BASE,
  'training.view_assigned',
  'simulation.start',
  'simulation.voice',
  'performance.view_own',
  'session.retry',
  'knowledge.view',
];

const COACH: Permission[] = [
  ...TRAINEE,
  'scenario.manage',
  'persona.manage',
  'rubric.manage',
  'question.manage',
  'transcript.review',
  'score.override',
  'coaching_note.write',
  'content.publish',
  'report.view_team',
];

const MANAGER: Permission[] = [
  ...TRAINEE,
  'training.assign',
  'team.review',
  'report.view_team',
  'report.export',
  'risk.view',
  'transcript.review',
];

const REVIEWER: Permission[] = [
  ...BASE,
  'knowledge.view',
  'transcript.review',
  'finding.review',
  'finding.close',
  'compliance_rule.approve',
  'rubric.manage',
  'security.view',
  'report.view_team',
  'performance.view_own',
];

const ADMIN: Permission[] = [
  // Admin is a superset in this product — workspace, identity, models, security.
  ...new Set<Permission>([...COACH, ...MANAGER, ...REVIEWER]),
  'workspace.manage',
  'team.manage',
  'user.manage',
  'knowledge.manage',
  'knowledge.acl.manage',
  'model.manage',
  'runtime.view_telemetry',
  'integration.manage',
  'security.view',
  'audit.view',
  'retention.manage',
  'billing.manage',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  trainee: TRAINEE,
  coach: COACH,
  manager: MANAGER,
  reviewer: REVIEWER,
  admin: ADMIN,
};

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return set;
}

export const ROLE_LABEL: Record<Role, string> = {
  trainee: '學員',
  coach: '教練',
  manager: '主管',
  admin: '管理者',
  reviewer: '合規審查者',
};
