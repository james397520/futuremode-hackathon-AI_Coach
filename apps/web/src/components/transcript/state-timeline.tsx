'use client';

import type { StateTimelinePoint } from '@/lib/fixtures/sessions';
import { AlertTriangle, CircleDot, Star, TriangleAlert } from 'lucide-react';
import { Pill } from '@/components/ui';
import { cn, formatClock, titleize } from '@/lib/utils';

const MARKER_META = {
  key_response: { label: 'Key response', Icon: Star, tone: 'success' as const },
  missed_signal: { label: 'Missed signal', Icon: TriangleAlert, tone: 'warning' as const },
  compliance_warning: { label: 'Compliance warning', Icon: AlertTriangle, tone: 'danger' as const },
  state_change: { label: 'State change', Icon: CircleDot, tone: 'neutral' as const },
};

/**
 * §40 Emotion / State Timeline.
 *
 * Driven entirely by the persona simulation state machine and language context —
 * never by facial-expression inference (§40 is explicit about this). Each point
 * is labelled in text so the markers are not colour-only (§47).
 */
export function StateTimeline({
  points,
  onJumpToTurn,
  className,
}: {
  points: StateTimelinePoint[];
  onJumpToTurn?: (turnId: string) => void;
  className?: string;
}) {
  if (points.length === 0) return null;

  const emotions = points.map((point) => titleize(point.emotion));
  const unique = emotions.filter((emotion, index) => emotions[index - 1] !== emotion);

  return (
    <section className={cn('space-y-4', className)} aria-label="Persona state timeline">
      <div className="flex flex-wrap items-center gap-1.5 text-body-sm text-text-secondary">
        {unique.map((emotion, index) => (
          <span key={`${emotion}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden className="text-text-tertiary">→</span> : null}
            <span className="rounded-pill bg-glass-strong px-2.5 py-1 text-body-sm">{emotion}</span>
          </span>
        ))}
      </div>

      <ol className="relative space-y-3 border-l border-border-soft pl-5">
        {points.map((point) => {
          const meta = point.marker ? MARKER_META[point.marker] : undefined;
          const Icon = meta?.Icon ?? CircleDot;
          return (
            <li key={`${point.turn_id}-${point.at_ms}`} className="relative">
              <span
                aria-hidden
                className="absolute -left-[27px] top-1.5 flex h-4 w-4 items-center justify-center rounded-pill bg-glass-strong ring-1 ring-border-soft"
              >
                <Icon size={10} strokeWidth={2} />
              </span>

              <div className="glass-strong rounded-card-sm px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-meta tabular-nums text-text-tertiary">{formatClock(point.at_ms)}</span>
                  {meta ? (
                    <Pill tone={meta.tone} size="sm">
                      {meta.label}
                    </Pill>
                  ) : null}
                  <span className="text-body-sm font-medium">{titleize(point.emotion)}</span>
                  <span className="text-tiny text-text-tertiary">{titleize(point.phase)}</span>
                </div>

                {point.note ? <p className="mt-1 text-body-sm text-text-secondary">{point.note}</p> : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-tiny text-text-tertiary">
                  <span className="tabular-nums">Trust {point.trust}</span>
                  <span className="tabular-nums">Resistance {point.resistance}</span>
                  {onJumpToTurn ? (
                    <button
                      type="button"
                      onClick={() => onJumpToTurn(point.turn_id)}
                      className="rounded-button text-accent-indigo hover:underline"
                    >
                      Jump to turn
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
