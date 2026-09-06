'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ComplianceFindingType } from '@ai-coach/shared';
import { Download, ShieldAlert } from 'lucide-react';
import { Button, GlassCard, Pill, Select, StatTile } from '@/components/ui';
import { PageHeader } from '@/components/app-shell';
import { RiskPill } from '@/components/status';
import { MOCK_FINDINGS } from '@/lib/fixtures/evaluations';
import { MOCK_SESSIONS } from '@/lib/fixtures/sessions';
import { scenarioById } from '@/lib/fixtures/scenarios';
import { userById } from '@/lib/fixtures/identity';
import { useCan } from '@/lib/auth-context';
import { COMPLIANCE_TYPE_LABEL, REVIEWER_STATUS_LABEL } from '@/lib/enum-labels';
import { formatRelative } from '@/lib/utils';
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
        breadcrumbs={[{ label: '報表' }, { label: '合規' }]}
        title="合規報表"
        description="每一項發現都附上原始話術、違反的政策條款，以及建議的修正說法。"
        meta={
          <>
            <Pill tone={critical > 0 ? 'danger' : 'success'} size="sm">
              {critical} 項重大
            </Pill>
            <Pill tone={open > 0 ? 'warning' : 'success'} size="sm">
              {open} 項待處理
            </Pill>
          </>
        }
        actions={
          canExport ? (
            <Button variant="secondary" size="sm">
              <Download size={15} strokeWidth={1.8} aria-hidden />
              匯出稽核用檔案
            </Button>
          ) : null
        }
      />

      <ReportTabs current="compliance" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile surface="card" label="安全練習比例" value={`${safeRate}%`} hint="沒有高風險或重大發現" />
        <StatTile surface="card" label="發現總數" value={String(MOCK_FINDINGS.length)} hint="近 30 天" />
        <StatTile surface="card" label="待處理" value={String(open)} hint="等待審核者處理" />
        <StatTile surface="card" label="重大" value={String(critical)} hint="該場練習直接不通過" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <GlassCard className="p-5">
          <h2 className="text-card-title">依發現類型</h2>
          <ul className="mt-3 space-y-2.5">
            {byType.map(([type, count]) => (
              <li key={type}>
                <div className="flex items-center justify-between gap-3 text-body-sm">
                  <span>{COMPLIANCE_TYPE_LABEL[type] ?? type}</span>
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
                ariaLabel="嚴重程度"
                options={[
                  { value: 'all', label: '全部嚴重程度' },
                  { value: 'low', label: '低風險' },
                  { value: 'medium', label: '中風險' },
                  { value: 'high', label: '高風險' },
                  { value: 'critical', label: '重大風險' },
                ]}
              />
            </div>
            <div className="w-44">
              <Select
                value={status}
                onValueChange={setStatus}
                ariaLabel="審核狀態"
                options={[
                  { value: 'all', label: '全部狀態' },
                  { value: 'open', label: '待處理' },
                  { value: 'acknowledged', label: '已確認' },
                  { value: 'resolved', label: '已解決' },
                  { value: 'dismissed', label: '已排除' },
                ]}
              />
            </div>
            <p className="ml-auto text-body-sm text-text-tertiary">{findings.length} 項發現</p>
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
                            {COMPLIANCE_TYPE_LABEL[finding.type] ?? finding.type}
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
                            {REVIEWER_STATUS_LABEL[finding.reviewer_status] ?? finding.reviewer_status}
                          </Pill>
                          {finding.policy_rule ? (
                            <span className="text-tiny text-text-tertiary">{finding.policy_rule}</span>
                          ) : null}
                        </div>

                        <blockquote className="text-body">{finding.evidence}</blockquote>
                        <p className="mt-2 text-body-sm text-text-secondary">{finding.explanation}</p>
                        {finding.suggested_correction ? (
                          <p className="mt-1.5 text-body-sm">
                            <span className="meta-label mr-2 text-[color:color-mix(in_srgb,var(--success)_40%,var(--text-primary))]">建議修正</span>
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
                        <Link href={`/simulations/${finding.session_id}/review`}>開啟該場練習</Link>
                      </Button>
                    </div>
                  </GlassCard>
                </li>
              );
            })}
          </ul>

          {findings.length === 0 ? (
            <GlassCard className="dot-matrix p-8 text-center">
              <p className="text-body font-medium">沒有符合這些條件的發現</p>
              <p className="mt-1 text-body-sm text-text-secondary">
                這正是我們期望的狀態 — 可放寬條件再確認一次。
              </p>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
