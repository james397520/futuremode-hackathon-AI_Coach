'use client';

/**
 * Compliance warning — spec §17 (淡橘 / 淡紅 outline, **not** a big red alert)
 * and §32 (type, severity, timestamp, transcript evidence, policy rule,
 * explanation, suggested correction, reviewer status).
 */
import type { ComplianceFinding } from '@ai-coach/shared';

import { formatClock } from '../lib/format';
import { COMPLIANCE_RISK_LABEL, COMPLIANCE_RISK_TONE, COMPLIANCE_TYPE_LABEL } from '../lib/labels';
import { insetSurface, tint, toneText } from '../lib/tone';
import { TonePill } from './atoms';
import { AlertIcon, CheckIcon, ShieldIcon } from './icons';
import { cn } from './kit';

export interface ComplianceAlertProps {
  finding: ComplianceFinding;
  /** Session start, so the timestamp reads as a transcript timecode. */
  startedAtMs?: number | null;
  compact?: boolean;
  className?: string;
}

const REVIEWER_LABEL: Record<ComplianceFinding['reviewer_status'], string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

export function ComplianceAlert({
  finding,
  startedAtMs,
  compact = false,
  className,
}: ComplianceAlertProps) {
  const tone = COMPLIANCE_RISK_TONE[finding.severity] ?? 'warning';
  const at =
    typeof startedAtMs === 'number'
      ? formatClock(Math.max(0, finding.timestamp_ms - startedAtMs))
      : formatClock(finding.timestamp_ms);

  return (
    <section
      className={cn('rounded-card border p-4', className)}
      style={insetSurface(tone, compact ? 8 : 11)}
      aria-label={`Compliance warning: ${COMPLIANCE_TYPE_LABEL[finding.type] ?? finding.type}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <AlertIcon size={15} style={{ color: toneText(tone) }} />
        <h4 className="text-card-title" style={{ color: toneText(tone) }}>
          {COMPLIANCE_TYPE_LABEL[finding.type] ?? finding.type}
        </h4>
        <TonePill tone={tone} fill={18}>
          {COMPLIANCE_RISK_LABEL[finding.severity] ?? finding.severity}
        </TonePill>
        <span className="ml-auto text-tiny tabular-nums text-text-tertiary">{at}</span>
      </header>

      <p className="mt-2.5 text-body-sm text-text-secondary">{finding.explanation}</p>

      {finding.evidence ? (
        <figure className="mt-3">
          <figcaption className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
            Transcript evidence
          </figcaption>
          <blockquote
            className="mt-1 border-l-2 pl-3 text-body-sm text-text-primary"
            style={{ borderColor: tint(tone, 48) }}
          >
            「{finding.evidence}」
          </blockquote>
        </figure>
      ) : null}

      {!compact && finding.policy_rule ? (
        <p className="mt-3 flex items-start gap-2 text-tiny text-text-tertiary">
          <ShieldIcon size={13} className="mt-[1px] shrink-0" />
          <span>{finding.policy_rule}</span>
        </p>
      ) : null}

      {finding.suggested_correction ? (
        <div
          className="mt-3 rounded-card-sm border p-3"
          style={insetSurface('mint', 10)}
        >
          <div className="flex items-center gap-1.5 text-tiny uppercase tracking-[0.08em]" style={{ color: toneText('mint') }}>
            <CheckIcon size={12} />
            Suggested correction
          </div>
          <p className="mt-1.5 text-body-sm text-text-secondary">{finding.suggested_correction}</p>
        </div>
      ) : null}

      <footer className="mt-3 flex items-center justify-between text-tiny text-text-tertiary">
        <span>Reviewer status · {REVIEWER_LABEL[finding.reviewer_status] ?? finding.reviewer_status}</span>
        {finding.transcript_turn_id ? <span>Turn {finding.transcript_turn_id}</span> : null}
      </footer>
    </section>
  );
}
