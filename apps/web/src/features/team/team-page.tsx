'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Mail, Search, UserPlus } from 'lucide-react';
import { Button, Avatar, GlassCard, Input, Pill, Select, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ScoreBar } from '@/components/data-viz';
import { MOCK_TEAMS, MOCK_USERS } from '@/lib/fixtures/identity';
import { TEAM_KPIS, TEAM_LEADERBOARD } from '@/lib/fixtures/reports';
import { SKILL_LABEL } from '@/lib/fixtures/evaluations';
import { ROLE_LABEL } from '@/lib/rbac';
import { useCan } from '@/lib/auth-context';
import { READINESS_LABEL } from '@/lib/enum-labels';
import { formatRelative } from '@/lib/utils';

/** §58-30 Team Management — people, roles, teams and readiness. */
export function TeamPage() {
  const canManage = useCan('team.manage');
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');

  const users = useMemo(() => {
    const term = query.trim().toLowerCase();
    return MOCK_USERS.filter((user) => {
      if (teamFilter !== 'all' && !user.team_ids.includes(teamFilter)) return false;
      if (!term) return true;
      return [user.display_name, user.email, ...user.roles].some((field) =>
        field.toLowerCase().includes(term),
      );
    });
  }, [query, teamFilter]);

  const readinessFor = (userId: string) => TEAM_LEADERBOARD.find((row) => row.user_id === userId);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="團隊"
        description="成員、角色與就緒度。啟用 SCIM 佈建時，角色會由身分提供者同步過來。"
        actions={
          canManage ? (
            <Button variant="primary" size="sm">
              <UserPlus size={15} strokeWidth={1.9} aria-hidden />
              邀請成員
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="成員人數" value={String(MOCK_USERS.length)} hint={`${MOCK_TEAMS.length} 個團隊`} />
        <StatTile surface="card" label="已就緒" value={String(TEAM_LEADERBOARD.filter((row) => row.readiness === 'ready').length)} hint="各項最低分數都達標" />
        <StatTile surface="card" label="成長中" value={String(TEAM_LEADERBOARD.filter((row) => row.readiness === 'developing').length)} hint="進度正常" />
        <StatTile surface="card" label="需要關注" value={String(TEAM_LEADERBOARD.filter((row) => row.readiness === 'at_risk').length)} hint="需要教練介入" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {TEAM_KPIS.map((team) => (
          <GlassCard key={team.team_id} className="p-5">
            <h2 className="text-card-title">{team.team_name}</h2>
            <p className="text-tiny text-text-tertiary">
              {team.members} 位學員 · {MOCK_TEAMS.find((entry) => entry.id === team.team_id)?.department ?? ''}
            </p>
            <div className="mt-3 space-y-3">
              <ScoreBar compact label="平均分數" score={team.average_score} threshold={80} />
              <ScoreBar compact label="通過率" score={Math.round(team.pass_rate * 100)} />
            </div>
            <Button variant="ghost" size="sm" className="mt-3" asChild>
              <Link href="/reports/team">團隊報告</Link>
            </Button>
          </GlassCard>
        ))}
      </div>

      <GlassCard className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-card-title">成員</h2>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-44">
              <Select
                value={teamFilter}
                onValueChange={setTeamFilter}
                ariaLabel="依團隊篩選"
                options={[
                  { value: 'all', label: '所有團隊' },
                  ...MOCK_TEAMS.map((team) => ({ value: team.id, label: team.name })),
                ]}
              />
            </div>
            <div className="relative w-56">
              <Search
                size={15}
                strokeWidth={1.8}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <Input
                type="search"
                value={query}
                placeholder="搜尋成員…"
                aria-label="搜尋成員"
                className="pl-9"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              />
            </div>
          </div>
        </div>

        <ul className="divide-y divide-border-soft/70">
          {users.map((user) => {
            const readiness = readinessFor(user.id);
            return (
              <li key={user.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <Avatar name={user.display_name} size="md" />
                <div className="min-w-0 flex-1">
                  <Link href={`/performance/${user.id}`} className="text-body-sm font-medium hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                    {user.display_name}
                  </Link>
                  <p className="flex items-center gap-1.5 text-tiny text-text-tertiary">
                    <Mail size={11} strokeWidth={1.8} aria-hidden />
                    {user.email}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {user.roles.map((role) => (
                    <Pill key={role} tone="neutral" size="sm">
                      {ROLE_LABEL[role]}
                    </Pill>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {user.team_ids.map((teamId) => (
                    <span key={teamId} className="text-tiny text-text-tertiary">
                      {MOCK_TEAMS.find((team) => team.id === teamId)?.name ?? teamId}
                    </span>
                  ))}
                </div>

                {readiness ? (
                  <>
                    <span className="w-16 text-right text-body-sm tabular-nums">{readiness.overall_score}</span>
                    <Pill
                      tone={
                        readiness.readiness === 'ready'
                          ? 'success'
                          : readiness.readiness === 'at_risk'
                            ? 'danger'
                            : 'warning'
                      }
                      size="sm"
                    >
                      {READINESS_LABEL[readiness.readiness] ?? readiness.readiness}
                    </Pill>
                    <span className="hidden text-tiny text-text-tertiary lg:inline">
                      最弱項 {SKILL_LABEL[readiness.weakest_skill]}
                    </span>
                  </>
                ) : (
                  <span className="text-tiny text-text-tertiary">尚無練習紀錄</span>
                )}

                <span className="text-tiny text-text-tertiary">{formatRelative(user.updated_at)}</span>
              </li>
            );
          })}
        </ul>

        {users.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-text-tertiary">沒有符合條件的成員。</p>
        ) : null}
      </GlassCard>
    </div>
  );
}
