'use client';

/**
 * The transcript itself — spec §16 / §25.
 *
 * Merges every conversation-shaped signal into one chronological document:
 * real turns, coach insights, compliance warnings, system notices, plus the
 * in-flight partials (ASR and LLM) which render *immediately* rather than
 * waiting for a finished sentence (§49.2).
 *
 * Accessibility: the streaming region is a single `aria-live="polite"` node so a
 * screen reader hears the persona's answer settle once, not per delta.
 */
import { useMemo } from 'react';
import type {
  CoachInsight,
  ComplianceFinding,
  ID,
  SessionState,
  TranscriptTurn,
} from '@ai-coach/shared';

import { useAutoScroll } from '../hooks/use-auto-scroll';
import { tint, toneText } from '../lib/tone';
import { LiveDot } from './atoms';
import { ArrowDownIcon } from './icons';
import { cn } from './kit';
import { TranscriptTurnRow, type TranscriptItem } from './transcript-turn';

export interface TranscriptFeedProps {
  turns: TranscriptTurn[];
  partials: Record<ID, string>;
  speechPartial: { speaker: 'trainee' | 'persona'; text: string } | null;
  coachInsights: CoachInsight[];
  complianceFindings: ComplianceFinding[];
  systemNotices: SystemNotice[];
  sessionId: ID;
  startedAtMs: number | null;
  personaName: string;
  personaAvatarUrl?: string;
  traineeName?: string;
  status: SessionState;
  openingContext?: string;
  className?: string;
}

export interface SystemNotice {
  id: string;
  atMs: number;
  text: string;
}

function syntheticTurn(
  sessionId: ID,
  id: ID,
  speaker: TranscriptTurn['speaker'],
  text: string,
  atMs: number,
): TranscriptTurn {
  return { id, session_id: sessionId, speaker, text, timestamp_ms: atMs };
}

/**
 * Pure merge — exported so it can be unit-tested without a DOM.
 * Ordering rule: by timestamp, and for equal timestamps the real turn wins so a
 * coach note never appears above the line it is about.
 */
export function buildTranscriptItems(input: {
  sessionId: ID;
  turns: TranscriptTurn[];
  partials: Record<ID, string>;
  speechPartial: { speaker: 'trainee' | 'persona'; text: string } | null;
  coachInsights: CoachInsight[];
  complianceFindings: ComplianceFinding[];
  systemNotices: SystemNotice[];
}): TranscriptItem[] {
  const { sessionId, turns, partials, speechPartial, coachInsights, complianceFindings, systemNotices } =
    input;

  const items: TranscriptItem[] = turns.map((turn) => ({
    id: turn.id,
    atMs: turn.timestamp_ms,
    turn,
  }));

  const finalisedIds = new Set(turns.map((t) => t.id));
  const lastAt = turns.length > 0 ? (turns[turns.length - 1]?.timestamp_ms ?? 0) : 0;

  for (const insight of coachInsights) {
    items.push({
      id: `insight-${insight.id}`,
      atMs: insight.timestamp_ms,
      turn: syntheticTurn(sessionId, `insight-${insight.id}`, 'coach', insight.body, insight.timestamp_ms),
      insight,
    });
  }

  for (const finding of complianceFindings) {
    items.push({
      id: `finding-${finding.id}`,
      atMs: finding.timestamp_ms,
      turn: syntheticTurn(
        sessionId,
        `finding-${finding.id}`,
        'compliance',
        finding.explanation,
        finding.timestamp_ms,
      ),
      finding,
    });
  }

  for (const notice of systemNotices) {
    items.push({
      id: notice.id,
      atMs: notice.atMs,
      turn: syntheticTurn(sessionId, notice.id, 'system', notice.text, notice.atMs),
    });
  }

  items.sort((a, b) => {
    if (a.atMs !== b.atMs) return a.atMs - b.atMs;
    const rank = (item: TranscriptItem): number =>
      item.turn.speaker === 'persona' || item.turn.speaker === 'trainee' ? 0 : 1;
    return rank(a) - rank(b);
  });

  // In-flight persona output goes last: it is, by definition, the newest thing.
  for (const [turnId, text] of Object.entries(partials)) {
    if (finalisedIds.has(turnId) || !text) continue;
    items.push({
      id: `partial-${turnId}`,
      atMs: lastAt + 1,
      turn: syntheticTurn(sessionId, turnId, 'persona', text, lastAt + 1),
      streamingText: text,
      streaming: true,
    });
  }

  if (speechPartial && speechPartial.text) {
    items.push({
      id: `asr-${speechPartial.speaker}`,
      atMs: lastAt + 2,
      turn: syntheticTurn(
        sessionId,
        `asr-${speechPartial.speaker}`,
        speechPartial.speaker,
        speechPartial.text,
        lastAt + 2,
      ),
      streamingText: speechPartial.text,
      streaming: true,
    });
  }

  return items;
}

export function TranscriptFeed({
  turns,
  partials,
  speechPartial,
  coachInsights,
  complianceFindings,
  systemNotices,
  sessionId,
  startedAtMs,
  personaName,
  personaAvatarUrl,
  traineeName,
  status,
  openingContext,
  className,
}: TranscriptFeedProps) {
  const items = useMemo(
    () =>
      buildTranscriptItems({
        sessionId,
        turns,
        partials,
        speechPartial,
        coachInsights,
        complianceFindings,
        systemNotices,
      }),
    [coachInsights, complianceFindings, partials, sessionId, speechPartial, systemNotices, turns],
  );

  const streamingLength =
    (speechPartial?.text.length ?? 0) +
    Object.values(partials).reduce((total, text) => total + text.length, 0);

  const { containerRef, pinned, hasUnseen, scrollToBottom } = useAutoScroll<HTMLDivElement>(
    `${items.length}:${streamingLength}`,
  );

  const settled = items.filter((item) => !item.streaming);
  const streamingItems = items.filter((item) => item.streaming);

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div
        ref={containerRef}
        className="sim-scroll h-full overflow-y-auto px-1.5 pb-2"
        role="log"
        aria-label="Session transcript"
      >
        {items.length === 0 ? (
          <div className="dot-matrix mx-1.5 mt-2 rounded-card border border-border-soft p-6">
            <p className="text-card-title text-text-primary">The session is about to begin</p>
            <p className="mt-2 max-w-prose text-body text-text-secondary">
              {openingContext ??
                'The AI persona will open the conversation. Respond naturally — you can type or use the microphone.'}
            </p>
          </div>
        ) : null}

        <ol className="grid gap-1.5">
          {settled.map((item) => (
            <TranscriptTurnRow
              key={item.id}
              item={item}
              startedAtMs={startedAtMs}
              personaName={personaName}
              personaAvatarUrl={personaAvatarUrl}
              traineeName={traineeName}
            />
          ))}
        </ol>

        {/* One live region for everything still in flight (§49.2 + a11y). */}
        <div aria-live="polite" aria-atomic="false" className="mt-1.5">
          <ol className="grid gap-1.5">
            {streamingItems.map((item) => (
              <TranscriptTurnRow
                key={item.id}
                item={item}
                startedAtMs={startedAtMs}
                personaName={personaName}
                personaAvatarUrl={personaAvatarUrl}
                traineeName={traineeName}
              />
            ))}
          </ol>
        </div>

        {status === 'processing' && streamingItems.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 px-3.5 text-meta text-text-tertiary">
            <LiveDot tone="indigo" pulsing />
            {personaName} is thinking…
          </p>
        ) : null}
      </div>

      {!pinned ? (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="sim-focusable absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-tiny shadow-soft backdrop-blur"
          style={{
            backgroundColor: 'var(--glass-card-strong)',
            borderColor: tint('neutral', 24),
            color: toneText('blue'),
          }}
        >
          <ArrowDownIcon size={13} />
          {hasUnseen ? 'New messages' : 'Jump to latest'}
        </button>
      ) : null}
    </div>
  );
}
