'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Database, Plus, Upload } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill } from '@/components/status';
import { MOCK_KNOWLEDGE_BASES, knowledgeReadiness } from '@/lib/fixtures/knowledge';
import { ACL_SCOPE_LABEL } from '@/lib/enum-labels';
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
        title="知識庫"
        description="供 AI 模擬使用的企業內部知識。"
        actions={
          canManage ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload size={15} strokeWidth={1.8} aria-hidden />
                上傳文件
              </Button>
              <Button variant="primary" size="sm">
                <Plus size={15} strokeWidth={2} aria-hidden />
                建立知識庫
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
                  <Pill tone="neutral" size="sm">{ACL_SCOPE_LABEL[kb.acl.scope] ?? kb.acl.scope}</Pill>
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
                    <p className="meta-label">知識就緒度</p>
                    <p className="mt-1 text-section tabular-nums">{readiness}%</p>
                  </div>
                  <dl className="text-right text-body-sm">
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">文件</dt>
                      <dd className="tabular-nums">{formatCount(kb.document_count)}</dd>
                    </div>
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">切片</dt>
                      <dd className="tabular-nums">{formatCount(kb.chunk_count)}</dd>
                    </div>
                    <div className="flex justify-end gap-2">
                      <dt className="text-text-tertiary">最近索引</dt>
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
                    <Link href={`/knowledge/${kb.id}`}>總覽</Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/playground`}>
                      <Database size={15} strokeWidth={1.8} aria-hidden />
                      檢索測試場
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/mining`}>知識探勘</Link>
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
