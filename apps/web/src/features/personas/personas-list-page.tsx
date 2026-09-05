'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FlaskConical, Plus, Search } from 'lucide-react';
import { Button, EmptyState, GlassCard, Input, Pill, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill } from '@/components/status';
import { MOCK_PERSONAS } from '@/lib/fixtures/personas';
import { useCan } from '@/lib/auth-context';
import { formatRelative } from '@/lib/utils';

type Filter = 'all' | 'published' | 'review_required' | 'draft';

/** §58-10 Personas. */
export function PersonasListPage() {
  const canEdit = useCan('persona.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const personas = useMemo(() => {
    const term = query.trim().toLowerCase();
    return MOCK_PERSONAS.filter((persona) => {
      if (filter !== 'all' && persona.status !== filter) return false;
      if (!term) return true;
      return [persona.name, persona.occupation, persona.industry, persona.background]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term));
    });
  }, [filter, query]);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="客戶角色"
        description="具備個性參數、隱藏目標與語音的模擬客戶。隱藏設定只會傳送給教練與管理員角色。"
        actions={
          canEdit ? (
            <Button variant="primary" size="sm" asChild>
              <Link href="/personas/new">
                <Plus size={15} strokeWidth={2} aria-hidden />
                新增客戶角色
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(value: string) => setFilter(value as Filter)}
          items={[
            { value: 'all', label: '全部', count: MOCK_PERSONAS.length },
            { value: 'published', label: '已發布' },
            { value: 'review_required', label: '審核中' },
            { value: 'draft', label: '草稿' },
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
            placeholder="篩選客戶角色…"
            aria-label="篩選客戶角色"
            className="pl-9"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {personas.length === 0 ? (
        <EmptyState
          title="沒有符合的客戶角色"
          description="客戶角色可以跨情境重複使用 — 建立新的之前，先試著清除篩選條件。"
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {personas.map((persona) => (
            <li key={persona.id}>
              <GlassCard className="flex h-full flex-col p-5">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <ContentStatusPill status={persona.status} />
                  <Pill tone="neutral" size="sm">v{persona.version}</Pill>
                  <Pill tone="neutral" size="sm">{persona.locale}</Pill>
                  {persona.voice.provider !== 'none' ? (
                    <Pill tone="info" size="sm">語音</Pill>
                  ) : null}
                </div>

                <h2 className="text-card-title">{persona.name}</h2>
                <p className="text-body-sm text-text-tertiary">
                  {[persona.age ? `${persona.age}` : null, persona.occupation, persona.industry]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-2.5 line-clamp-3 text-body-sm text-text-secondary">{persona.background}</p>

                <div className="mt-4 space-y-2">
                  {(
                    [
                      ['價格敏感度', persona.traits.price_sensitivity],
                      ['抗拒程度', persona.traits.resistance],
                      ['信任度', persona.traits.trust],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <div className="flex justify-between text-tiny text-text-tertiary">
                        <span>{label}</span>
                        <span className="tabular-nums">{value}</span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-pill bg-border-soft">
                        <div
                          className="h-full rounded-pill"
                          style={{
                            width: `${value}%`,
                            background: 'var(--accent-indigo)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-tiny text-text-tertiary">
                  更新於 {formatRelative(persona.updated_at)}
                </p>

                <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/personas/${persona.id}`}>{canEdit ? '開啟編輯器' : '檢視'}</Link>
                  </Button>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/personas/${persona.id}/test-lab`}>
                        <FlaskConical size={15} strokeWidth={1.8} aria-hidden />
                        測試實驗室
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
