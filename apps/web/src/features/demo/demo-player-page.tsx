'use client';

/**
 * 展示模式播放頁（螢幕錄影用）。
 *
 * 照 `demo-scripts.ts` 的劇本走：客戶先開場，接著每按一次送出，就顯示一句寫死
 * 的學員台詞、再自動播出後續的客戶回覆／教練提示／合規卡（帶打字延遲）。不呼叫
 * 後端、不呼叫模型，所以錄影時逐字一致、不會中斷。引用晶片與合規卡沿用正式產品
 * 的 `CitationList` / `ComplianceAlert`，外觀與真實對話一致。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RotateCcw, Send, Sparkles } from 'lucide-react';
import { Button, GlassCard, Pill } from '@/components/ui';
import { CitationList } from '@/features/simulation/components/citation-chip';
import { ComplianceAlert } from '@/features/simulation/components/compliance-alert';
import { PersonaStage } from '@/features/simulation/components/persona-stage';
import { endpoints } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { DemoBeat, DemoScript } from './demo-scripts';

type Rendered = { key: string; beat: DemoBeat };

const TYPING_MS = 900;
const BETWEEN_MS = 550;

// The on-device Breeze voice (services/local-tts) is always up in the demo box;
// 'local' skips the cloud attempt so a line never fails to speak on camera.
const TTS_ENGINE = 'local' as const;
const TTS_TUNING = { stability: 0.5, similarity: 0.75, style: 0.3, speed: 1 };
// Fallback mouth-move duration when TTS is unavailable: ~90ms per character.
const speakMsFor = (text: string) => Math.min(6000, Math.max(1200, text.length * 90));

function isTrainee(beat: DemoBeat): boolean {
  return beat.speaker === 'trainee';
}

/** The next trainee line the user is meant to send (teleprompter + placeholder). */
function nextTraineeLine(script: DemoScript, cursor: number): string | null {
  for (let i = cursor; i < script.beats.length; i += 1) {
    const beat = script.beats[i];
    if (beat && isTrainee(beat)) return (beat as { text: string }).text;
  }
  return null;
}

export function DemoPlayerPage({ script }: { script: DemoScript }) {
  const [rendered, setRendered] = useState<Rendered[]>([]);
  const [cursor, setCursor] = useState(0);
  const [typing, setTyping] = useState(false);
  // True for the WHOLE auto-play span (send → last beat), not just the typing
  // dots. `typing` blinks off in the 550ms gap between beats, which would flash
  // the input back on and show the just-sent teleprompter line mid-playback;
  // gating the input, teleprompter and "finished" on `playing` avoids that.
  const [playing, setPlaying] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsSessionRef = useRef<string | null>(null);
  // Synchronous re-entry guard — `playing` state updates a tick late, so a fast
  // double-click would slip through before it flips. This ref flips in the same
  // tick as the click, so only the first click of a burst gets through.
  const busyRef = useRef(false);
  // Bumped on every speakLine + reset; a stale in-flight TTS synthesis compares
  // against it and drops its audio, so replaying mid-synthesis never lets an old
  // line's voice play over the new one.
  const speakTokenRef = useRef(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // A real session, created once, used ONLY to synthesise the persona voice
  // (`POST /sessions/{id}/speak`). The scripted conversation never touches it.
  // If it cannot be created (offline, API down), TTS is skipped and the avatar
  // still lip-flaps on a timer, so a recording never stalls.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const created = await endpoints.createSession({
          scenario_id: script.ttsScenarioId,
          mode: 'training',
          voice_enabled: true,
          score_live_enabled: false,
        });
        if (!cancelled) ttsSessionRef.current = created.session.session_id;
      } catch {
        if (!cancelled) ttsSessionRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [script.ttsScenarioId]);

  /** Speak one persona line and hold `speaking` for the avatar's mouth. */
  const speakLine = useCallback((text: string) => {
    const token = (speakTokenRef.current += 1);
    // Fallback mouth timer, used only when real audio never plays; when audio
    // does start we clear it and let `onended` decide, so a long line's mouth
    // does not stop early.
    const stopTimer = setTimeout(() => {
      if (speakTokenRef.current === token) setSpeaking(false);
    }, speakMsFor(text));
    timers.current.push(stopTimer);
    setSpeaking(true);
    const sid = ttsSessionRef.current;
    if (!sid) return; // avatar still animates via the timer above
    void (async () => {
      try {
        const blob = await endpoints.synthesizeSpeech(sid, text, TTS_TUNING, TTS_ENGINE);
        if (speakTokenRef.current !== token) return; // superseded (replay / next line)
        const url = URL.createObjectURL(blob);
        audioRef.current?.pause();
        const el = new Audio(url);
        audioRef.current = el;
        clearTimeout(stopTimer); // real audio drives the mouth now
        el.onended = () => {
          if (speakTokenRef.current === token) setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        await el.play();
      } catch {
        /* keep the timer-driven mouth movement */
      }
    })();
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    audioRef.current?.pause();
    speakTokenRef.current += 1;
    busyRef.current = false;
    setPlaying(false);
    setTyping(false);
    setSpeaking(false);
    setCursor(0);
    setDraft('');
    setRendered([{ key: 'opening', beat: script.opening }]);
    if (script.opening.speaker === 'persona') speakLine(script.opening.text);
  }, [clearTimers, script, speakLine]);

  // Open the conversation with the persona's fixed line, once per script.
  useEffect(() => {
    reset();
    return () => {
      clearTimers();
      audioRef.current?.pause();
      speakTokenRef.current += 1;
    };
  }, [reset, clearTimers]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [rendered, typing]);

  /** Play every non-trainee beat from `from` until the next trainee beat (or end). */
  const playAgentBeats = useCallback(
    (from: number) => {
      let i = from;
      const step = () => {
        const beat = script.beats[i];
        if (i >= script.beats.length || !beat || isTrainee(beat)) {
          setCursor(i);
          setTyping(false);
          setPlaying(false);
          busyRef.current = false; // ready for the next 送出
          return;
        }
        const at = i;
        setTyping(true);
        timers.current.push(
          setTimeout(() => {
            setRendered((prev) => [...prev, { key: `b${at}`, beat }]);
            setTyping(false);
            if (beat.speaker === 'persona') speakLine(beat.text);
            i += 1;
            timers.current.push(setTimeout(step, BETWEEN_MS));
          }, TYPING_MS),
        );
      };
      step();
    },
    [script, speakLine],
  );

  const send = useCallback(() => {
    if (busyRef.current) return;
    const line = nextTraineeLine(script, cursor);
    if (line == null) return;
    busyRef.current = true;
    setPlaying(true);
    // Find the index of that trainee beat, show the canonical text (not the
    // draft) so a typo on camera never shows, then auto-play the agent beats.
    let i = cursor;
    while (i < script.beats.length) {
      const b = script.beats[i];
      if (b && isTrainee(b)) break;
      i += 1;
    }
    const traineeBeat = script.beats[i];
    if (!traineeBeat) return;
    setRendered((prev) => [...prev, { key: `b${i}`, beat: traineeBeat }]);
    setDraft('');
    playAgentBeats(i + 1);
  }, [cursor, script, playAgentBeats]);

  const upcoming = useMemo(() => nextTraineeLine(script, cursor), [script, cursor]);
  const finished = upcoming == null && !playing;

  return (
    <div className="mx-auto flex h-[calc(100dvh-1px)] max-w-6xl flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-tiny text-text-tertiary">
            <Link href="/demo" className="inline-flex items-center gap-1 hover:text-text-secondary">
              <ArrowLeft size={13} strokeWidth={1.8} aria-hidden />
              展示選單
            </Link>
            <span aria-hidden>·</span>
            <span>展示模式</span>
          </div>
          <h1 className="truncate text-card-title">{script.scenarioTitle}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {script.capabilities.map((cap) => (
            <Pill key={cap} tone="neutral" size="sm">
              {cap}
            </Pill>
          ))}
        </div>
      </header>

      {/*
        The avatar must mount *visible*: a WebGL canvas that first renders inside
        a `display:none` column measures 0×0 and never recovers (the VRM looks
        dead). So it is always shown — stacked above the chat on narrow screens,
        beside it from lg up — never gated behind `hidden`.
      */}
      <div className="grid min-h-0 flex-1 gap-3 max-lg:grid-rows-[14rem_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <PersonaStage
          className="min-h-0"
          personaName={script.personaName}
          personaGender={script.personaGender}
          personaAge={script.personaAge}
          subtitle={`${script.personaName} · 展示模式`}
          eyebrow="虛擬人"
          speaking={speaking}
          listening={false}
          thinking={typing}
        />

        <GlassCard className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {rendered.map(({ key, beat }) => (
            <Beat key={key} beat={beat} personaName={script.personaName} />
          ))}
          {typing ? <TypingBubble name={script.personaName} /> : null}
        </div>

        <div className="border-t border-border-soft p-3">
          {finished ? (
            <div className="flex items-center justify-between gap-3 px-1 py-1.5">
              <p className="text-body-sm text-text-secondary">這一段示範已結束。</p>
              <Button variant="secondary" size="sm" onClick={reset}>
                <RotateCcw size={14} strokeWidth={1.8} aria-hidden />
                重播
              </Button>
            </div>
          ) : (
            <>
              {upcoming ? (
                <button
                  type="button"
                  onClick={() => setDraft(upcoming)}
                  className="mb-2 flex w-full items-center gap-2 rounded-card-sm bg-glass-card px-3 py-2 text-left text-body-sm text-text-secondary transition-colors hover:text-text-primary"
                >
                  <Sparkles size={13} strokeWidth={1.8} aria-hidden className="shrink-0 text-accent-indigo" />
                  <span className="truncate">提詞：{upcoming}</span>
                </button>
              ) : null}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder={upcoming ?? ''}
                  disabled={playing}
                  className="min-h-[42px] flex-1 resize-none rounded-card-sm border border-border-soft bg-transparent px-3 py-2.5 text-body-sm outline-none placeholder:text-text-tertiary focus:border-accent-indigo disabled:opacity-50"
                />
                <Button type="submit" size="sm" disabled={playing}>
                  <Send size={14} strokeWidth={1.8} aria-hidden />
                  送出
                </Button>
              </form>
            </>
          )}
        </div>
        </GlassCard>
      </div>
    </div>
  );
}

function Beat({ beat, personaName }: { beat: DemoBeat; personaName: string }) {
  if (beat.speaker === 'trainee') {
    return (
      <Row align="end" label="你" tone="blue">
        <p className="whitespace-pre-wrap text-body-sm text-text-primary">{beat.text}</p>
      </Row>
    );
  }
  if (beat.speaker === 'persona') {
    return (
      <Row align="start" label={beat.name} tone="indigo">
        <p className="whitespace-pre-wrap text-body-sm text-text-primary">{beat.text}</p>
        {beat.clarifyOptions?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {beat.clarifyOptions.map((opt) => (
              <span
                key={opt}
                className="rounded-pill border border-accent-indigo/40 bg-accent-indigo/10 px-2.5 py-1 text-tiny text-text-secondary"
              >
                {opt}
              </span>
            ))}
          </div>
        ) : null}
        {beat.citations?.length ? <CitationList citations={beat.citations} className="mt-2.5" /> : null}
      </Row>
    );
  }
  if (beat.speaker === 'coach') {
    return (
      <Row align="start" label="AI 教練" tone="violet">
        <p className="text-body-sm font-medium text-text-primary">{beat.title}</p>
        <p className="mt-1 whitespace-pre-wrap text-body-sm text-text-secondary">{beat.text}</p>
      </Row>
    );
  }
  return (
    <div className="px-1">
      <p className="mb-1 text-tiny font-medium text-warning">合規警示</p>
      <ComplianceAlert finding={beat.finding} startedAtMs={0} />
    </div>
  );
}

const TONE_TEXT: Record<'blue' | 'indigo' | 'violet', string> = {
  blue: 'text-accent-blue',
  indigo: 'text-accent-indigo',
  violet: 'text-accent-violet',
};

function Row({
  align,
  label,
  tone,
  children,
}: {
  align: 'start' | 'end';
  label: string;
  tone: 'blue' | 'indigo' | 'violet';
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', align === 'end' ? 'items-end' : 'items-start')}>
      <span className={cn('px-1 text-tiny font-medium', TONE_TEXT[tone])}>{label}</span>
      <div
        className={cn(
          'max-w-[85%] rounded-card border border-border-soft bg-glass-card px-3.5 py-2.5',
          align === 'end' && 'bg-accent-blue/8',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="px-1 text-tiny font-medium text-accent-indigo">{name}</span>
      <div className="rounded-card border border-border-soft bg-glass-card px-3.5 py-3">
        <span className="flex gap-1" aria-label="輸入中">
          <Dot delay="0ms" />
          <Dot delay="150ms" />
          <Dot delay="300ms" />
        </span>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block size-1.5 animate-bounce rounded-full bg-text-tertiary"
      style={{ animationDelay: delay }}
    />
  );
}
