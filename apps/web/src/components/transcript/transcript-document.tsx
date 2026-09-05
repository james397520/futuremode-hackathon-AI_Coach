'use client';

import { useMemo, useState } from 'react';
import type { SpeakerKind, TranscriptTurn } from '@ai-coach/shared';
import { AlertTriangle, BookOpen, Play, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Pill } from '@/components/ui';
import { cn, formatClock, titleize } from '@/lib/utils';
import { CitationList } from './citation-list';

const SPEAKER_LABEL: Record<SpeakerKind, string> = {
  trainee: 'You',
  persona: 'Customer',
  coach: 'AI Coach',
  system: 'System',
  compliance: 'Compliance',
  knowledge: 'Knowledge',
};

const ANNOTATION_SPEAKERS: SpeakerKind[] = ['coach', 'compliance', 'knowledge', 'system'];

/**
 * §25 Part I — **meeting transcript / document style**.
 *
 * Explicitly not a messenger view: no left/right alignment, no bubbles, no tails
 * (forbidden by §99). Every turn is a row in a document with a timestamp gutter,
 * a named speaker and inline annotations for coach / compliance / citation events.
 */
export function TranscriptDocument({
  turns,
  personaName = 'Customer',
  traineeName = 'You',
  /** Turn ids to highlight — used when arriving from an evidence link. */
  highlightTurnIds,
  className,
  liveRegion = false,
  emptyMessage = 'The transcript will appear here as the conversation happens.',
}: {
  turns: TranscriptTurn[];
  personaName?: string;
  traineeName?: string;
  highlightTurnIds?: string[];
  className?: string;
  /** §47 — streaming text must be announced. */
  liveRegion?: boolean;
  emptyMessage?: string;
}) {
  const [showAnnotations, setShowAnnotations] = useState(true);
  const highlighted = useMemo(() => new Set(highlightTurnIds ?? []), [highlightTurnIds]);

  const visible = showAnnotations
    ? turns
    : turns.filter((turn) => !ANNOTATION_SPEAKERS.includes(turn.speaker));

  const speakerName = (speaker: SpeakerKind) =>
    speaker === 'persona' ? personaName : speaker === 'trainee' ? traineeName : SPEAKER_LABEL[speaker];

  return (
    <section className={cn('transcript-doc overflow-hidden', className)} aria-label="Session transcript">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-3.5">
        <div>
          <h3 className="text-card-title">Transcript</h3>
          <p className="text-tiny text-text-tertiary">
            {turns.length} turns · document view with inline coach and compliance annotations
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-body-sm text-text-secondary">
          <input
            type="checkbox"
            checked={showAnnotations}
            onChange={(event) => setShowAnnotations(event.target.checked)}
            className="h-4 w-4 rounded accent-accent-indigo"
          />
          Show annotations
        </label>
      </header>

      <div
        className="scroll-area max-h-[560px]"
        {...(liveRegion ? { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text' } : {})}
      >
        {visible.length === 0 ? (
          <p className="px-5 py-10 text-center text-body-sm text-text-tertiary">{emptyMessage}</p>
        ) : null}

        {visible.map((turn) => {
          const isAnnotation = ANNOTATION_SPEAKERS.includes(turn.speaker);
          return (
            <article
              key={turn.id}
              id={`turn-${turn.id}`}
              data-speaker={turn.speaker}
              className={cn(
                'transcript-turn scroll-mt-24',
                highlighted.has(turn.id) && 'ring-1 ring-inset ring-accent-indigo/50',
              )}
            >
              <div className="flex flex-col gap-0.5 sm:text-right">
                <span className="text-meta tabular-nums text-text-tertiary">{formatClock(turn.timestamp_ms)}</span>
                <span
                  className={cn(
                    'text-body-sm font-semibold',
                    isAnnotation ? 'text-text-tertiary' : 'text-text-primary',
                  )}
                >
                  {speakerName(turn.speaker)}
                </span>
                {turn.audio_url ? (
                  <button
                    type="button"
                    className="ink-indigo mt-1 inline-flex items-center gap-1 text-tiny hover:underline sm:justify-end"
                    aria-label={`Play audio for the turn at ${formatClock(turn.timestamp_ms)}`}
                  >
                    <Play size={11} strokeWidth={2} aria-hidden /> Play
                  </button>
                ) : null}
              </div>

              <div className="min-w-0">
                <p
                  className={cn(
                    'whitespace-pre-wrap text-body',
                    isAnnotation ? 'text-text-secondary' : 'text-text-primary',
                  )}
                >
                  {turn.speaker === 'coach' ? (
                    <Sparkles size={13} strokeWidth={1.9} aria-hidden className="mr-1.5 inline align-[-1px] text-accent-indigo" />
                  ) : null}
                  {turn.speaker === 'compliance' ? (
                    <AlertTriangle size={13} strokeWidth={1.9} aria-hidden className="ink-warning mr-1.5 inline align-[-1px]" />
                  ) : null}
                  {turn.speaker === 'knowledge' ? (
                    <BookOpen size={13} strokeWidth={1.9} aria-hidden className="ink-blue mr-1.5 inline align-[-1px]" />
                  ) : null}
                  {turn.text}
                </p>

                {(turn.intent || turn.score_event || turn.state_delta) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {turn.intent ? (
                      <Pill tone="neutral" size="sm">
                        Intent · {titleize(turn.intent)}
                      </Pill>
                    ) : null}

                    {turn.score_event ? (
                      <Pill tone={turn.score_event.delta >= 0 ? 'success' : 'danger'} size="sm">
                        {turn.score_event.delta >= 0 ? (
                          <TrendingUp size={12} strokeWidth={2} aria-hidden />
                        ) : (
                          <TrendingDown size={12} strokeWidth={2} aria-hidden />
                        )}
                        {titleize(turn.score_event.skill)} {turn.score_event.delta >= 0 ? '+' : ''}
                        {turn.score_event.delta}
                      </Pill>
                    ) : null}

                    {turn.state_delta?.emotion ? (
                      <Pill tone="info" size="sm">Emotion → {titleize(turn.state_delta.emotion)}</Pill>
                    ) : null}
                    {turn.state_delta?.scenario_phase ? (
                      <Pill tone="neutral" size="sm">Phase → {titleize(turn.state_delta.scenario_phase)}</Pill>
                    ) : null}
                    {turn.state_delta?.trust !== undefined ? (
                      <Pill tone="neutral" size="sm">Trust {turn.state_delta.trust}</Pill>
                    ) : null}
                    {turn.state_delta?.compliance_risk ? (
                      <Pill
                        tone={
                          turn.state_delta.compliance_risk === 'critical' || turn.state_delta.compliance_risk === 'high'
                            ? 'danger'
                            : turn.state_delta.compliance_risk === 'medium'
                              ? 'warning'
                              : 'neutral'
                        }
                        size="sm"
                      >
                        Risk · {titleize(turn.state_delta.compliance_risk)}
                      </Pill>
                    ) : null}
                  </div>
                )}

                {turn.citations && turn.citations.length > 0 ? (
                  <CitationList citations={turn.citations} className="mt-2.5" />
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
