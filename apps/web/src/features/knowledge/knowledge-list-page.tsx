'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Database, Plus, Upload } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill } from '@/components/status';
import { MOCK_KNOWLEDGE_BASES, knowledgeReadiness } from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';
import { formatCount, formatRelative } from '@/lib/utils';
import { UploadModal } from './upload-modal';

/** §25 Knowledge Base page — cards on aurora, not a file manager (§25 is explicit). */
export function KnowledgeListPage() {
  const canManage = useCan('knowledge.manage');
  const searchParams = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);

  // The command palette deep-links here with ?upload=1 (§79 "Upload Document").
  useEffect(() => {
    if (searchParams.get('upload') === '1') setUploadOpen(true);
  }, [searchParams]);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="Knowledge Base"
        description="Private enterprise knowledge for your AI simulations."
        actions={
          canManage ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload size={15} strokeWidth={1.8} aria-hidden />
                Upload
              </Button>
              <Button variant="primary" size="sm">
                <Plus size={15} strokeWidth={2} aria-hidden />
                Create KB
              </Button>
            </>
          ) : null
        }
      />

      <ul className="grid gap-4 lg:grid-cols-2">
        {MOCK_KNOWLEDGE_BASES.map((kb) => {
          const readiness = knowledgeReadiness(kb);
          return (
            <li key={kb.id}>
              <GlassCard className="flex h-full flex-col p-5">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <ContentStatusPill status={kb.status} />
                  <Pill tone="neutral" size="sm">{kb.acl.scope}</Pill>
                  <Pill tone="neutral" size="sm">{kb.embedding_model}</Pill>
                </div>

                <h2 className="text-card-title">
                  <Link href={`/knowledge/${kb.id}`} className="hover:text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]">
                    {kb.name}
                  </Link>
                </h2>
                <p className="mt-1.5 text-body-sm text-text-secondary">{kb.description}</p>

                <div className="mt-4 flex items-end justify-between gap-4">
                  <div>
                    <p className="meta-label">Knowledge readiness</p>
                    <p className="mt-1 text-section tabular-nums">{readiness}%</p>
                  </div>
                  <dl className="text-right text-body-sm">
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">Documents</dt>
                      <dd className="tabular-nums">{formatCount(kb.document_count)}</dd>
                    </div>
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">Chunks</dt>
                      <dd className="tabular-nums">{formatCount(kb.chunk_count)}</dd>
                    </div>
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">Indexed</dt>
                      <dd>{formatRelative(kb.updated_at)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="mt-4 h-1.5 overflow-hidden rounded-pill bg-border-soft">
                  <div
                    className="h-full rounded-pill"
                    style={{
                      width: `${readiness}%`,
                      background: 'var(--accent-indigo)',
                    }}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}`}>Overview</Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/playground`}>
                      <Database size={15} strokeWidth={1.8} aria-hidden />
                      Retrieval playground
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/mining`}>Mining</Link>
                  </Button>
                </div>
              </GlassCard>
            </li>
          );
        })}
      </ul>

      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
