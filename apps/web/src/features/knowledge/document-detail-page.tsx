'use client';

import Link from 'next/link';
import { Download, History, RefreshCw, ScanText } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { DocumentPipeline, DocumentStatePill } from '@/components/status';
import {
  chunksForDocument,
  documentById,
  knowledgeBaseById,
} from '@/lib/fixtures/knowledge';
import { useCan } from '@/lib/auth-context';
import { formatBytes, formatDate, formatRelative } from '@/lib/utils';

/** §58-17 Document Detail — pipeline state, versions and a chunk preview. */
export function DocumentDetailPage({ kbId, docId }: { kbId: string; docId: string }) {
  const kb = knowledgeBaseById(kbId);
  const doc = documentById(docId);
  const chunks = chunksForDocument(docId);
  const canManage = useCan('knowledge.manage');

  if (!kb || !doc) {
    return (
      <div className="space-y-4 pb-4">
        <PageHeader
          breadcrumbs={[{ label: '知識庫', href: '/knowledge' }]}
          title="找不到這份文件"
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/knowledge/${kbId}`}>返回這個知識庫</Link>
        </Button>
      </div>
    );
  }

  const versions = Array.from({ length: doc.active_version }, (_, index) => doc.active_version - index);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[
          { label: '知識庫', href: '/knowledge' },
          { label: kb.name, href: `/knowledge/${kb.id}` },
          { label: doc.filename },
        ]}
        title={doc.filename}
        description={`${doc.source_kind.toUpperCase()} · ${formatBytes(doc.size_bytes)} · 上傳於 ${formatRelative(doc.created_at)}`}
        meta={
          <>
            <DocumentStatePill state={doc.state} />
            <Pill tone="neutral" size="sm">v{doc.active_version} 為使用中版本</Pill>
            <Pill tone="neutral" size="sm">已索引 {chunks.length} 個切片</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              下載原始檔
            </Button>
            {canManage ? (
              <Button variant="secondary" size="sm">
                <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
                重新處理
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="space-y-4">
          <GlassCard className="p-5">
            <DocumentPipeline state={doc.state} progress={doc.progress} failureReason={doc.failure_reason} />
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <History size={15} strokeWidth={1.8} aria-hidden className="text-text-tertiary" />
              <h2 className="text-card-title">版本</h2>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">
              舊版本會保留供稽核查閱，但不會納入檢索。
            </p>
            <ul className="mt-3 space-y-2">
              {versions.map((version) => (
                <li
                  key={version}
                  className="border border-border-soft bg-glass-card flex items-center justify-between gap-3 rounded-card-sm px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-body-sm font-medium">版本 {version}</p>
                    <p className="text-tiny text-text-tertiary">
                      {version === doc.active_version
                        ? `使用中 · 以 ${kb.embedding_model} 建立嵌入`
                        : '已封存 · 保留供稽核'}
                    </p>
                  </div>
                  {version === doc.active_version ? (
                    <Pill tone="success" size="sm">使用中</Pill>
                  ) : (
                    <Pill tone="neutral" size="sm">已封存</Pill>
                  )}
                </li>
              ))}
            </ul>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <ScanText size={15} strokeWidth={1.8} aria-hidden className="text-text-tertiary" />
              <h2 className="text-card-title">內容擷取</h2>
            </div>
            <dl className="mt-3 space-y-2 text-body-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">OCR</dt>
                <dd>{doc.source_kind === 'pdf' ? '有需要時才套用' : '不需要'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">結構偵測</dt>
                <dd>{doc.state === 'ready' ? '標題 + 表格' : '尚未完成'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">切片策略</dt>
                <dd>{doc.source_kind === 'csv' ? '表格感知' : '語意切分'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">首次索引</dt>
                <dd>{formatDate(doc.created_at)}</dd>
              </div>
            </dl>
          </GlassCard>
        </div>

        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-card-title">切片預覽</h2>
              <p className="text-tiny text-text-tertiary">
                使用中版本的前 {chunks.length} 個切片
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/knowledge/${kb.id}/chunks?document=${doc.id}`}>開啟切片檢視</Link>
            </Button>
          </div>

          {chunks.length === 0 ? (
            <p className="mt-4 text-body-sm text-text-tertiary">
              目前還沒有產生任何切片。切分階段完成後就會出現。
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {chunks.map((chunk) => (
                <li key={chunk.id} className="border border-border-soft bg-glass-card rounded-card-sm p-4">
                  <div className="flex flex-wrap items-center gap-2 text-tiny text-text-tertiary">
                    <span className="font-medium text-text-secondary">{chunk.id}</span>
                    {chunk.page !== undefined ? <span>第 {chunk.page} 頁</span> : null}
                    {chunk.section ? <span className="truncate">{chunk.section}</span> : null}
                    <span className="tabular-nums">{chunk.token_count} tokens</span>
                    {chunk.excluded_from_retrieval ? (
                      <Pill tone="warning" size="sm">已排除</Pill>
                    ) : null}
                  </div>
                  <p className="mt-2 text-body-sm text-text-secondary">{chunk.text}</p>
                  {chunk.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chunk.tags.map((tag) => (
                        <Pill key={tag} tone="neutral" size="sm">{tag}</Pill>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
