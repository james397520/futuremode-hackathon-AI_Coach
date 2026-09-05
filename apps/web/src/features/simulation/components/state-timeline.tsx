'use client';

/**
 * Emotion / persona-state timeline — spec §31 (Part I) and §40 (Part II).
 *
 *   Neutral → Skeptical → Frustrated → Interested → Ready
 *   markers: key response · missed signal · compliance warning · state transition
 *
 * **Labelling is a requirement, not decoration.** §31 is explicit: this strip
 * only ever shows the *simulated* state produced by the persona state machine and
 * the language context. It must not claim to infer a real person's personality or
 * emotions from their face or voice, and the card says so on screen.
 */
import { useMemo } from 'react';
import type { PersonaEmotion, PersonaSimulationState } from '@ai-coach/shared';

import { formatClock } from '../lib/format';
import { EMOTION_LABEL, EMOTION_TONE } from '../lib/labels';
import { insetSurface, tint, toneText, type ToneKey } from '../lib/tone';
import type { PersonaStateSnapshot, TimelineMarker, TimelineMarkerKind } from '../lib/types';
import { CardTitle, TonePill } from './atoms';
import { SparkleIcon } from './icons';
import { cn, GlassCard, Tooltip } from './kit';

/** The five states §31 names explicitly, in order. */
const LADDER: readonly PersonaEmotion[] = ['neutral', 'skeptical', 'frustrated', 'interested', 'ready'];

const MARKER_TONE: Record<TimelineMarkerKind, ToneKey> = {
  key_response: 'mint',
  missed_signal: 'warning',
  compliance_warning: 'danger',
  state_transition: 'violet',
  phase_change: 'indigo',
  score_event: 'blue',
};

const MARKER_LABEL: Record<TimelineMarkerKind, string> = {
  key_response: 'Key response',
  missed_signal: 'Missed signal',
  compliance_warning: 'Compliance warning',
  state_transition: 'State transition',
  phase_change: 'Phase change',
  score_event: 'Score event',
};

const LEGEND: readonly TimelineMarkerKind[] = [
  'key_response',
  'missed_signal',
  'compliance_warning',
  'state_transition',
];

export interface StateTimelineProps {
  markers: TimelineMarker[];
  history: PersonaStateSnapshot[];
  current: PersonaSimulationState | null;
  startedAtMs: number | null;
  elapsedMs: number;
  className?: string;
}

export function StateTimeline({
  markers,
  history,
  current,
  startedAtMs,
  elapsedMs,
  className,
}: StateTimelineProps) {
  const visited = useMemo(() => {
    const set = new Set<PersonaEmotion>();
    for (const snapshot of history) set.add(snapshot.state.emotion);
    if (current) set.add(current.emotion);
    return set;
  }, [current, history]);

  const span = Math.max(1, elapsedMs);
  const positioned = useMemo(
    () =>
      markers.map((marker) => {
        const offset = startedAtMs === null ? 0 : Math.max(0, marker.atMs - startedAtMs);
        return { marker, pct: Math.min(98, Math.max(2, (offset / span) * 100)), offset };
      }),
    [markers, span, startedAtMs],
  );

  return (
    <GlassCard className={cn('sim-float-in p-5', className)}>
      <CardTitle
        eyebrow="Session timeline"
        action={
          <Tooltip content="A simulated state produced by the scenario engine from the conversation. Not an inference about a real person's emotions or personality.">
            <span>
              <TonePill tone="neutral" fill={10} icon={<SparkleIcon size={11} />}>
                Simulated
              </TonePill>
            </span>
          </Tooltip>
        }
      >
        Persona state
      </CardTitle>

      {/* Emotion ladder ---------------------------------------------------- */}
      <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1 sim-scroll">
        {LADDER.map((emotion, index) => {
          const isCurrent = current?.emotion === emotion;
          const wasVisited = visited.has(emotion);
          const tone = EMOTION_TONE[emotion] ?? 'neutral';
          return (
            <div key={emotion} className="flex shrink-0 items-center gap-1.5">
              <span
                className={cn(
                  'rounded-pill px-2.5 py-1 text-tiny transition-all duration-300',
                  isCurrent && 'font-semibold',
                )}
                style={
                  isCurrent
                    ? { ...insetSurface(tone, 22), color: toneText(tone) }
                    : wasVisited
                      ? { ...insetSurface(tone, 10), color: toneText(tone) }
                      : {
                          backgroundColor: 'transparent',
                          borderColor: tint('neutral', 16),
                          color: 'var(--text-tertiary)',
                        }
                }
                aria-current={isCurrent ? 'step' : undefined}
              >
                {EMOTION_LABEL[emotion]}
              </span>
              {index < LADDER.length - 1 ? (
                <span aria-hidden="true" className="text-text-tertiary">
                  →
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Marker track ------------------------------------------------------ */}
      <div className="mt-5">
        <div
          className="relative h-8 rounded-pill"
          style={insetSurface('neutral', 7)}
          role="group"
          aria-label="Session markers"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-1/2 h-[2px] -translate-y-1/2 rounded-pill"
            style={{ backgroundColor: tint('neutral', 18) }}
          />
          {positioned.map(({ marker, pct, offset }) => {
            const tone = MARKER_TONE[marker.kind] ?? 'neutral';
            return (
              <Tooltip
                key={marker.id}
                content={`${MARKER_LABEL[marker.kind]} · ${formatClock(offset)} — ${marker.label}${
                  marker.detail ? ` (${marker.detail})` : ''
                }`}
              >
                <span
                  className="sim-marker-pop absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill"
                  style={{
                    left: `${pct}%`,
                    backgroundColor: toneText(tone),
                    borderColor: 'var(--glass-card-strong)',
                  }}
                  aria-label={`${MARKER_LABEL[marker.kind]} at ${formatClock(offset)}: ${marker.label}`}
                />
              </Tooltip>
            );
          })}
        </div>

        <div className="mt-1.5 flex justify-between text-tiny tabular-nums text-text-tertiary">
          <span>0:00</span>
          <span>{formatClock(elapsedMs)}</span>
        </div>
      </div>

      {/* Legend ------------------------------------------------------------ */}
      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5">
        {LEGEND.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-tiny text-text-tertiary">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-pill"
              style={{ backgroundColor: toneText(MARKER_TONE[kind]) }}
            />
            {MARKER_LABEL[kind]}
          </span>
        ))}
      </div>

      {markers.length === 0 ? (
        <p className="mt-3 text-tiny text-text-tertiary">
          Markers appear as the persona state changes and as the coach and compliance agents report.
        </p>
      ) : null}
    </GlassCard>
  );
}
