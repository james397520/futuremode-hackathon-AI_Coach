'use client';

/**
 * Live captions — spec §22.2 / §22.4 (caption language), §24, §50 (captions are
 * a required accessibility capability of the audio stack).
 *
 * Renders the in-flight line first: partial ASR while the trainee talks, partial
 * TTS text while the persona talks. Nothing waits for a full sentence (§49.2).
 * A single `aria-live="polite"` region keeps screen readers coherent.
 */
import type { SpeakerKind } from '@ai-coach/shared';

import { insetSurface, toneText } from '../lib/tone';
import { LiveDot } from './atoms';
import { CaptionsIcon } from './icons';
import { cn } from './kit';

export interface CaptionLine {
  speaker: Extract<SpeakerKind, 'trainee' | 'persona'>;
  text: string;
  final: boolean;
}

export interface CaptionsProps {
  enabled: boolean;
  personaName: string;
  traineeName?: string;
  /** The line currently being produced, if any. */
  live: CaptionLine | null;
  /** The previous finalised line, kept for context. */
  previous: CaptionLine | null;
  captionLanguage?: string;
  className?: string;
}

export function Captions({
  enabled,
  personaName,
  traineeName = '你',
  live,
  previous,
  captionLanguage,
  className,
}: CaptionsProps) {
  if (!enabled) return null;

  const nameFor = (speaker: CaptionLine['speaker']): string =>
    speaker === 'persona' ? personaName : traineeName;
  const toneFor = (speaker: CaptionLine['speaker']) => (speaker === 'persona' ? 'indigo' : 'blue');

  const hasContent = Boolean(live?.text || previous?.text);

  return (
    <div
      className={cn('rounded-card border p-4', className)}
      style={insetSurface('neutral', 8)}
      aria-label="即時字幕"
    >
      <div className="flex items-center gap-2">
        <CaptionsIcon size={13} className="text-text-tertiary" />
        <span className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">字幕</span>
        {captionLanguage ? (
          <span className="text-tiny text-text-tertiary">· {captionLanguage}</span>
        ) : null}
        {live ? <LiveDot tone={toneFor(live.speaker)} pulsing className="ml-auto" /> : null}
      </div>

      <div aria-live="polite" aria-atomic="false" className="mt-2.5 min-h-[3.5rem]">
        {previous?.text && previous.text !== live?.text ? (
          <p className="text-body-sm text-text-tertiary">
            <span className="font-medium">{nameFor(previous.speaker)}:</span> {previous.text}
          </p>
        ) : null}

        {live?.text ? (
          <p className="mt-1 text-section leading-snug text-text-primary">
            <span className="text-body font-medium" style={{ color: toneText(toneFor(live.speaker)) }}>
              {nameFor(live.speaker)}:{' '}
            </span>
            {live.text}
            {!live.final ? (
              <span
                aria-hidden="true"
                className="sim-caret ml-1 inline-block h-[1em] w-[3px] translate-y-[2px] rounded-pill"
                style={{ backgroundColor: toneText(toneFor(live.speaker)) }}
              />
            ) : null}
          </p>
        ) : null}

        {!hasContent ? (
          <p className="text-body text-text-tertiary">
            Captions appear here as soon as either side starts talking.
          </p>
        ) : null}
      </div>
    </div>
  );
}
