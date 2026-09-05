'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, ScrollText, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { RiskPill } from '@/components/status';
import { MOCK_FINDINGS } from '@/lib/fixtures/evaluations';
import { SAFETY_CONTROLS, SECURITY_SUMMARY } from '@/lib/fixtures/security';
import { MOCK_SESSIONS } from '@/lib/fixtures/sessions';
import { userById } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import { formatDate, formatRelative, titleize } from '@/lib/utils';

/**
 * §41 Security & Audit — soft glass, deliberately *not* a black-and-red security
 * console. Summary tiles, the safety-control posture, then the finding rows.
 */
export function SecurityPage() {
  const canReview = useCan('finding.review');
  const canAudit = useCan('audit.view');
  const [status, setStatus] = useState('all');

  const findings = useMemo(
    () => MOCK_FINDINGS.filter((finding) => status === 'all' || finding.reviewer_status === status),
    [status],
  );

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        title="Security & Audit"
        description="AI safety posture, compliance findings and the immutable activity log for this workspace."
        meta={
          <>
            <Pill tone={SECURITY_SUMMARY.critical > 0 ? 'danger' : 'success'} size="sm">
              {SECURITY_SUMMARY.critical} critical
            </Pill>
            <Pill tone="neutral" size="sm">
              Last independent review {formatDate(SECURITY_SUMMARY.last_penetration_review)}
            </Pill>
          </>
        }
        actions={
          canAudit ? (
            <Button variant="secondary" size="sm" asChild>
              <Link href="/security/audit-log">
                <ScrollText size={15} strokeWidth={1.8} aria-hidden />
                Audit log
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="Safe sessions" value={SECURITY_SUMMARY.safe_sessions.toLocaleString('en-US')} hint="no finding above low" />
        <StatTile surface="card" label="Warnings" value={String(SECURITY_SUMMARY.warnings)} hint="last 30 days" />
        <StatTile surface="card" label="Critical" value={String(SECURITY_SUMMARY.critical)} hint="fails the session outright" />
        <StatTile surface="card" label="Open findings" value={String(SECURITY_SUMMARY.open_findings)} hint={`${SECURITY_SUMMARY.sessions_reviewed} sessions reviewed`} />
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden className="text-accent-mint" />
          <h2 className="text-card-title">Safety controls</h2>
        </div>
        <p className="mt-1 text-body-sm text-text-secondary">
          Enforced server-side on every turn. WebGPU acceleration never changes what is enforced — the
          server stays authoritative.
        </p>

        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {SAFETY_CONTROLS.map((control) => (
            <li key={control.id} className="rounded-card-sm border border-border-soft bg-glass-card p-4">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={
                    control.status === 'enforced'
                      ? 'mt-0.5 text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]'
                      : control.status === 'attention'
                        ? 'mt-0.5 text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]'
                        : 'mt-0.5 text-[color:color-mix(in_srgb,var(--accent-blue)_45%,var(--text-primary))]'
                  }
                >
                  {control.status === 'attention' ? (
                    <TriangleAlert size={15} strokeWidth={1.9} />
                  ) : control.status === 'monitoring' ? (
                    <Eye size={15} strokeWidth={1.9} />
                  ) : (
                    <CheckCircle2 size={15} strokeWidth={1.9} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-sm font-medium">{control.name}</p>
                    <Pill
                      tone={
                        control.status === 'enforced'
                          ? 'success'
                          : control.status === 'attention'
                            ? 'warning'
                            : 'info'
                      }
                      size="sm"
                    >
                      {titleize(control.status)}
                    </Pill>
                  </div>
                  <p className="mt-0.5 text-body-sm text-text-secondary">{control.description}</p>
                  <p className="mt-1 text-tiny text-text-tertiary">{control.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="text-card-title">Findings</h2>
          <div className="ml-auto w-44">
            <Select
              value={status}
              onValueChange={setStatus}
              ariaLabel="Reviewer status"
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'open', label: 'Open' },
                { value: 'acknowledged', label: 'Acknowledged' },
                { value: 'resolved', label: 'Resolved' },
                { value: 'dismissed', label: 'Dismissed' },
              ]}
            />
          </div>
        </div>

        <ul className="divide-y divide-border-soft/70">
          {findings.map((finding) => {
            const session = MOCK_SESSIONS.find((entry) => entry.session_id === finding.session_id);
            const learner = session ? userById(session.user_id) : undefined;
            return (
              <li key={finding.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-medium">{titleize(finding.type)}</p>
                  <p className="mt-0.5 truncate text-body-sm text-text-secondary" title={finding.evidence}>
                    {finding.evidence}
                  </p>
                  <p className="text-tiny text-text-tertiary">
                    {finding.session_id}
                    {learner ? ` · ${learner.display_name}` : ''}
                    {session ? ` · ${formatRelative(session.started_at)}` : ''}
                    {finding.policy_rule ? ` · ${finding.policy_rule}` : ''}
                  </p>
                </div>
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
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/simulations/${finding.session_id}/review`}>Session</Link>
                  </Button>
                  {canReview && finding.reviewer_status !== 'resolved' ? (
                    <Button variant="secondary" size="sm">Close finding</Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {findings.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-text-tertiary">
            No finding with that status.
          </p>
        ) : null}
      </GlassCard>

      <GlassCard className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h2 className="text-card-title">Independent security review</h2>
          <p className="text-body-sm text-text-secondary">
            The platform is positioned for third-party audit of the AI supply chain: prompt handling,
            tenant isolation, retrieval scoping and data retention. Last review{' '}
            {formatDate(SECURITY_SUMMARY.last_penetration_review)}.
          </p>
        </div>
        <Pill tone="success" size="sm">Isolation assertions in CI</Pill>
      </GlassCard>
    </div>
  );
}
