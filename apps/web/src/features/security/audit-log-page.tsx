'use client';

import { useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Button, GlassCard, Input, Pill, Select } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { RiskPill } from '@/components/status';
import { AUDIT_ACTION_GROUPS, MOCK_AUDIT_EVENTS } from '@/lib/fixtures/security';
import { userById } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import { titleize } from '@/lib/utils';

/**
 * §42 Audit Log — Time / User / Action / Resource / Workspace / IP-Session /
 * Result / Risk, exactly the spec's column set. Append-only: there is no edit
 * or delete affordance anywhere on this page.
 */
export function AuditLogPage() {
  const canExport = useCan('report.export');
  const [group, setGroup] = useState<string>('all');
  const [result, setResult] = useState('all');
  const [query, setQuery] = useState('');

  const events = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matchers = AUDIT_ACTION_GROUPS.find((entry) => entry.id === group);
    const prefixes = matchers && 'match' in matchers ? (matchers.match as readonly string[]) : undefined;

    return MOCK_AUDIT_EVENTS.filter((event) => {
      if (prefixes && !prefixes.some((prefix) => event.action.startsWith(prefix))) return false;
      if (result !== 'all' && event.result !== result) return false;
      if (!term) return true;
      const user = event.user_id ? userById(event.user_id)?.display_name ?? event.user_id : 'service';
      return [event.action, event.resource, user, event.ip ?? '', event.session_ref ?? ''].some((field) =>
        field.toLowerCase().includes(term),
      );
    });
  }, [group, result, query]);

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Security & Audit', href: '/security' }, { label: 'Audit log' }]}
        title="Audit log"
        description="Append-only record of authentication, knowledge changes, prompt and model changes, permission changes, exports and API access."
        meta={<Pill tone="neutral" size="sm">Retention: 24 months</Pill>}
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              Export CSV
            </Button>
          ) : null
        }
      />

      <GlassCard className="flex flex-wrap items-end gap-3 p-4">
        <div className="w-56">
          <Select
            value={group}
            onValueChange={setGroup}
            aria-label="Activity type"
            options={AUDIT_ACTION_GROUPS.map((entry) => ({ value: entry.id, label: entry.label }))}
          />
        </div>
        <div className="w-40">
          <Select
            value={result}
            onValueChange={setResult}
            aria-label="Result"
            options={[
              { value: 'all', label: 'Any result' },
              { value: 'success', label: 'Success' },
              { value: 'denied', label: 'Denied' },
              { value: 'error', label: 'Error' },
            ]}
          />
        </div>
        <div className="relative ml-auto w-full max-w-xs">
          <Search
            size={15}
            strokeWidth={1.8}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
          />
          <Input
            type="search"
            value={query}
            placeholder="Search action, resource, user, IP…"
            aria-label="Search the audit log"
            className="pl-9"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <caption className="sr-only-live">
              Audit events, newest first. {events.length} rows shown.
            </caption>
            <thead>
              <tr className="border-b border-border-soft text-left">
                {['Time', 'User', 'Action', 'Resource', 'IP / session', 'Result', 'Risk'].map((heading) => (
                  <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 text-tiny font-medium uppercase tracking-wide text-text-tertiary">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const user = event.user_id ? userById(event.user_id) : undefined;
                return (
                  <tr key={event.id} className="border-b border-border-soft/60 last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-text-secondary">
                      {new Date(event.at).toLocaleString('en-GB', {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {user?.display_name ?? (event.user_id ? event.user_id : 'Service token')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">{event.action}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-text-secondary" title={event.resource}>
                      {event.resource}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-tiny text-text-tertiary">
                      {event.ip ?? '—'}
                      {event.session_ref ? ` · ${event.session_ref}` : ''}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Pill
                        tone={event.result === 'success' ? 'success' : event.result === 'denied' ? 'warning' : 'danger'}
                        size="sm"
                      >
                        {titleize(event.result)}
                      </Pill>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <RiskPill risk={event.risk} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {events.length === 0 ? (
          <p className="py-10 text-center text-body-sm text-text-tertiary">No event matches those filters.</p>
        ) : null}
      </GlassCard>

      <p className="text-tiny text-text-tertiary">
        Audit entries cannot be edited or deleted from the product. Retention and legal hold are configured
        by the workspace administrator.
      </p>
    </div>
  );
}
