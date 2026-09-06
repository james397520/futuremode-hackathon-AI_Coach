'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { EyeOff, Merge, PencilLine, RefreshCw, Scissors } from 'lucide-react';
import { Button, GlassCard, Input, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { MOCK_CHUNKS, documentById, knowledgeBaseById } from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

/**
 * §30 Chunk Viewer — two columns: the chunk list on the left, the preview and its
 * editing actions on the right (edit / split / merge / re-embed / exclude).
 */
export function ChunkViewerPage({ kbId }: { kbId: string }) {
  const kb = knowledgeBaseById(kbId);
  const canManage = useCan('knowledge.manage');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(MOCK_CHUNKS[0]?.id ?? '');

  const chunks = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return MOCK_CHUNKS;
    return MOCK_CHUNKS.filter(
      (chunk) =>
        chunk.text.toLowerCase().includes(term) ||
        chunk.id.toLowerCase().includes(term) ||
        (chunk.section ?? '').toLowerCase().includes(term) ||
        chunk.tags.some((tag) => tag.includes(term)),
    );
  }, [query]);

  const selected = MOCK_CHUNKS.find((chunk) => chunk.id === selectedId) ?? chunks[0];

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '知識庫', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: '切片' },
        ]}
        title="切片檢視"
        description="看清楚檢索實際讀得到的內容。編輯切片會重新建立嵌入，並記錄在稽核日誌中。"
        meta={<Pill tone="neutral" size="sm">已載入 {MOCK_CHUNKS.length} 個切片</Pill>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <GlassCard className="flex min-h-0 flex-col p-4">
          <Input
            type="search"
            value={query}
            placeholder="以內容、id、章節或標籤篩選…"
            aria-label="篩選切片"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />

          <ul className="scroll-area mt-3 max-h-[560px] space-y-1.5">
            {chunks.map((chunk) => {
              const doc = documentById(chunk.document_id);
              const active = chunk.id === selected?.id;
              return (
                <li key={chunk.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(chunk.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-card-sm px-3.5 py-3 text-left transition-colors duration-150 ease-out-soft',
                      active
                        ? 'bg-glass-card [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--accent-indigo)_35%,transparent)]'
                        : 'hover:bg-glass-card',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body-sm font-medium">{chunk.id}</span>
                      <span className="text-tiny tabular-nums text-text-tertiary">{chunk.token_count}t</span>
                    </div>
                    <p className="mt-0.5 truncate text-tiny text-text-tertiary">
                      {doc?.filename ?? chunk.document_id}
                      {chunk.page !== undefined ? ` · p.${chunk.page}` : ''}
                    </p>
                    <p className="mt-1 line-clamp-2 text-body-sm text-text-secondary">{chunk.text}</p>
                    {chunk.excluded_from_retrieval ? (
                      <Pill tone="warning" size="sm" className="mt-1.5">已排除</Pill>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {chunks.length === 0 ? (
              <li className="px-3 py-6 text-center text-body-sm text-text-tertiary">沒有符合的切片。</li>
            ) : null}
          </ul>
        </GlassCard>

        {selected ? (
          <GlassCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-card-title">{selected.id}</h2>
                <p className="mt-0.5 text-body-sm text-text-tertiary">
                  {documentById(selected.document_id)?.filename ?? selected.document_id} · v
                  {selected.document_version} · 序號 {selected.index}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.page !== undefined ? <Pill tone="neutral" size="sm">第 {selected.page} 頁</Pill> : null}
                <Pill tone="neutral" size="sm">{selected.token_count} tokens</Pill>
                <Pill tone={selected.excluded_from_retrieval ? 'warning' : 'success'} size="sm">
                  {selected.excluded_from_retrieval ? '已排除於檢索之外' : '納入檢索'}
                </Pill>
              </div>
            </div>

            {selected.section ? (
              <p className="mt-3 text-body-sm">
                <span className="meta-label mr-2">章節標題</span>
                {selected.section}
              </p>
            ) : null}

            <div className="mt-4 rounded-card-sm border border-border-soft bg-glass-card p-4">
              <p className="whitespace-pre-wrap text-body">{selected.text}</p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="meta-label">中繼資料</p>
                <dl className="mt-2 space-y-1 text-body-sm">
                  {Object.entries(selected.metadata).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-text-tertiary">{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                  {Object.keys(selected.metadata).length === 0 ? (
                    <div className="text-text-tertiary">沒有產生中繼資料。</div>
                  ) : null}
                </dl>
              </div>
              <div>
                <p className="meta-label">標籤</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.tags.map((tag) => (
                    <Pill key={tag} tone="neutral" size="sm">{tag}</Pill>
                  ))}
                  {selected.tags.length === 0 ? (
                    <span className="text-body-sm text-text-tertiary">尚未加上標籤</span>
                  ) : null}
                </div>
                {selected.parent_chunk_id ? (
                  <p className="mt-3 text-body-sm">
                    <span className="meta-label mr-2">上層切片</span>
                    <button
                      type="button"
                      onClick={() => setSelectedId(selected.parent_chunk_id!)}
                      className="rounded-button text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
                    >
                      {selected.parent_chunk_id}
                    </button>
                  </p>
                ) : null}
              </div>
            </div>

            {canManage ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
                <Button variant="secondary" size="sm">
                  <PencilLine size={15} strokeWidth={1.8} aria-hidden />
                  編輯
                </Button>
                <Button variant="ghost" size="sm">
                  <Scissors size={15} strokeWidth={1.8} aria-hidden />
                  拆分
                </Button>
                <Button variant="ghost" size="sm">
                  <Merge size={15} strokeWidth={1.8} aria-hidden />
                  合併
                </Button>
                <Button variant="ghost" size="sm">
                  <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
                  重新嵌入
                </Button>
                <Button variant="ghost" size="sm">
                  <EyeOff size={15} strokeWidth={1.8} aria-hidden />
                  {selected.excluded_from_retrieval ? '納入檢索' : '排除檢索'}
                </Button>
              </div>
            ) : (
              <p className="mt-5 border-t border-border-soft pt-4 text-body-sm text-text-tertiary">
                你的角色可以檢視切片，但無法編輯。
              </p>
            )}

            <p className="mt-4 text-tiny text-text-tertiary">
              想知道這個切片實際的分數表現？{' '}
              <Link
                href={`/knowledge/${kbId}/playground`}
                className="text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
              >
                到檢索測試場試試看
              </Link>
              。
            </p>
          </GlassCard>
        ) : null}
      </div>
    </div>
  );
}
