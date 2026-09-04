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
          { label: 'Knowledge Base', href: '/knowledge' },
          { label: kb?.name ?? kbId, href: `/knowledge/${kbId}` },
          { label: 'Knowledge mining' },
        ]}
        title="Knowledge mining review"
        description="Golden phrases, objection patterns and scenario seeds mined from top-performer transcripts, coaching notes and escalation logs."
        meta={
          <>
            <Pill tone="warning" size="sm">{pendingCount} awaiting review</Pill>
            <Pill tone="neutral" size="sm">All sources anonymised</Pill>
          </>
        }
      />

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden className="text-accent-mint" />
          <h2 className="text-card-title">Mining pipeline</h2>
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2 text-body-sm text-text-secondary">
          {[
            'Transcript',
            'Anonymisation',
            'Segmentation',
            'Objection / intent extraction',
            'Best-response mining',
            'Human review',
            'Publish to playbook',
          ].map((stage, index, all) => (
            <li key={stage} className="flex items-center gap-2">
              <span
                className={
                  stage === 'Human review'
                    ? 'rounded-pill bg-glass-strong px-2.5 py-1 font-medium text-text-primary'
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
          { value: 'pending_review', label: 'Awaiting review', count: pendingCount },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'all', label: 'All', count: MOCK_MINING_CANDIDATES.length },
        ]}
      />

      {candidates.length === 0 ? (
        <GlassCard className="dot-matrix p-8 text-center">
          <p className="text-body font-medium">Nothing in this queue</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            New candidates appear after each batch of completed sessions is mined.
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
                          ? 'Awaiting review'
                          : candidate.status === 'approved'
                            ? 'Approved'
                            : 'Rejected'}
                      </Pill>
                      {candidate.anonymised ? <Pill tone="neutral" size="sm">Anonymised</Pill> : null}
                    </div>

                    <h3 className="text-card-title">{candidate.title}</h3>
                    <blockquote className="mt-2 border-l-2 border-accent-indigo/50 pl-3 text-body text-text-primary">
                      {candidate.extract}
                    </blockquote>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-body-sm">
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Source</dt>
                        <dd>{candidate.source_label}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Reference</dt>
                        <dd>{candidate.source_session_ref}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Occurrences</dt>
                        <dd className="tabular-nums">{candidate.occurrences}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-text-tertiary">Confidence</dt>
                        <dd className="tabular-nums">{Math.round(candidate.confidence * 100)}%</dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-body-sm">
                      <span className="meta-label mr-2">Publishes to</span>
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
                        Reject
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setDecisions((prev) => ({ ...prev, [candidate.id]: 'approved' }))}
                      >
                        <Check size={15} strokeWidth={2} aria-hidden />
                        Approve
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
        Approved items land in{' '}
        <Link href="/knowledge/kb_playbook" className="text-accent-indigo hover:underline">
          Top Performer Playbook
        </Link>{' '}
        and become retrievable for scenarios that select it.
      </p>
    </div>
  );
}
