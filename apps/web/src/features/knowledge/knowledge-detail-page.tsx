'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Database, FileText, Lock, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { Button, GlassCard, Pill, Tooltip } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { ContentStatusPill, DocumentPipeline, DocumentStatePill } from '@/components/status';
import { documentsForKb, knowledgeBaseById, knowledgeReadiness } from '@/lib/fixtures/knowledge';
import { ACL_SCOPE_LABEL, KB_PERMISSION_LABEL } from '@/lib/enum-labels';
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
          breadcrumbs={[{ label: '知識庫', href: '/knowledge' }]}
          title="找不到這個知識庫"
          description="它可能僅開放給你尚未加入的團隊或角色。"
        />
        <Button variant="secondary" size="sm" asChild>
          <Link href="/knowledge">返回知識庫列表</Link>
        </Button>
      </div>
    );
  }

  const processing = documents.filter((doc) => !['ready', 'failed'].includes(doc.state));
  const readiness = knowledgeReadiness(kb);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: '知識庫', href: '/knowledge' }, { label: kb.name }]}
        title={kb.name}
        description={kb.description}
        meta={
          <>
            <ContentStatusPill status={kb.status} />
            <Pill tone="neutral" size="sm">{kb.embedding_model}</Pill>
            <Pill tone="neutral" size="sm">範圍：{ACL_SCOPE_LABEL[kb.acl.scope] ?? kb.acl.scope}</Pill>
          </>
        }
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/knowledge/${kb.id}/chunks`}>切片檢視</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/knowledge/${kb.id}/playground`}>
                <Database size={15} strokeWidth={1.8} aria-hidden />
                測試場
              </Link>
            </Button>
            {canManage ? (
              <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload size={15} strokeWidth={1.8} aria-hidden />
                上傳文件
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <GlassCard className="relative overflow-hidden p-6">
          <div className="dot-matrix pointer-events-none absolute inset-y-0 right-0 w-2/5 opacity-60" aria-hidden />
          <p className="meta-label">知識就緒度</p>
          <p className="mt-2 text-display tabular-nums">{readiness}%</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            {formatCount(kb.document_count)} 份文件 · {formatCount(kb.chunk_count)} 個切片 · 最近索引於{' '}
            {formatRelative(kb.updated_at)}
          </p>

          <p className="mt-6 meta-label">最近一批處理</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="meta-label">已就緒</p>
              <p className="mt-1 text-section tabular-nums">
                {documents.filter((doc) => doc.state === 'ready').length}
              </p>
            </div>
            <div>
              <p className="meta-label">處理中</p>
              <p className="mt-1 text-section tabular-nums">{processing.length}</p>
            </div>
            <div>
              <p className="meta-label">失敗</p>
              <p className="mt-1 text-section tabular-nums">
                {documents.filter((doc) => doc.state === 'failed').length}
              </p>
            </div>
          </div>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="p-5">
            <h2 className="text-card-title">檢索設定</h2>
            <dl className="mt-3 space-y-2 text-body-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">嵌入模型</dt>
                <dd className="truncate">{kb.embedding_model}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">向量資料庫</dt>
                <dd>Qdrant · 集合 {kb.id}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">檢索狀態</dt>
                <dd>
                  <Pill tone="success" size="sm">運作中</Pill>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-tertiary">混合檢索 + 重排序</dt>
                <dd>已啟用</dd>
              </div>
            </dl>
          </GlassCard>

          {/* §39 Knowledge Access Control */}
          <GlassCard className="p-5">
            <div className="flex items-center gap-2">
              <Lock size={15} strokeWidth={1.8} aria-hidden className="text-accent-violet" />
              <h2 className="text-card-title">存取控管</h2>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">
              範圍 <span className="font-medium">{ACL_SCOPE_LABEL[kb.acl.scope] ?? kb.acl.scope}</span> ·{' '}
              共 {kb.acl.subject_ids.length} 個授權對象。超出這個範圍的檢索是做不到的，而不只是不建議。
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {kb.acl.permissions.map((permission) => (
                <Pill key={permission} tone="neutral" size="sm">
                  {KB_PERMISSION_LABEL[permission] ?? permission.replace(/_/g, ' ')}
                </Pill>
              ))}
            </div>
          </GlassCard>

          {processing.length > 0 ? (
            <GlassCard className="p-5">
              <h2 className="text-card-title">處理佇列中</h2>
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
          <h2 className="text-section">文件</h2>
          <p className="text-body-sm text-text-tertiary">這個知識庫共 {documents.length} 份</p>
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
                    <dt className="meta-label">大小</dt>
                    <dd className="tabular-nums">{formatBytes(doc.size_bytes)}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">版本</dt>
                    <dd className="tabular-nums">v{doc.active_version}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">更新時間</dt>
                    <dd>{formatRelative(doc.updated_at)}</dd>
                  </div>
                  <div>
                    <dt className="meta-label">進度</dt>
                    <dd className="tabular-nums">{doc.progress}%</dd>
                  </div>
                </dl>

                {doc.state === 'failed' && doc.failure_reason ? (
                  <p className="mt-3 rounded-card-sm border border-border-soft px-3 py-2 text-body-sm text-text-secondary">
                    <span className="meta-label mr-2 text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]">錯誤</span>
                    {doc.failure_reason}
                  </p>
                ) : null}

                {/* §27 hover actions — always keyboard reachable, not hover-only. */}
                <div className="mt-4 flex items-center gap-2 border-t border-border-soft pt-4">
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/documents/${doc.id}`}>檢視</Link>
                  </Button>
                  {canManage ? (
                    <Tooltip content="重新執行解析 → 切片 → 嵌入 → 索引">
                      <Button variant="ghost" size="sm">
                        <RefreshCw size={15} strokeWidth={1.8} aria-hidden />
                        重新處理
                      </Button>
                    </Tooltip>
                  ) : null}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/knowledge/${kb.id}/chunks?document=${doc.id}`}>切片</Link>
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
            <h2 className="text-card-title">把這些知識轉成訓練素材</h2>
            <p className="text-body-sm text-text-secondary">
              從頂尖業務的逐字稿與教練筆記中，探勘出金句、常見異議模式與情境種子。所有內容都必須經過人工審核才能發布。
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/knowledge/${kb.id}/mining`}>開啟知識探勘</Link>
        </Button>
      </GlassCard>

      <UploadModal open={uploadOpen} onOpenChange={setUploadOpen} knowledgeBaseName={kb.name} />
    </div>
  );
}
