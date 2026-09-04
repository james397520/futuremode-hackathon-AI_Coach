'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Clock, Play, Search, Users } from 'lucide-react';
import { Button, EmptyState, GlassCard, Input, Pill, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DifficultyPill, ModePill } from '@/components/status';
import { MOCK_SCENARIOS } from '@/lib/fixtures/scenarios';
import { personaById } from '@/lib/fixtures/personas';
import { SCENARIO_MASTERY } from '@/lib/fixtures/reports';
import { useCan } from '@/lib/auth-context';
import { formatDuration, formatRelative } from '@/lib/utils';

type Filter = 'all' | 'training' | 'assessment' | 'draft';

/** §58-4 Simulation Library. Cards floating on the aurora, not a table (§99). */
export function SimulationLibraryPage() {
  const canBuild = useCan('scenario.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const scenarios = useMemo(() => {
    const term = query.trim().toLowerCase();
    return MOCK_SCENARIOS.filter((scenario) => {
      if (filter === 'training' && (scenario.mode !== 'training' || scenario.status !== 'published')) return false;
      if (filter === 'assessment' && scenario.mode !== 'assessment') return false;
      if (filter === 'draft' && scenario.status === 'published') return false;
      if (!term) return true;
      return [scenario.name, scenario.description, scenario.industry, scenario.training_type]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term));
    });
  }, [filter, query]);

  const masteryFor = (scenarioId: string) =>
    SCENARIO_MASTERY.find((entry) => entry.scenario_id === scenarioId);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="模擬練習"
        description="選擇情境，與 AI 模擬人物進行練習。每次對話會固定版本，確保報告可重現。"
        actions={
          canBuild ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/scenarios">管理訓練情境</Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(value: string) => setFilter(value as Filter)}
          items={[
            { value: 'all', label: '全部', count: MOCK_SCENARIOS.length },
            { value: 'training', label: '訓練' },
            { value: 'assessment', label: '評測' },
            { value: 'draft', label: '尚未發布' },
          ]}
        />
        <div className="relative ml-auto w-full max-w-xs">
          <Search
            size={15}
            strokeWidth={1.8}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            value={query}
            placeholder="篩選訓練情境…"
            aria-label="篩選訓練情境"
            className="pl-9"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {scenarios.length === 0 ? (
        <EmptyState
          title="找不到符合篩選條件的情境"
          description="請改用其他分類，或清除搜尋條件。"
          action={
            <Button variant="ghost" size="sm" onClick={() => { setFilter('all'); setQuery(''); }}>
              重設篩選
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {scenarios.map((scenario) => {
            const persona = personaById(scenario.persona_id);
            const mastery = masteryFor(scenario.id);
            const startable = scenario.status === 'published';

            return (
              <li key={scenario.id}>
                <GlassCard className="flex h-full flex-col p-5">
                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <DifficultyPill difficulty={scenario.difficulty} />
                    <ModePill mode={scenario.mode} />
                    <ContentStatusPill status={scenario.status} />
                    <Pill tone="neutral" size="sm">v{scenario.version}</Pill>
                  </div>

                  <h2 className="text-card-title">{scenario.name}</h2>
                  <p className="mt-1.5 line-clamp-3 text-body-sm text-text-secondary">
                    {scenario.description}
                  </p>

                  <dl className="mt-4 space-y-1.5 text-body-sm">
                    <div className="flex items-center gap-2">
                      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-text-tertiary">
                        <Users size={13} strokeWidth={1.8} aria-hidden />
                        模擬人物
                      </dt>
                      <dd className="truncate">{persona?.name ?? scenario.persona_id}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-text-tertiary">
                        <Clock size={13} strokeWidth={1.8} aria-hidden />
                        限制
                      </dt>
                      <dd>
                        {scenario.time_limit_seconds ? formatDuration(scenario.time_limit_seconds) : '不限時'}
                        {scenario.max_turns ? ` · ${scenario.max_turns} 回合` : ''}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-24 shrink-0 text-text-tertiary">知識庫</dt>
                      <dd className="truncate">{scenario.knowledge_base_ids.length} 個知識庫</dd>
                    </div>
                  </dl>

                  {mastery ? (
                    <p className="mt-3 text-tiny text-text-tertiary">
                      {mastery.attempts} 次嘗試 · 通過率 {Math.round(mastery.pass_rate * 100)}% · 平均{' '}
                      {mastery.average_score}
                    </p>
                  ) : null}

                  <p className="mt-1 text-tiny text-text-tertiary">
                    更新於 {formatRelative(scenario.updated_at)}
                  </p>

                  <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                    <Button variant="primary" size="sm" disabled={!startable} asChild={startable}>
                      {startable ? (
                        <Link href={`/simulations/${scenario.id}/setup`}>
                          <Play size={15} strokeWidth={2} aria-hidden />
                          設定練習
                        </Link>
                      ) : (
                        <>
                          <Play size={15} strokeWidth={2} aria-hidden />
                          等待發布
                        </>
                      )}
                    </Button>
                    {canBuild ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/scenarios/${scenario.id}/builder`}>編輯</Link>
                      </Button>
                    ) : null}
                  </div>
                </GlassCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
