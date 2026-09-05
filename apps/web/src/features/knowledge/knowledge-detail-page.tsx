'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Database, FileText, Lock, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { Button, GlassCard, Pill, Tooltip } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DocumentPipeline, DocumentStatePill } from '@/components/status';
import { documentsForKb, knowledgeBaseById, knowledgeReadiness } from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';
import { formatBytes, formatCount, formatRelative } from '@/lib/utils';
import { UploadModal } from './upload-modal';

/**
 * §26 Knowledge Overview + §27 Document Cards + §29 processing visual.
 *
 * The overview is one large glass card with the readiness figure, and the
 * embedding / vector / retrieval facts float beside it — the reference layout,
 * not a table of properties.
 */
export function KnowledgeDetailPage({ kbId }: { kbId: string }) {
  const kb = knowledgeBaseById(kbId);
  const documents = documentsForKb(kbId);
  const canManage = useCan('knowledge.manage');
  const [uploadOpen, setUploadOpen] = useState(false);

  if (!kb) {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          breadcrumbs={[{ label: 'Knowledge Base', href: '/knowledge' }]}
          title="Knowledge base not found"
          description="It may be scoped to a team or role you are not part of."
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/knowledge">Back to knowledge bases</Link>
        </Button>
      </div>
    );
  }

  const processing = documents.filter((doc) => !['ready', 'failed'].includes(doc.state));
  const readiness = knowledgeReadiness(kb);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Knowledge Base', href: '/knowledge' }, { label: kb.name }]}
        title={kb.name}
        description={kb.description}
        meta={
          <>
            <ContentStatusPill status={kb.status} />
            <Pill tone="neutral" size="sm">{kb.embedding_model}</Pill>
            <Pill tone="neutral" size="sm">Scope: {kb.acl.scope}</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/knowledge/${kb.id}/chunks`}>Chunk viewer</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/knowledge/${kb.id}/playground`}>
                <Database size={15} strokeWidth={1.8} aria-hidden />
                Playground
              </Link>
            </Button>
            {canManage ? (
              <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload size={15} strokeWidth={1.8} aria-hidden />
                Upload
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <GlassCard className="relative overflow-hidden p-6">
          <div className="dot-matrix pointer-events-none absolute inset-y-0 right-0 w-2/5 opacity-60" aria-hidden />
          <p className="meta-label">Knowledge readiness</p>
          <p className="mt-2 text-display tabular-nums">{readiness}%</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            {formatCount(kb.document_count)} documents · {formatCount(kb.chunk_count)} chunks · last indexed{' '}
            {formatRelative(kb.updated_at)}
          </p>

          <p className="mt-6 meta-label">Most recent batch</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="meta-label">Ready</p>
              <p className="mt-1 text-section tabular-nums">
                {documents.filter((doc) => doc.state === 'ready').length}
              </p>
            </div>
            <div>
              <p className="meta-label">Processing</p>
              <p className="mt-1 text-section tabular-nums">{processing.length}</p>
            </div>
            <div>
              <p className="meta-label">Failed</p>
              <p className="mt-1 text-section tabular-nums">
                {documents.filter((doc) => doc.state === 'failed').length}
              </p>
            </div>
          </div>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="p-5">
            <h2 className="text-card-title">Retrieval configuration</h2>
            <dl className="mt-3 space-y-2 text-body-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">Embedding model</dt>
                <dd className="truncate">{kb.embedding_model}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">Vector database</dt>
                <dd>Qdrant · collection {kb.id}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">Retrieval status</dt>
                <dd>
                  <Pill tone="success" size="sm">Live</Pill>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">Hybrid + rerank</dt>
                <dd>Enabled</dd>
              </div>
            </dl>
          </GlassCard>

          {/* §39 Knowledge Access Control */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Lock size={15} strokeWidth={1.8} aria-hidden className="text-accent-violet" />
              <h2 className="text-card-title">Access control</h2>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">
              Scope <span className="font-medium">{kb.acl.scope}</span> ·{' '}
              {kb.acl.subject_ids.length} subject(s). Retrieval outside this scope is impossible, not merely
              discouraged.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {kb.acl.permissions.map((permission) => (
                <Pill key={permission} tone="neutral" size="sm">
                  {permission.replace(/_/g, ' ')}
                </Pill>
              ))}
            </div>
          </GlassCard>

          {processing.length > 0 ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">In the pipeline</h2>
              <div className="mt-4 space-y-5">
                {processing.map((doc) => (
                  <div key={doc.id}>
                    <p className="mb-2 truncate text-body-sm font-medium">{doc.filename}</p>
                    <DocumentPipeline state={doc.state} progress={doc.progress} />
                  </div>
                ))}
              </div>
            </GlassCard>
          ) : null}
        </div>
      </div>

      {/* §27 Document cards */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-section">Documents</h2>
          <p className="text-body-sm text-text-tertiary">{documents.length} in this knowledge base</p>
        </div>

        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {documents.map((doc) => (
            <li key={doc.id}>
              <GlassCard className="group flex h-full flex-col p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-avatar bg-glass-card text-accent-blue"
                    aria-hidden
                  >
                    <FileText size={18} strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-body font-medium" title={doc.filename}>
                      {doc.filename}
                    </h3>
                    <p className="text-tiny uppercase text-text-tertiary">{doc.source_kind}</p>
                  </div>
                  <DocumentStatePill state={doc.state} />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 text-body-sm">
                  <div>
                    <dt className="meta-label">Size</dt>
                    <dd className="tabular-nums">{formatBytes(doc.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">Version</dt>
                    <dd className="tabular-nums">v{doc.active_version}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">Updated</dt>
                    <dd>{formatRelative(doc.updated_at)}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">Progress</dt>
                    <dd className="tabular-nums">{doc.progress}%</dd>
                  </div>
                </dl>

                {doc.state === 'failed' && doc.failure_reason ? (
                  <p className="mt-3 rounded-card-sm border border-border-soft px-3 py-2 text-body-sm text-text-secondary">
                    <span className="meta-label mr-2 text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">Error</span>
                    {doc.failure_reason}
                  </p>
                ) : null}

                {/* §27 hover actions — always keyboard reachable, not hover-only. */}
                <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/documents/${doc.id}`}>View</Link>
                  </Button>
                  {canManage ? (
                    <Tooltip content="Re-run parse → chunk → embed → index">
                      <Button variant="ghost" size="sm">
                        <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
                        Reprocess
                      </Button>
                    </Tooltip>
                  ) : null}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/chunks?document=${doc.id}`}>Chunks</Link>
                  </Button>
                </div>
              </GlassCard>
            </li>
          ))}
        </ul>
      </section>

      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <Sparkles size={17} strokeWidth={1.8} aria-hidden className="mt-0.5 text-accent-indigo" />
          <div>
            <h2 className="text-card-title">Turn this knowledge into training assets</h2>
            <p className="text-body-sm text-text-secondary">
              Mine top-performer transcripts and coaching notes into golden phrases, objection patterns and
              scenario seeds. Everything needs human review before publish.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/knowledge/${kb.id}/mining`}>Open knowledge mining</Link>
        </Button>
      </GlassCard>

      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} knowledgeBaseName={kb.name} />
    </div>
  );
}
