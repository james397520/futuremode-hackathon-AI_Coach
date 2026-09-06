'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Check, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Button, GlassCard, Pill, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import {
  MINING_KIND_LABEL,
  MOCK_MINING_CANDIDATES,
  knowledgeBaseById,
  type MiningCandidate,
} from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';

type Filter = 'pending_review' | 'approved' | 'rejected' | 'all';

/**
 * §13 Part I Knowledge Mining Review.
 *
 * Pipeline: transcript → anonymisation → segmentation → objection/intent
 * extraction → best-response mining → **human review** → publish to playbook.
 * Nothing on this page is usable by a scenario until a person approves it.
 */
export function MiningReviewPage({ kbId }: { kbId: string }) {
  const kb = knowledgeBaseById(kbId);
  const canReview = useCan('content.publish');
  const [filter, setFilter] = useState<Filter>('pending_review');
  const [decisions, setDecisions] = useState<Record<string, MiningCandidate['status']>>({});

  const candidates = useMemo(() => {
    return MOCK_MINING_CANDIDATES.map((candidate) => ({
      ...candidate,
      status: decisions[candidate.id] ?? candidate.status,
    })).filter((candidate) => (filter === 'all' ? true : candidate.status === filter));
  }, [decisions, filter]);

  const pendingCount = MOCK_MINING_CANDIDATES.filter(
    (candidate) => (decisions[candidate.id] ?? candidate.status) === 'pending_review',
  ).length;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '知識庫', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: '知識探勘' },
        ]}
        title="知識探勘審核"
        description="從頂尖業務逐字稿、教練筆記與客訴升級紀錄中，探勘出的金句、常見異議模式與情境種子。"
        meta={
          <>
            <Pill tone="warning" size="sm">{pendingCount} 筆待審核</Pill>
            <Pill tone="neutral" size="sm">所有來源皆已去識別化</Pill>
          </>
        }
      />

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden className="text-accent-mint" />
          <h2 className="text-card-title">探勘流程</h2>
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-body-sm text-text-secondary">
          {[
            '逐字稿',
            '去識別化',
            '段落切分',
            '異議／意圖擷取',
            '最佳回應探勘',
            '人工審核',
            '發布到話術手冊',
          ].map((stage, index, all) => (
            <li key={stage} className="flex items-center gap-2">
              <span
                className={
                  stage === '人工審核'
                    ? 'rounded-pill bg-glass-card px-2.5 py-1 font-medium text-text-primary'
                    : 'rounded-pill px-2.5 py-1'
                }
              >
                {stage}
              </span>
              {index < all.length - 1 ? <span aria-hidden className="text-text-tertiary">→</span> : null}
            </li>
          ))}
        </ol>
      </GlassCard>

      <Tabs
        value={filter}
        onValueChange={(value: string) => setFilter(value as Filter)}
        items={[
          { value: 'pending_review', label: '待審核', count: pendingCount },
          { value: 'approved', label: '已通過' },
          { value: 'rejected', label: '已退回' },
          { value: 'all', label: '全部', count: MOCK_MINING_CANDIDATES.length },
        ]}
      />

      {candidates.length === 0 ? (
        <GlassCard className="dot-matrix p-8 text-center">
          <p className="text-body font-medium">這個佇列目前是空的</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            每批練習結束並完成探勘後，新的候選項目就會出現在這裡。
          </p>
        </GlassCard>
      ) : (
        <ul className="space-y-3">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <GlassCard className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <Pill tone={candidate.kind === 'anti_pattern' ? 'danger' : 'gradient'} size="sm">
                        <Sparkles size={11} strokeWidth={2} aria-hidden />
                        {MINING_KIND_LABEL[candidate.kind]}
                      </Pill>
                      <Pill
                        tone={
                          candidate.status === 'approved'
                            ? 'success'
                            : candidate.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                        size="sm"
                      >
                        {candidate.status === 'pending_review'
                          ? '待審核'
                          : candidate.status === 'approved'
                            ? '已通過'
                            : '已退回'}
                      </Pill>
                      {candidate.anonymised ? <Pill tone="neutral" size="sm">已去識別化</Pill> : null}
                    </div>

                    <h3 className="text-card-title">{candidate.title}</h3>
                    <blockquote className="mt-2 border-l-2 border-accent-indigo/50 pl-3 text-body text-text-primary">
                      {candidate.extract}
                    </blockquote>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-body-sm">
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">來源</dt>
                        <dd>{candidate.source_label}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">參考編號</dt>
                        <dd>{candidate.source_session_ref}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">出現次數</dt>
                        <dd className="tabular-nums">{candidate.occurrences}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">信心度</dt>
                        <dd className="tabular-nums">{Math.round(candidate.confidence * 100)}%</dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-body-sm">
                      <span className="meta-label mr-2">發布至</span>
                      <span className="text-text-secondary">{candidate.suggested_target}</span>
                    </p>
                  </div>

                  {canReview && candidate.status === 'pending_review' ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDecisions((prev) => ({ ...prev, [candidate.id]: 'rejected' }))}
                      >
                        <X size={15} strokeWidth={2} aria-hidden />
                        退回
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setDecisions((prev) => ({ ...prev, [candidate.id]: 'approved' }))}
                      >
                        <Check size={15} strokeWidth={2} aria-hidden />
                        通過
                      </Button>
                    </div>
                  ) : null}
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      )}

      <p className="text-tiny text-text-tertiary">
        審核通過的項目會進入
        <Link
          href="/knowledge/kb_playbook"
          className="text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))] hover:underline"
        >
          頂尖業務話術手冊
        </Link>
        ，之後選用該知識庫的情境就能檢索到這些內容。
      </p>
    </div>
  );
}
