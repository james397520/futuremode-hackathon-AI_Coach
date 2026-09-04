'use client';

import { useState } from 'react';
import type { SkillScore } from '@ai-coach/shared';
import { ChevronDown, Quote } from 'lucide-react';
import { ScoreBar } from '@/components/data-viz';
import { cn, formatClock, titleize } from '@/lib/utils';

/**
 * §27 Evidence-based scoring + §39 Explainable Evidence.
 *
 * A score is never rendered as a bare number: the row is a disclosure that
 * expands to the quote, the issue and the better approach, with a link back to
 * the transcript turn. This component is the only sanctioned way to show a skill
 * score in a report surface.
 */
export function EvidenceDisclosure({
  skill,
  threshold,
  defaultOpen = false,
  onJumpToTurn,
  className,
}: {
  skill: SkillScore;
  threshold?: number;
  defaultOpen?: boolean;
  onJumpToTurn?: (turnId: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const label = titleize(String(skill.skill));
  const panelId = `evidence-${String(skill.skill)}`;

  return (
    <div className={cn('glass-strong rounded-card-sm', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-4 rounded-card-sm px-4 py-3 text-left transition-colors duration-150 ease-out-soft hover:bg-glass-card"
      >
        <div className="min-w-0 flex-1">
          <ScoreBar label={label} score={skill.score} threshold={threshold} confidence={skill.confidence} />
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-tiny text-text-tertiary">
          {skill.evidence.length} {skill.evidence.length === 1 ? 'excerpt' : 'excerpts'}
          <ChevronDown
            size={15}
            strokeWidth={1.8}
            aria-hidden
            className={cn('transition-transform duration-200 ease-out-soft', open && 'rotate-180')}
          />
        </span>
      </button>

      {open ? (
        <div id={panelId} className="space-y-3 border-t border-border-soft px-4 py-3.5">
          {skill.rubric_note ? (
            <p className="text-body-sm text-text-secondary">
              <span className="meta-label mr-2">Rubric</span>
              {skill.rubric_note}
            </p>
          ) : null}

          {skill.evidence.length === 0 ? (
            <p className="text-body-sm text-text-tertiary">
              No transcript excerpt was attached to this dimension — the score is provisional and needs
              coach review before it counts.
            </p>
          ) : null}

          <ul className="space-y-3">
            {skill.evidence.map((evidence, index) => (
              <li key={`${panelId}-${index}`} className="rounded-card-sm border border-border-soft px-3.5 py-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-tiny text-text-tertiary">
                  <span className="tabular-nums">Evidence at {formatClock(evidence.timestamp_ms)}</span>
                  {evidence.transcript_turn_ids.map((turnId) => (
                    <button
                      key={turnId}
                      type="button"
                      onClick={() => onJumpToTurn?.(turnId)}
                      className="rounded-button text-accent-indigo hover:underline"
                    >
                      Jump to turn
                    </button>
                  ))}
                </div>

                <blockquote className="flex gap-2 text-body text-text-primary">
                  <Quote size={14} strokeWidth={1.8} aria-hidden className="mt-1 shrink-0 text-text-tertiary" />
                  <span className="whitespace-pre-wrap">{evidence.quote}</span>
                </blockquote>

                {evidence.issue ? (
                  <p className="mt-2 text-body-sm">
                    <span className="meta-label mr-2 text-state-warning">Issue</span>
                    <span className="text-text-secondary">{evidence.issue}</span>
                  </p>
                ) : null}

                {evidence.better_approach ? (
                  <p className="mt-1.5 text-body-sm">
                    <span className="meta-label mr-2 text-state-success">Better approach</span>
                    <span className="text-text-secondary">{evidence.better_approach}</span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {skill.improvement_suggestion ? (
            <p className="rounded-card-sm bg-glass-card px-3.5 py-2.5 text-body-sm text-text-secondary">
              <span className="meta-label mr-2">Next time</span>
              {skill.improvement_suggestion}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
