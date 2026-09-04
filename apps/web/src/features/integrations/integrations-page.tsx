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
  connected: { label: 'Connected', tone: 'success' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
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
        title="Integrations"
        description="Model providers, speech, vector stores, business systems, identity and notification channels."
        meta={
          <>
            <Pill tone="success" size="sm">
              {MOCK_CONNECTORS.filter((entry) => entry.status === 'connected').length} connected
            </Pill>
            {errored > 0 ? <Pill tone="danger" size="sm">{errored} need attention</Pill> : null}
          </>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(value: string) => setFilter(value as Filter)}
        items={[
          { value: 'all', label: 'All', count: MOCK_CONNECTORS.length },
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
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
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
                        ? 'mt-1 text-state-success'
                        : connector.status === 'error'
                          ? 'mt-1 text-state-danger'
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
                    <dt className="text-text-tertiary">Status</dt>
                    <dd>
                      <Pill tone={meta.tone} size="sm">{meta.label}</Pill>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-tertiary">Last sync</dt>
                    <dd>{connector.last_sync ? formatRelative(connector.last_sync) : 'Never'}</dd>
                  </div>
                  {connector.credential_hint ? (
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-text-tertiary">Credential</dt>
                      <dd className="truncate text-tiny text-text-tertiary" title={connector.credential_hint}>
                        {connector.credential_hint}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {connector.detail ? (
                  <p
                    className={`mt-3 rounded-card-sm border border-border-soft px-3 py-2 text-body-sm ${
                      connector.status === 'error' ? 'text-state-danger' : 'text-text-secondary'
                    }`}
                  >
                    {connector.detail}
                  </p>
                ) : null}

                {testing === connector.id ? (
                  <p className="mt-2 text-tiny text-accent-indigo" role="status">
                    Testing connection…
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
                  {connector.status === 'not_connected' ? (
                    <Button variant="primary" size="sm" disabled={!canManage}>
                      Connect
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
                        Test
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManage}>
                        <Settings2 size={14} strokeWidth={1.8} aria-hidden />
                        Configure
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!canManage}>
                        <Unplug size={14} strokeWidth={1.8} aria-hidden />
                        Disconnect
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
        <h2 className="text-card-title">Credential handling</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          Provider keys are stored in the server-side secrets manager and rotated there. They are never sent
          to the browser, never embedded in a build, and the page’s content security policy only permits
          network calls to this product’s own API — so a regression fails loudly instead of leaking.
        </p>
      </GlassCard>
    </div>
  );
}
