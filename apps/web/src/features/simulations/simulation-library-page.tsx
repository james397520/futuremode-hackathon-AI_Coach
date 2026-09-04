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
        title="Simulations"
        description="Pick a scenario to practise against a live persona. Every session is version-pinned so its report stays reproducible."
        actions={
          canBuild ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/scenarios">Manage scenarios</Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(value: string) => setFilter(value as Filter)}
          items={[
            { value: 'all', label: 'All', count: MOCK_SCENARIOS.length },
            { value: 'training', label: 'Training' },
            { value: 'assessment', label: 'Assessment' },
            { value: 'draft', label: 'Not published' },
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
            placeholder="Filter scenarios…"
            aria-label="Filter scenarios"
            className="pl-9"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {scenarios.length === 0 ? (
        <EmptyState
          title="No scenario matches that filter"
          description="Try a different tab, or clear the search box."
          action={
            <Button variant="ghost" size="sm" onClick={() => { setFilter('all'); setQuery(''); }}>
              Reset filters
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
                        Persona
                      </dt>
                      <dd className="truncate">{persona?.name ?? scenario.persona_id}</dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-text-tertiary">
                        <Clock size={13} strokeWidth={1.8} aria-hidden />
                        Limit
                      </dt>
                      <dd>
                        {scenario.time_limit_seconds ? formatDuration(scenario.time_limit_seconds) : 'No limit'}
                        {scenario.max_turns ? ` · ${scenario.max_turns} turns` : ''}
                      </dd>
                    </div>
                    <div className="flex items-center gap-2">
                      <dt className="w-24 shrink-0 text-text-tertiary">Knowledge</dt>
                      <dd className="truncate">{scenario.knowledge_base_ids.length} knowledge base(s)</dd>
                    </div>
                  </dl>

                  {mastery ? (
                    <p className="mt-3 text-tiny text-text-tertiary">
                      {mastery.attempts} attempts · {Math.round(mastery.pass_rate * 100)}% pass rate · avg{' '}
                      {mastery.average_score}
                    </p>
                  ) : null}

                  <p className="mt-1 text-tiny text-text-tertiary">
                    Updated {formatRelative(scenario.updated_at)}
                  </p>

                  <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                    <Button variant="primary" size="sm" disabled={!startable} asChild={startable}>
                      {startable ? (
                        <Link href={`/simulations/${scenario.id}/setup`}>
                          <Play size={15} strokeWidth={2} aria-hidden />
                          Set up session
                        </Link>
                      ) : (
                        <>
                          <Play size={15} strokeWidth={2} aria-hidden />
                          Awaiting publish
                        </>
                      )}
                    </Button>
                    {canBuild ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/scenarios/${scenario.id}/builder`}>Edit</Link>
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
