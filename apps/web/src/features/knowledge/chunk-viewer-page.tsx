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
          { label: 'Knowledge Base', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: 'Chunks' },
        ]}
        title="Chunk viewer"
        description="Inspect exactly what retrieval can see. Editing a chunk re-embeds it and is recorded in the audit log."
        meta={<Pill tone="neutral" size="sm">{MOCK_CHUNKS.length} chunks loaded</Pill>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <GlassCard className="flex min-h-0 flex-col p-4">
          <Input
            type="search"
            value={query}
            placeholder="Filter by text, id, section or tag…"
            aria-label="Filter chunks"
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
                      active ? 'bg-glass-strong shadow-soft' : 'hover:bg-glass-card',
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
                      <Pill tone="warning" size="sm" className="mt-1.5">Excluded</Pill>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {chunks.length === 0 ? (
              <li className="px-3 py-6 text-center text-body-sm text-text-tertiary">No chunk matches.</li>
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
                  {selected.document_version} · index {selected.index}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selected.page !== undefined ? <Pill tone="neutral" size="sm">page {selected.page}</Pill> : null}
                <Pill tone="neutral" size="sm">{selected.token_count} tokens</Pill>
                <Pill tone={selected.excluded_from_retrieval ? 'warning' : 'success'} size="sm">
                  {selected.excluded_from_retrieval ? 'Excluded from retrieval' : 'In retrieval'}
                </Pill>
              </div>
            </div>

            {selected.section ? (
              <p className="mt-3 text-body-sm">
                <span className="meta-label mr-2">Heading</span>
                {selected.section}
              </p>
            ) : null}

            <div className="mt-4 rounded-card-sm border border-border-soft bg-glass-card p-4">
              <p className="whitespace-pre-wrap text-body">{selected.text}</p>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="meta-label">Metadata</p>
                <dl className="mt-2 space-y-1 text-body-sm">
                  {Object.entries(selected.metadata).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-text-tertiary">{key}</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                  {Object.keys(selected.metadata).length === 0 ? (
                    <div className="text-text-tertiary">No metadata generated.</div>
                  ) : null}
                </dl>
              </div>
              <div>
                <p className="meta-label">Tags</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.tags.map((tag) => (
                    <Pill key={tag} tone="neutral" size="sm">{tag}</Pill>
                  ))}
                  {selected.tags.length === 0 ? (
                    <span className="text-body-sm text-text-tertiary">Untagged</span>
                  ) : null}
                </div>
                {selected.parent_chunk_id ? (
                  <p className="mt-3 text-body-sm">
                    <span className="meta-label mr-2">Parent</span>
                    <button
                      type="button"
                      onClick={() => setSelectedId(selected.parent_chunk_id!)}
                      className="rounded-button text-accent-indigo hover:underline"
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
                  Edit
                </Button>
                <Button variant="ghost" size="sm">
                  <Scissors size={15} strokeWidth={1.8} aria-hidden />
                  Split
                </Button>
                <Button variant="ghost" size="sm">
                  <Merge size={15} strokeWidth={1.8} aria-hidden />
                  Merge
                </Button>
                <Button variant="ghost" size="sm">
                  <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
                  Re-embed
                </Button>
                <Button variant="ghost" size="sm">
                  <EyeOff size={15} strokeWidth={1.8} aria-hidden />
                  {selected.excluded_from_retrieval ? 'Include' : 'Exclude'}
                </Button>
              </div>
            ) : (
              <p className="mt-5 border-t border-border-soft pt-4 text-body-sm text-text-tertiary">
                Your role can read chunks but not edit them.
              </p>
            )}

            <p className="mt-4 text-tiny text-text-tertiary">
              Need to see how this chunk actually scores?{' '}
              <Link href={`/knowledge/${kbId}/playground`} className="text-accent-indigo hover:underline">
                Try it in the retrieval playground
              </Link>
              .
            </p>
          </GlassCard>
        ) : null}
      </div>
    </div>
  );
}
