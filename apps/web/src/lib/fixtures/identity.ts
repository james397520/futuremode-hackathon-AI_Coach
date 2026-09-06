import type { Team, User, Workspace } from '@ai-coach/shared';
import { NOW_ISO, SCOPE, TENANT_ID, daysAgo } from './constants';

export const MOCK_WORKSPACES: Workspace[] = [
  {
    id: 'ws_life_apac',
    tenant_id: TENANT_ID,
    name: '壽險與健康險 — 亞太區',
    kind: 'b2b',
    created_at: daysAgo(420),
    updated_at: daysAgo(2),
  },
  {
    id: 'ws_bancassurance',
    tenant_id: TENANT_ID,
    name: '銀行保險通路',
    kind: 'b2b',
    created_at: daysAgo(300),
    updated_at: daysAgo(9),
  },
  {
    id: 'ws_personal',
    tenant_id: TENANT_ID,
    name: '我的練習空間',
    kind: 'b2c',
    created_at: daysAgo(120),
    updated_at: daysAgo(1),
  },
];

/**
 * MOCK: the signed-in user. Roles can be overridden per-browser from
 * `localStorage['ai-coach:mock-role']` — see `src/lib/auth-context.tsx`.
 */
export const MOCK_CURRENT_USER: User & { theme_preference?: 'light' | 'dark' | 'system' } = {
  id: 'usr_lin',
  ...SCOPE,
  email: 'lin.yuchen@hexagon-life.example',
  display_name: '林昱辰',
  roles: ['trainee', 'coach', 'manager', 'admin'],
  team_ids: ['team_taipei_north'],
  created_at: daysAgo(400),
  updated_at: NOW_ISO,
  theme_preference: 'light',
};

export const MOCK_TEAMS: Team[] = [
  {
    id: 'team_taipei_north',
    ...SCOPE,
    name: '台北北區營業處',
    department: '直營通路',
    created_at: daysAgo(380),
    updated_at: daysAgo(4),
  },
  {
    id: 'team_taichung',
    ...SCOPE,
    name: '台中營業處',
    department: '直營通路',
    created_at: daysAgo(360),
    updated_at: daysAgo(6),
  },
  {
    id: 'team_bank_desk',
    ...SCOPE,
    name: '銀行臨櫃顧問組',
    department: '銀行保險',
    created_at: daysAgo(210),
    updated_at: daysAgo(11),
  },
];

export const MOCK_USERS: User[] = [
  MOCK_CURRENT_USER,
  {
    id: 'usr_chang',
    ...SCOPE,
    email: 'chang.weiting@hexagon-life.example',
    display_name: '張維庭',
    roles: ['trainee'],
    team_ids: ['team_taipei_north'],
    created_at: daysAgo(180),
    updated_at: daysAgo(1),
  },
  {
    id: 'usr_hsu',
    ...SCOPE,
    email: 'hsu.mei@hexagon-life.example',
    display_name: '許美玲',
    roles: ['trainee'],
    team_ids: ['team_taipei_north'],
    created_at: daysAgo(150),
    updated_at: daysAgo(1),
  },
  {
    id: 'usr_kuo',
    ...SCOPE,
    email: 'kuo.chiahao@hexagon-life.example',
    display_name: '郭家豪',
    roles: ['trainee'],
    team_ids: ['team_taichung'],
    created_at: daysAgo(140),
    updated_at: daysAgo(3),
  },
  {
    id: 'usr_yeh',
    ...SCOPE,
    email: 'yeh.shuchen@hexagon-life.example',
    display_name: '葉淑貞',
    roles: ['coach'],
    team_ids: ['team_taichung'],
    created_at: daysAgo(300),
    updated_at: daysAgo(2),
  },
  {
    id: 'usr_ong',
    ...SCOPE,
    email: 'ong.compliance@hexagon-life.example',
    display_name: '翁立偉',
    roles: ['reviewer'],
    team_ids: ['team_bank_desk'],
    created_at: daysAgo(260),
    updated_at: daysAgo(5),
  },
  {
    id: 'usr_tsai',
    ...SCOPE,
    email: 'tsai.manager@hexagon-life.example',
    display_name: '蔡明慧',
    roles: ['manager'],
    team_ids: ['team_bank_desk'],
    created_at: daysAgo(320),
    updated_at: daysAgo(7),
  },
];

export function userById(id: string): User | undefined {
  return MOCK_USERS.find((user) => user.id === id);
}

export function teamById(id: string): Team | undefined {
  return MOCK_TEAMS.find((team) => team.id === id);
}
