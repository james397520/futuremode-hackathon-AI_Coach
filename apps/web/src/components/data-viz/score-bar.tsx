import { cn, clamp } from '@/lib/utils';

/**
 * §38 — horizontal score bars are the primary score visual. No gauges, no pies.
 * Colour never carries the meaning on its own: the number and the band label are
 * always present (§47 "no color-only status").
 */
export function scoreBand(score: number): { label: string; token: string } {
  if (score >= 85) return { label: '優秀', token: 'var(--success)' };
  if (score >= 75) return { label: '穩健', token: 'var(--accent-blue)' };
  if (score >= 65) return { label: '發展中', token: 'var(--warning)' };
  return { label: '待加強', token: 'var(--danger)' };
}

export function ScoreBar({
  label,
  score,
  threshold,
  confidence,
  className,
  compact = false,
}: {
  label: string;
  score: number;
  /** Renders the rubric pass threshold as a tick. */
  threshold?: number;
  confidence?: number;
  className?: string;
  compact?: boolean;
}) {
  const value = clamp(score);
  const band = scoreBand(value);

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className={cn('truncate', compact ? 'text-body-sm' : 'text-body-sm font-medium')}>{label}</span>
        <span className="flex shrink-0 items-baseline gap-2">
          <span className="text-body-sm font-semibold tabular-nums">{value}</span>
          <span className="text-tiny text-text-tertiary">{band.label}</span>
        </span>
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-pill bg-border-soft"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${value} out of 100, ${band.label}`}
      >
        <div
          className="h-full rounded-pill transition-[width] duration-500 ease-out-soft"
          style={{ width: `${value}%`, background: band.token }}
        />
        {threshold !== undefined ? (
          <span
            aria-hidden
            className="absolute top-0 h-full w-px bg-text-tertiary/60"
            style={{ left: `${clamp(threshold)}%` }}
            title={`及格門檻 ${threshold}`}
          />
        ) : null}
      </div>
      {confidence !== undefined ? (
        <p className="mt-1 text-tiny text-text-tertiary">
          模型信心 {Math.round(confidence * 100)}%
        </p>
      ) : null}
    </div>
  );
}
