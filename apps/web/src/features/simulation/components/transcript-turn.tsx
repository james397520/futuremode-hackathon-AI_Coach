'use client';

/**
 * One transcript row — spec §16 / §17 / §25.
 *
 * **Meeting-transcript / document style.** Speaker label, timecode, paragraph.
 * There are no left/right messenger bubbles anywhere in this file: §99 forbids
 * "ChatGPT 左右 bubble", and §16 fixes the decision as "Transcript document
 * style". Speakers are told apart by avatar, name, role tag, timestamp and a
 * *subtle* background — never by which side of the panel they sit on.
 *
 * Six message kinds (the `SpeakerKind` contract): Persona, Trainee, Coach,
 * System, Compliance warning, Knowledge citation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CoachInsight, ComplianceFinding, TranscriptTurn } from '@ai-coach/shared';

import { formatClock } from '../lib/format';
import {
  COACH_KIND_LABEL,
  SPEAKER_LABEL,
  SPEAKER_ROLE_TAG,
  SPEAKER_TONE,
} from '../lib/labels';
import { insetSurface, tint, toneText, type ToneKey } from '../lib/tone';
import { CitationList } from './citation-chip';
import { ComplianceAlert } from './compliance-alert';
import { AlertIcon, BookIcon, LightbulbIcon, PauseIcon, PlayIcon, SparkleIcon } from './icons';
import { Avatar, cn, PersonaAvatar } from './kit';

export interface TranscriptItem {
  id: string;
  atMs: number;
  turn: TranscriptTurn;
  /** Present for `speaker: 'coach'` rows. */
  insight?: CoachInsight;
  /** Present for `speaker: 'compliance'` rows. */
  finding?: ComplianceFinding;
  /** Streaming text that has not been finalised yet. */
  streamingText?: string;
  streaming?: boolean;
}

export interface TranscriptTurnRowProps {
  item: TranscriptItem;
  startedAtMs: number | null;
  personaName: string;
  personaAvatarUrl?: string;
  traineeName?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Audio replay affordance (§25 `audio playback`)
// ---------------------------------------------------------------------------

function AudioReplay({ url, label }: { url: string; label: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      const el = ref.current;
      if (!el) return;
      el.pause();
      ref.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    let el = ref.current;
    if (!el) {
      el = new Audio(url);
      el.onended = () => setPlaying(false);
      el.onerror = () => setPlaying(false);
      el.onpause = () => setPlaying(false);
      ref.current = el;
    }
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    void el
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [playing, url]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={playing ? `暫停播放 ${label}` : `重新播放 ${label}`}
      className="sim-focusable inline-flex h-6 items-center gap-1 rounded-pill px-2 text-tiny text-text-tertiary transition-colors hover:text-text-secondary"
      style={insetSurface('neutral', 8)}
    >
      {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      <span>語音</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Speaker gutter
// ---------------------------------------------------------------------------

function SpeakerGlyph({ tone, children }: { tone: ToneKey; children: ReactNode }) {
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-avatar border"
      style={{ ...insetSurface(tone, 16), color: toneText(tone) }}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function Gutter({
  turn,
  personaName,
  personaAvatarUrl,
  traineeName,
  speaking,
}: {
  turn: TranscriptTurn;
  personaName: string;
  personaAvatarUrl?: string;
  traineeName: string;
  speaking: boolean;
}) {
  switch (turn.speaker) {
    case 'persona':
      return (
        <PersonaAvatar name={personaName} src={personaAvatarUrl} size="sm" speaking={speaking} />
      );
    case 'trainee':
      return <Avatar name={traineeName} size="sm" />;
    case 'coach':
      return (
        <SpeakerGlyph tone="violet">
          <LightbulbIcon size={14} />
        </SpeakerGlyph>
      );
    case 'compliance':
      return (
        <SpeakerGlyph tone="warning">
          <AlertIcon size={14} />
        </SpeakerGlyph>
      );
    case 'knowledge':
      return (
        <SpeakerGlyph tone="cyan">
          <BookIcon size={14} />
        </SpeakerGlyph>
      );
    case 'system':
    default:
      return (
        <SpeakerGlyph tone="neutral">
          <SparkleIcon size={13} />
        </SpeakerGlyph>
      );
  }
}

// ---------------------------------------------------------------------------

export function TranscriptTurnRow({
  item,
  startedAtMs,
  personaName,
  personaAvatarUrl,
  traineeName = '你',
  className,
}: TranscriptTurnRowProps) {
  const { turn, insight, finding, streamingText, streaming } = item;

  // A compliance row renders the full §32 card — it is not a paragraph.
  if (turn.speaker === 'compliance' && finding) {
    return (
      <li className={cn('sim-card-enter list-none', className)}>
        <ComplianceAlert finding={finding} startedAtMs={startedAtMs} compact />
      </li>
    );
  }

  const tone = SPEAKER_TONE[turn.speaker] ?? 'neutral';
  const displayName =
    turn.speaker === 'persona'
      ? personaName
      : turn.speaker === 'trainee'
        ? traineeName
        : (SPEAKER_LABEL[turn.speaker] ?? turn.speaker);
  const roleTag = SPEAKER_ROLE_TAG[turn.speaker] ?? turn.speaker;
  const timecode = formatClock(startedAtMs === null ? item.atMs : Math.max(0, item.atMs - startedAtMs));
  /*
   * Trailing whitespace is trimmed while streaming: `.sim-transcript-body` is
   * `white-space: pre-wrap`, so a partial ending in "\n" rendered an empty last
   * line — which read as a stray blinking text cursor sitting under the
   * customer's message.
   */
  const body = streaming ? (streamingText ?? '').replace(/\s+$/, '') : turn.text;
  const citations = turn.citations ?? [];

  if (turn.speaker === 'trainee') {
    return (
      <li className={cn('sim-card-enter flex list-none justify-end py-2 pl-12', className)}>
        <div className="flex max-w-[72%] items-start gap-2.5 max-sm:max-w-[88%]">
          <div className="rounded-card border border-border-soft bg-[color:color-mix(in_srgb,var(--text-tertiary)_7%,var(--glass-card-strong))] px-3.5 py-3">
            <div className="flex items-center justify-end gap-2 text-tiny text-text-tertiary">
              <span>{traineeName}</span>
              <span className="tabular-nums">{timecode}</span>
              {turn.audio_url && !streaming ? (
                <AudioReplay url={turn.audio_url} label={`${traineeName} 於 ${timecode}`} />
              ) : null}
            </div>
            <p className="mt-1 text-body text-text-primary">
              {body}
              {streaming ? (
                <span aria-hidden className="sim-caret ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-pill bg-text-tertiary" />
              ) : null}
            </p>
          </div>
          <Avatar name={traineeName} size="sm" />
        </div>
      </li>
    );
  }

  // Speech is a conversation: the trainee's turn is a bubble constrained to 72%
  // and pushed right, so the persona's must mirror it — constrained and pushed
  // left. It used to span the whole column as a full-bleed card, which made a
  // two-word reply sit beside a full-width slab and read as broken layout.
  // Coach and system rows are annotations, not speech, so they stay full-width
  // document rows with only a subtle tint.
  const rowStyle =
    turn.speaker === 'coach'
      ? insetSurface('violet', 5)
      : turn.speaker === 'system'
        ? insetSurface('neutral', 4)
        : undefined;

  return (
    <li
      className={cn(
        'sim-card-enter list-none px-1 py-2',
        turn.speaker === 'persona'
          ? 'my-1 mr-auto max-w-[72%] rounded-card border border-border-glass bg-glass-card px-3.5 py-3 shadow-soft max-sm:max-w-[88%]'
          : rowStyle
            ? 'rounded-input border'
            : 'border-b last:border-b-0',
        className,
      )}
      style={{ ...rowStyle, borderColor: tint('neutral', 12) }}
    >
      <div className="flex gap-3">
        <div className="shrink-0 pt-0.5">
          <Gutter
            turn={turn}
            personaName={personaName}
            personaAvatarUrl={personaAvatarUrl}
            traineeName={traineeName}
            speaking={Boolean(streaming) && turn.speaker === 'persona'}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-body font-semibold text-text-primary">{displayName}</span>
            <span className="text-tiny" style={{ color: toneText(tone) }}>
              {insight ? (COACH_KIND_LABEL[insight.kind] ?? roleTag) : roleTag}
            </span>
            <span className="text-tiny tabular-nums text-text-tertiary">· {timecode}</span>

            <span className="ml-auto flex items-center justify-end gap-1.5">
              {turn.audio_url && !streaming ? (
                <AudioReplay url={turn.audio_url} label={`${displayName} 於 ${timecode}`} />
              ) : null}
            </span>
          </div>

          {insight ? (
            <p className="mt-1.5 text-body font-medium" style={{ color: toneText('violet') }}>
              {insight.title}
            </p>
          ) : null}

          {/* No caret here: the conversation header already shows "客戶正在思考…"
              while a reply is in flight, and a second blinking cursor inside the
              customer's bubble reads as a stray text input. */}
          <p className="sim-transcript-body mt-1.5 text-body">{body}</p>

          {citations.length > 0 ? (
            <div
              className="mt-2.5 border-t pt-2.5"
              style={{ borderColor: tint('neutral', 14) }}
            >
              <CitationList citations={citations} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
