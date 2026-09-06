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
          { label: '知識庫', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: '檢索測試場' },
        ]}
        title="檢索測試場"
        description="用學員會問的問題實際問一次，看看 AI 會根據哪些切片作答。"
        meta={
          <>
            <Pill tone="neutral" size="sm">{kb?.embedding_model ?? '嵌入模型'}</Pill>
            <Pill tone={rerank ? 'success' : 'neutral'} size="sm">
              重排序{rerank ? '已開啟' : '已關閉'}
            </Pill>
            <Pill tone={hybrid ? 'success' : 'neutral'} size="sm">
              混合檢索{hybrid ? '已開啟' : '已關閉'}
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
                placeholder="測試你的知識檢索…"
                aria-label="檢索查詢"
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
              />
              <Button type="submit" variant="primary" size="md">
                執行
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
              「{submitted}」共 {ranked.length} 筆結果
            </p>
            <p className="flex items-center gap-1.5 text-tiny text-text-tertiary">
              <Zap size={12} strokeWidth={2} aria-hidden />
              向量 38 ms · 重排序 61 ms
            </p>
          </div>

          <ol className="space-y-3">
            {ranked.map((citation, index) => {
              const relevance = marks[citation.chunk_id] ?? 'unmarked';
              return (
                <li key={citation.chunk_id}>
                  <GlassCard className="p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="text-section tabular-nums text-text-tertiary">#{index + 1}</span>
                        <div>
                          <p className="text-body font-medium">{citation.document_name}</p>
                          <p className="text-tiny text-text-tertiary">
                            v{citation.document_version}
                            {citation.page !== undefined ? ` · 第 ${citation.page} 頁` : ''}
                            {citation.section ? ` · ${citation.section}` : ''} · {citation.chunk_id}
                          </p>
                        </div>
                      </div>

                      <dl className="flex items-center gap-4 text-body-sm">
                        <div className="text-right">
                          <dt className="meta-label">相似度</dt>
                          <dd className="tabular-nums">{citation.similarity.toFixed(2)}</dd>
                        </div>
                        <div className="text-right">
                          <dt className="meta-label">重排序</dt>
                          <dd className="tabular-nums">
                            {citation.rerank_score !== undefined ? citation.rerank_score.toFixed(2) : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <p className="mt-3 text-body text-text-secondary">{citation.snippet}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-soft pt-3.5">
                      <span className="meta-label">這筆結果相關嗎？</span>
                      <button
                        type="button"
                        onClick={() => mark(citation.chunk_id, 'relevant')}
                        aria-pressed={relevance === 'relevant'}
                        className={cn(
                          'flex items-center gap-1.5 rounded-pill border px-3 py-1 text-tiny',
                          relevance === 'relevant'
                            ? 'border-[color:color-mix(in_srgb,var(--success)_55%,transparent)] font-medium text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]'
                            : 'border-border-soft text-text-secondary hover:text-text-primary',
                        )}
                      >
                        <ThumbsUp size={12} strokeWidth={2} aria-hidden />
                        相關
                      </button>
                      <button
                        type="button"
                        onClick={() => mark(citation.chunk_id, 'irrelevant')}
                        aria-pressed={relevance === 'irrelevant'}
                        className={cn(
                          'flex items-center gap-1.5 rounded-pill border px-3 py-1 text-tiny',
                          relevance === 'irrelevant'
                            ? 'border-[color:color-mix(in_srgb,var(--danger)_55%,transparent)] font-medium text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]'
                            : 'border-border-soft text-text-secondary hover:text-text-primary',
                        )}
                      >
                        <ThumbsDown size={12} strokeWidth={2} aria-hidden />
                        不相關
                      </button>
                      <Link
                        href={`/knowledge/${kbId}/chunks`}
                        className="ml-auto text-tiny text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
                      >
                        在切片檢視中開啟
                      </Link>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ol>

          {ranked.length === 0 ? (
            <GlassCard className="dot-matrix p-8 text-center">
              <p className="text-body font-medium">沒有結果通過門檻</p>
              <p className="mt-1 text-body-sm text-text-secondary">
                試著調低相似度門檻，或確認來源文件是否已完成索引。
              </p>
            </GlassCard>
          ) : null}
        </div>

        {/* §31 floating notes card */}
        <div className="space-y-4">
          <GlassCard tone="strong" className="p-5">
            <h2 className="text-card-title">檢索設定</h2>
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
                label="相似度門檻"
                formatValue={(value) => value.toFixed(2)}
                hint="相似度低於此值的切片，會在重排序之前先被捨棄。"
                min={0.4}
                max={0.95}
                step={0.01}
                value={threshold}
                onValueChange={setThreshold}
              />
              <Switch checked={hybrid} onCheckedChange={setHybrid} label="混合檢索（BM25 + 向量）" />
              <Switch checked={rerank} onCheckedChange={setRerank} label="重排序" />
            </div>

            <p className="mt-5 border-t border-border-soft pt-4 text-tiny text-text-tertiary">
              這裡的設定僅供測試使用。情境實際檢索時，採用的是工作區在「設定 → 模型」中的預設值。
            </p>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Sparkles size={15} strokeWidth={1.8} aria-hidden className="text-accent-indigo" />
              <h2 className="text-card-title">為什麼需要重排序</h2>
            </div>
            <p className="mt-2 text-body-sm text-text-secondary">
              在這個查詢中，禁用話術那個切片的相似度有 0.74，重排序後卻只剩 0.41 —— 只看向量相似度的話，答案就會建立在錯誤的文件上。
            </p>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
