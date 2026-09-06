'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Plug,
  RefreshCw,
  Settings2,
  Unplug,
} from 'lucide-react';
import { Button, GlassCard, Pill, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import {
  CONNECTOR_CATEGORY_LABEL,
  MOCK_CONNECTORS,
  type Connector,
  type ConnectorCategory,
} from '@/lib/fixtures/integrations';
import { useCan } from '@/lib/auth-context';
import { formatRelative } from '@/lib/utils';

type Filter = 'all' | ConnectorCategory;

const STATUS_META: Record<Connector['status'], { label: string; tone: 'success' | 'neutral' | 'danger' }> = {
  connected: { label: '已連線', tone: 'success' },
  not_connected: { label: '尚未連線', tone: 'neutral' },
  error: { label: '連線異常', tone: 'danger' },
};

/**
 * §43 Integrations — connector cards with Connected / Not connected / Error,
 * last sync, and Test / Configure / Disconnect actions.
 *
 * Credentials are never displayed. A connected card shows a masked hint and says
 * where the secret actually lives (§56 / §70 / §71).
 */
export function IntegrationsPage() {
  const canManage = useCan('integration.manage');
  const [filter, setFilter] = useState<Filter>('all');
  const [testing, setTesting] = useState<string | null>(null);

  const connectors = useMemo(
    () => (filter === 'all' ? MOCK_CONNECTORS : MOCK_CONNECTORS.filter((entry) => entry.category === filter)),
    [filter],
  );

  const categories = useMemo(() => {
    const present = new Set(MOCK_CONNECTORS.map((entry) => entry.category));
    return [...present];
  }, []);

  const errored = MOCK_CONNECTORS.filter((entry) => entry.status === 'error').length;

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="整合服務"
        description="模型供應商、語音、向量資料庫、企業系統、身分驗證與通知管道。"
        meta={
          <>
            <Pill tone="success" size="sm">
              已連線 {MOCK_CONNECTORS.filter((entry) => entry.status === 'connected').length} 項
            </Pill>
            {errored > 0 ? <Pill tone="danger" size="sm">{errored} 項需要處理</Pill> : null}
          </>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value: string) => setFilter(value as Filter)}
        items={[
          { value: 'all', label: '全部', count: MOCK_CONNECTORS.length },
          ...categories.map((category) => ({
            value: category,
            label: CONNECTOR_CATEGORY_LABEL[category],
            count: MOCK_CONNECTORS.filter((entry) => entry.category === category).length,
          })),
        ]}
      />

      <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {connectors.map((connector) => {
          const meta = STATUS_META[connector.status];
          return (
            <li key={connector.id}>
              <GlassCard className="flex h-full flex-col p-5">
                <div className="flex items-start gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-avatar bg-glass-card text-accent-indigo"
                    aria-hidden
                  >
                    <Plug size={18} strokeWidth={1.7} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-card-title">{connector.name}</h2>
                    <p className="text-tiny text-text-tertiary">
                      {CONNECTOR_CATEGORY_LABEL[connector.category]}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className={
                      connector.status === 'connected'
                        ? 'mt-1 text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]'
                        : connector.status === 'error'
                          ? 'mt-1 text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]'
                          : 'mt-1 text-text-tertiary'
                    }
                  >
                    {connector.status === 'connected' ? (
                      <CheckCircle2 size={16} strokeWidth={1.9} />
                    ) : connector.status === 'error' ? (
                      <AlertTriangle size={16} strokeWidth={1.9} />
                    ) : (
                      <Circle size={16} strokeWidth={1.9} />
                    )}
                  </span>
                </div>

                <p className="mt-3 text-body-sm text-text-secondary">{connector.summary}</p>

                <dl className="mt-4 space-y-1.5 text-body-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">狀態</dt>
                    <dd>
                      <Pill tone={meta.tone} size="sm">{meta.label}</Pill>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">最近同步</dt>
                    <dd>{connector.last_sync ? formatRelative(connector.last_sync) : '從未同步'}</dd>
                  </div>
                  {connector.credential_hint ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-text-tertiary">憑證</dt>
                      <dd className="truncate text-tiny text-text-tertiary" title={connector.credential_hint}>
                        {connector.credential_hint}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {connector.detail ? (
                  <p
                    className={`mt-3 rounded-card-sm border border-border-soft px-3 py-2 text-body-sm ${
                      connector.status === 'error'
                        ? 'text-[color:color-mix(in_srgb,var(--danger)_55%,var(--text-primary))]'
                        : 'text-text-secondary'
                    }`}
                  >
                    {connector.detail}
                  </p>
                ) : null}

                {testing === connector.id ? (
                  <p
                    className="mt-2 text-tiny text-[color:color-mix(in_srgb,var(--accent-indigo)_70%,var(--text-primary))]"
                    role="status"
                  >
                    連線測試中…
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
                  {connector.status === 'not_connected' ? (
                    <Button variant="primary" size="sm" disabled={!canManage}>
                      連線
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canManage}
                        onClick={() => {
                          setTesting(connector.id);
                          window.setTimeout(() => setTesting(null), 1200);
                        }}
                      >
                        <RefreshCw size={14} strokeWidth={1.8} aria-hidden />
                        測試
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManage}>
                        <Settings2 size={14} strokeWidth={1.8} aria-hidden />
                        設定
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManage}>
                        <Unplug size={14} strokeWidth={1.8} aria-hidden />
                        中斷連線
                      </Button>
                    </>
                  )}
                </div>
              </GlassCard>
            </li>
          );
        })}
      </ul>

      <GlassCard className="p-5">
        <h2 className="text-card-title">憑證處理方式</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          供應商金鑰存放在伺服器端的機密管理服務中，也在那裡輪替。金鑰不會送到瀏覽器、不會打包進建置產物，而且頁面的內容安全政策只允許連線到本產品自己的 API —— 一旦寫錯，結果是明顯失敗，而不是悄悄外洩。
        </p>
      </GlassCard>
    </div>
  );
}
