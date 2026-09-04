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
import type { CoachInsight, ComplianceFinding, TranscriptTurn } from '@ai-coach/shared-types';

import { formatClock, humaniseSlug } from '../lib/format';
import {
  COACH_KIND_LABEL,
  EMOTION_LABEL,
  PHASE_LABEL,
  SKILL_LABEL,
  SPEAKER_LABEL,
  SPEAKER_ROLE_TAG,
  SPEAKER_TONE,
} from '../lib/labels';
import { insetSurface, tint, toneText, type ToneKey } from '../lib/tone';
import { TonePill } from './atoms';
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
      aria-label={playing ? `Pause ${label}` : `Replay ${label}`}
      className="sim-focusable inline-flex h-6 items-center gap-1 rounded-pill border px-2 text-tiny text-text-tertiary transition-colors hover:text-text-secondary"
      style={insetSurface('neutral', 8)}
    >
      {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      <span>Audio</span>
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

function StateChangeMarker({ turn }: { turn: TranscriptTurn }) {
  const delta = turn.state_delta;
  if (!delta) return null;
  const bits: string[] = [];
  if (delta.emotion) bits.push(EMOTION_LABEL[delta.emotion] ?? delta.emotion);
  if (delta.scenario_phase) bits.push(PHASE_LABEL[delta.scenario_phase] ?? delta.scenario_phase);
  if (delta.hidden_need_revealed) bits.push('Hidden need revealed');
  if (bits.length === 0) return null;
  return (
    <TonePill tone="violet" fill={13} title="Simulated persona state change">
      {bits.join(' · ')}
    </TonePill>
  );
}

function ScoreEventPill({ turn }: { turn: TranscriptTurn }) {
  const event = turn.score_event;
  if (!event) return null;
  const positive = event.delta >= 0;
  return (
    <TonePill tone={positive ? 'mint' : 'warning'} fill={14}>
      {SKILL_LABEL[event.skill] ?? event.skill} {positive ? '+' : ''}
      {Math.round(event.delta)}
    </TonePill>
  );
}

// ---------------------------------------------------------------------------

export function TranscriptTurnRow({
  item,
  startedAtMs,
  personaName,
  personaAvatarUrl,
  traineeName = 'You',
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
  const body = streaming ? (streamingText ?? '') : turn.text;
  const citations = turn.citations ?? [];

  // §17: Coach rows are a light violet glass inset; persona rows get the
  // faintest wash so the eye can group them; trainee rows stay on the surface.
  const rowStyle =
    turn.speaker === 'coach'
      ? insetSurface('violet', 10)
      : turn.speaker === 'persona'
        ? insetSurface('indigo', 5)
        : turn.speaker === 'system'
          ? insetSurface('neutral', 6)
          : undefined;

  return (
    <li
      className={cn(
        'sim-card-enter list-none rounded-card px-3.5 py-3',
        rowStyle ? 'border' : 'border border-transparent',
        className,
      )}
      style={rowStyle}
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

            <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
              {turn.intent ? (
                <TonePill tone="blue" fill={12} title="Detected intent">
                  {humaniseSlug(turn.intent)}
                </TonePill>
              ) : null}
              <StateChangeMarker turn={turn} />
              <ScoreEventPill turn={turn} />
              {turn.audio_url && !streaming ? (
                <AudioReplay url={turn.audio_url} label={`${displayName} at ${timecode}`} />
              ) : null}
            </span>
          </div>

          {insight ? (
            <p className="mt-1.5 text-body font-medium" style={{ color: toneText('violet') }}>
              {insight.title}
            </p>
          ) : null}

          <p className="sim-transcript-body mt-1.5 text-body">
            {body}
            {streaming ? (
              <span
                aria-hidden="true"
                className="sim-caret ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] rounded-pill"
                style={{ backgroundColor: toneText(tone) }}
              />
            ) : null}
          </p>

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
