'use client';

import { Download } from 'lucide-react';
import { Button, GlassCard, Pill, ProgressBar, StatTile } from '@/components/ui';
import { BILLING_PERIOD, INVOICES, QUOTA_ROWS } from '@/lib/fixtures/settings';
import { formatCount, formatDate, titleize } from '@/lib/utils';
import { SettingsShell } from './settings-shell';

/** §46 Part I Billing / Quota. */
export function BillingSettingsPage() {
  const seats = QUOTA_ROWS.find((row) => row.id === 'seats');
  const simMinutes = QUOTA_ROWS.find((row) => row.id === 'sim_minutes');

  return (
    <SettingsShell
      title="Billing & usage"
      description={`Billing period ${formatDate(BILLING_PERIOD.start)} – ${formatDate(BILLING_PERIOD.end)}.`}
      meta={<Pill tone="neutral" size="sm">{BILLING_PERIOD.plan}</Pill>}
      actions={
        <Button variant="secondary" size="sm">
          <Download size={15} strokeWidth={1.8} aria-hidden />
          Download usage report
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Seats in use"
          value={seats ? `${seats.used} / ${seats.limit}` : '—'}
          hint="active learners this period"
        />
        <StatTile
          label="Simulation minutes"
          value={simMinutes ? formatCount(simMinutes.used) : '—'}
          hint={simMinutes ? `of ${formatCount(simMinutes.limit)}` : undefined}
        />
        <StatTile label="Voice minutes" value={formatCount(QUOTA_ROWS.find((row) => row.id === 'voice_minutes')?.used ?? 0)} hint="included in the plan" />
        <StatTile label="Next invoice" value={INVOICES[0]?.amount ?? '—'} hint={INVOICES[0] ? titleize(INVOICES[0].status) : undefined} />
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Quota</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Sessions are never cut off mid-conversation. When a quota is reached, new sessions are blocked and
          the workspace administrator is notified.
        </p>
        <ul className="mt-4 space-y-4">
          {QUOTA_ROWS.map((row) => {
            const percent = Math.round((row.used / row.limit) * 100);
            return (
              <li key={row.id}>
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-body-sm">
                  <span className="font-medium">{row.label}</span>
                  <span className="tabular-nums text-text-secondary">
                    {formatCount(row.used)} / {formatCount(row.limit)} {row.unit}
                    <span className="ml-2 text-text-tertiary">{percent}%</span>
                  </span>
                </div>
                <ProgressBar
                  value={percent}
                  tone={percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'default'}
                  label={`${row.label}: ${percent}% of quota used`}
                />
              </li>
            );
          })}
        </ul>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Invoices</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border-soft text-left">
                {['Period', 'Issued', 'Amount', 'Status', ''].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-2 py-2 text-tiny font-medium uppercase tracking-wide text-text-tertiary"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INVOICES.map((invoice) => (
                <tr key={invoice.id} className="border-b border-border-soft/60 last:border-b-0">
                  <td className="px-2 py-3 font-medium">{invoice.period}</td>
                  <td className="px-2 py-3 text-text-secondary">{formatDate(invoice.issued)}</td>
                  <td className="px-2 py-3 tabular-nums">{invoice.amount}</td>
                  <td className="px-2 py-3">
                    <Pill
                      tone={invoice.status === 'paid' ? 'success' : invoice.status === 'due' ? 'warning' : 'danger'}
                      size="sm"
                    >
                      {titleize(invoice.status)}
                    </Pill>
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Button variant="ghost" size="sm">
                      <Download size={14} strokeWidth={1.8} aria-hidden />
                      PDF
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </SettingsShell>
  );
}
