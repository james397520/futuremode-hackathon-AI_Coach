'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Citation } from '@ai-coach/shared';
import { Search, Sparkles, ThumbsDown, ThumbsUp, Zap } from 'lucide-react';
import { Button, GlassCard, Input, Pill, Slider, Switch } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import {
  DEMO_RETRIEVAL_QUERY,
  MOCK_CITATIONS,
  RETRIEVAL_DEFAULTS,
  knowledgeBaseById,
} from '@/lib/fixtures/knowledge';
import { cn } from '@/lib/utils';

type Relevance = 'unmarked' | 'relevant' | 'irrelevant';

/**
 * §31 Retrieval Playground.
 *
 * Uses the transcript layout: a query box on top, results as document rows, and
 * the retrieval settings as a floating notes card on the right. Each result shows
 * *both* similarity and rerank score plus its source, and can be marked relevant
 * or not — that feedback is what calibrates the reranker (§12).
 */
export function RetrievalPlaygroundPage({ kbId }: { kbId: string }) {
  const kb = knowledgeBaseById(kbId);
  const [query, setQuery] = useState(DEMO_RETRIEVAL_QUERY);
  const [submitted, setSubmitted] = useState(DEMO_RETRIEVAL_QUERY);
  const [topK, setTopK] = useState<number>(RETRIEVAL_DEFAULTS.top_k);
  const [threshold, setThreshold] = useState<number>(RETRIEVAL_DEFAULTS.threshold);
  const [hybrid, setHybrid] = useState<boolean>(RETRIEVAL_DEFAULTS.hybrid);
  const [rerank, setRerank] = useState<boolean>(RETRIEVAL_DEFAULTS.rerank);
  const [marks, setMarks] = useState<Record<string, Relevance>>({});

  const ranked: Citation[] = [...MOCK_CITATIONS]
    .filter((citation) => citation.similarity >= threshold - 0.0001)
    .sort((a, b) =>
      rerank
        ? (b.rerank_score ?? b.similarity) - (a.rerank_score ?? a.similarity)
        : b.similarity - a.similarity,
    )
    .slice(0, topK);

  const mark = (chunkId: string, value: Relevance) =>
    setMarks((prev) => ({ ...prev, [chunkId]: prev[chunkId] === value ? 'unmarked' : value }));

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: 'Knowledge Base', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: 'Retrieval playground' },
        ]}
        title="Retrieval playground"
        description="Ask what a trainee would ask and see exactly which chunks the agent would ground on."
        meta={
          <>
            <Pill tone="neutral" size="sm">{kb?.embedding_model ?? 'embedding model'}</Pill>
            <Pill tone={rerank ? 'success' : 'neutral'} size="sm">
              Reranker {rerank ? 'on' : 'off'}
            </Pill>
            <Pill tone={hybrid ? 'success' : 'neutral'} size="sm">
              Hybrid {hybrid ? 'on' : 'off'}
            </Pill>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="space-y-4">
          <GlassCard className="p-4">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(query);
              }}
            >
              <span className="pl-1 text-text-tertiary" aria-hidden>
                <Search size={17} strokeWidth={1.8} />
              </span>
              <Input
                value={query}
                placeholder="Test your knowledge retrieval…"
                aria-label="Retrieval query"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              />
              <Button type="submit" variant="primary" size="md">
                Run
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                DEMO_RETRIEVAL_QUERY,
                '重大疾病的等待期是多久？',
                '38 歲男性 300 萬重疾保費大概多少？',
                '哪些話術是禁止使用的？',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setQuery(preset);
                    setSubmitted(preset);
                  }}
                  className="rounded-pill border border-border-soft px-3 py-1 text-tiny text-text-secondary hover:text-text-primary"
                >
                  {preset}
                </button>
              ))}
            </div>
          </GlassCard>

          <div className="flex items-center justify-between gap-3">
            <p className="text-body-sm text-text-secondary">
              {ranked.length} result{ranked.length === 1 ? '' : 's'} for「{submitted}」
            </p>
            <p className="flex items-center gap-1.5 text-tiny text-text-tertiary">
              <Zap size={12} strokeWidth={2} aria-hidden />
              38 ms vector · 61 ms rerank
            </p>
          </div>

          <ol className="space-y-3">
            {ranked.map((citation, index) => {
              const relevance = marks[citation.chunk_id] ?? 'unmarked';
              return (
                <li key={citation.chunk_id}>
                  <GlassCard tone="strong" className="p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="text-section tabular-nums text-text-tertiary">#{index + 1}</span>
                        <div>
                          <p className="text-body font-medium">{citation.document_name}</p>
                          <p className="text-tiny text-text-tertiary">
                            v{citation.document_version}
                            {citation.page !== undefined ? ` · page ${citation.page}` : ''}
                            {citation.section ? ` · ${citation.section}` : ''} · {citation.chunk_id}
                          </p>
                        </div>
                      </div>

                      <dl className="flex items-center gap-4 text-body-sm">
                        <div className="text-right">
                          <dt className="meta-label">Similarity</dt>
                          <dd className="tabular-nums">{citation.similarity.toFixed(2)}</dd>
                        </div>
                        <div className="text-right">
                          <dt className="meta-label">Rerank</dt>
                          <dd className="tabular-nums">
                            {citation.rerank_score !== undefined ? citation.rerank_score.toFixed(2) : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <p className="mt-3 text-body text-text-secondary">{citation.snippet}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3.5">
                      <span className="meta-label">Was this relevant?</span>
                      <button
                        type="button"
                        onClick={() => mark(citation.chunk_id, 'relevant')}
                        aria-pressed={relevance === 'relevant'}
                        className={cn(
                          'flex items-center gap-1.5 rounded-pill border px-3 py-1 text-tiny',
                          relevance === 'relevant'
                            ? 'border-state-success text-state-success'
                            : 'border-border-soft text-text-secondary hover:text-text-primary',
                        )}
                      >
                        <ThumbsUp size={12} strokeWidth={2} aria-hidden />
                        Relevant
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(citation.chunk_id, 'irrelevant')}
                        aria-pressed={relevance === 'irrelevant'}
                        className={cn(
                          'flex items-center gap-1.5 rounded-pill border px-3 py-1 text-tiny',
                          relevance === 'irrelevant'
                            ? 'border-state-danger text-state-danger'
                            : 'border-border-soft text-text-secondary hover:text-text-primary',
                        )}
                      >
                        <ThumbsDown size={12} strokeWidth={2} aria-hidden />
                        Not relevant
                      </button>
                      <Link
                        href={`/knowledge/${kbId}/chunks`}
                        className="ml-auto text-tiny text-accent-indigo hover:underline"
                      >
                        Open in chunk viewer
                      </Link>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ol>

          {ranked.length === 0 ? (
            <GlassCard className="dot-matrix p-8 text-center">
              <p className="text-body font-medium">Nothing passed the threshold</p>
              <p className="mt-1 text-body-sm text-text-secondary">
                Lower the similarity threshold, or check whether the source document finished indexing.
              </p>
            </GlassCard>
          ) : null}
        </div>

        {/* §31 floating notes card */}
        <div className="space-y-4">
          <GlassCard tone="strong" className="p-5">
            <h2 className="text-card-title">Retrieval settings</h2>
            <div className="mt-4 space-y-5">
              <Slider
                label="Top K"
                min={1}
                max={10}
                step={1}
                value={topK}
                onValueChange={setTopK}
              />
              <Slider
                label="Threshold"
                formatValue={(value) => value.toFixed(2)}
                hint="Chunks below this similarity are discarded before reranking."
                min={0.4}
                max={0.95}
                step={0.01}
                value={threshold}
                onValueChange={setThreshold}
              />
              <Switch checked={hybrid} onCheckedChange={setHybrid} label="Hybrid (BM25 + vector)" />
              <Switch checked={rerank} onCheckedChange={setRerank} label="Reranker" />
            </div>

            <p className="mt-5 border-t border-border-soft pt-4 text-tiny text-text-tertiary">
              These settings are for testing only. Scenario retrieval uses the workspace defaults in
              Settings → Models.
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Sparkles size={15} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">Why rerank matters</h2>
            </div>
            <p className="mt-2 text-body-sm text-text-secondary">
              In this query the forbidden-phrases chunk scores 0.74 on similarity but only 0.41 after
              reranking — vector similarity alone would have grounded the answer on the wrong document.
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
