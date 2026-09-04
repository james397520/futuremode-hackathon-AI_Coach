'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ComplianceFindingType } from '@ai-coach/shared-types';
import { Download, ShieldAlert } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { RiskPill } from '@/components/status';
import { MOCK_FINDINGS } from '@/lib/fixtures/evaluations';
import { MOCK_SESSIONS } from '@/lib/fixtures/sessions';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { userById } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import { formatRelative, titleize } from '@/lib/utils';
import { ReportTabs } from './report-tabs';

/** §32 Compliance Report. Glass, not a black-and-red security console (§41). */
export function ComplianceReportPage() {
  const canExport = useCan('report.export');
  const [severity, setSeverity] = useState('all');
  const [status, setStatus] = useState('all');

  const findings = useMemo(
    () =>
      MOCK_FINDINGS.filter(
        (finding) =>
          (severity === 'all' || finding.severity === severity) &&
          (status === 'all' || finding.reviewer_status === status),
      ),
    [severity, status],
  );

  const byType = useMemo(() => {
    const counts = new Map<ComplianceFindingType, number>();
    for (const finding of MOCK_FINDINGS) {
      counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);

  const open = MOCK_FINDINGS.filter((finding) => finding.reviewer_status === 'open').length;
  const critical = MOCK_FINDINGS.filter((finding) => finding.severity === 'critical').length;
  const safeRate = Math.round(
    ((MOCK_SESSIONS.length - MOCK_FINDINGS.filter((f) => f.severity === 'high' || f.severity === 'critical').length) /
      Math.max(1, MOCK_SESSIONS.length)) *
      100,
  );

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        breadcrumbs={[{ label: 'Reports' }, { label: 'Compliance' }]}
        title="Compliance report"
        description="Every finding carries the exact statement, the policy rule it breaches and a suggested correction."
        meta={
          <>
            <Pill tone={critical > 0 ? 'danger' : 'success'} size="sm">
              {critical} critical
            </Pill>
            <Pill tone={open > 0 ? 'warning' : 'success'} size="sm">
              {open} open
            </Pill>
          </>
        }
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              Export for audit
            </Button>
          ) : null
        }
      />

      <ReportTabs current="compliance" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Safe session rate" value={`${safeRate}%`} hint="no high or critical finding" />
        <StatTile label="Total findings" value={String(MOCK_FINDINGS.length)} hint="last 30 days" />
        <StatTile label="Open" value={String(open)} hint="awaiting reviewer action" />
        <StatTile label="Critical" value={String(critical)} hint="fails the session outright" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">By finding type</h2>
          <ul className="mt-3 space-y-2.5">
            {byType.map(([type, count]) => (
              <li key={type}>
                <div className="flex items-center justify-between gap-3 text-body-sm">
                  <span>{titleize(type)}</span>
                  <span className="tabular-nums text-text-tertiary">{count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-pill bg-border-soft">
                  <div
                    className="h-full rounded-pill"
                    style={{
                      width: `${(count / MOCK_FINDINGS.length) * 100}%`,
                      background: 'var(--accent-blue)',
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>

        <div className="space-y-4">
          <GlassCard className="flex flex-wrap items-end gap-4 p-4">
            <div className="w-44">
              <Select
                value={severity}
                onValueChange={setSeverity}
                aria-label="Severity"
                options={[
                  { value: 'all', label: 'All severities' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                  { value: 'critical', label: 'Critical' },
                ]}
              />
            </div>
            <div className="w-44">
              <Select
                value={status}
                onValueChange={setStatus}
                aria-label="Reviewer status"
                options={[
                  { value: 'all', label: 'All statuses' },
                  { value: 'open', label: 'Open' },
                  { value: 'acknowledged', label: 'Acknowledged' },
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'dismissed', label: 'Dismissed' },
                ]}
              />
            </div>
            <p className="ml-auto text-body-sm text-text-tertiary">{findings.length} finding(s)</p>
          </GlassCard>

          <ul className="space-y-3">
            {findings.map((finding) => {
              const session = MOCK_SESSIONS.find((entry) => entry.session_id === finding.session_id);
              const learner = session ? userById(session.user_id) : undefined;
              return (
                <li key={finding.id}>
                  <GlassCard className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5">
                          <Pill tone="neutral" size="sm">
                            <ShieldAlert size={11} strokeWidth={2} aria-hidden />
                            {titleize(finding.type)}
                          </Pill>
                          <RiskPill risk={finding.severity} />
                          <Pill
                            tone={
                              finding.reviewer_status === 'resolved'
                                ? 'success'
                                : finding.reviewer_status === 'open'
                                  ? 'warning'
                                  : 'neutral'
                            }
                            size="sm"
                          >
                            {titleize(finding.reviewer_status)}
                          </Pill>
                          {finding.policy_rule ? (
                            <span className="text-tiny text-text-tertiary">{finding.policy_rule}</span>
                          ) : null}
                        </div>

                        <blockquote className="text-body">{finding.evidence}</blockquote>
                        <p className="mt-2 text-body-sm text-text-secondary">{finding.explanation}</p>
                        {finding.suggested_correction ? (
                          <p className="mt-1.5 text-body-sm">
                            <span className="meta-label mr-2 text-state-success">Correction</span>
                            <span className="text-text-secondary">{finding.suggested_correction}</span>
                          </p>
                        ) : null}

                        <p className="mt-2.5 text-tiny text-text-tertiary">
                          {scenarioById(session?.scenario_id ?? '')?.name ?? finding.session_id}
                          {learner ? ` · ${learner.display_name}` : ''}
                          {session ? ` · ${formatRelative(session.started_at)}` : ''}
                        </p>
                      </div>

                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/simulations/${finding.session_id}/review`}>Open session</Link>
                      </Button>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ul>

          {findings.length === 0 ? (
            <GlassCard className="dot-matrix p-8 text-center">
              <p className="text-body font-medium">No finding matches these filters</p>
              <p className="mt-1 text-body-sm text-text-secondary">
                That is the intended state — widen the filters to confirm.
              </p>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
