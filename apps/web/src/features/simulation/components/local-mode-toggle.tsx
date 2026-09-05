'use client';

/**
 * Two independent switches beside the microphone: where the customer's *voice*
 * is synthesised, and where the trainee's *speech* is recognised. They are
 * separate because the trade-offs are different — cloud TTS sounds better,
 * on-device STT is faster and keeps the mic audio on the laptop — and someone
 * may reasonably want cloud for one and local for the other.
 *
 * Each is remembered in localStorage on its own: these are standing choices
 * about privacy, cost and quality, not per-session whims, and re-enabling them
 * after every reload would make the cloud the effective default regardless.
 */
import { useEffect } from 'react';

import {
  localTtsSingleVoice,
  localTtsUsable,
  macSttUsable,
  useSttCapabilities,
} from '../hooks/use-stt-capabilities';
import { insetSurface, toneText } from '../lib/tone';
import { useSessionActions, useSessionStore } from '../store/session-store';
import { cn } from './kit';

const TTS_KEY = 'aicoach.voice.tts-local';
const STT_KEY = 'aicoach.voice.stt-local';

function remember(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage unavailable; the choice still applies for this page.
  }
}

function recall(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function Pill({
  on,
  label,
  title,
  ariaLabel,
  disabled,
  onClick,
  className,
}: {
  on: boolean;
  label: string;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'sim-focusable flex h-9 shrink-0 items-center gap-1.5 rounded-input px-2.5 text-meta disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      style={insetSurface(on ? 'mint' : 'neutral', on ? 18 : 10)}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-pill"
        style={{ backgroundColor: on ? toneText('mint') : 'var(--text-tertiary)' }}
      />
      <span style={{ color: on ? toneText('mint') : undefined }}>{label}</span>
    </button>
  );
}

/**
 * Customer voice: on this machine (local) vs ElevenLabs (cloud). "Local" means
 * the local TTS *model* (services/local-tts — Breeze2-VITS, Taiwanese) when the
 * API reports it reachable, and the OS system voice otherwise; the tooltip says
 * which, and names the model the server actually answered with rather than a
 * hard-coded one, so swapping engines cannot leave the UI lying.
 */
export function TtsLocalToggle({ className }: { className?: string }) {
  const speechEngine = useSessionStore((s) => s.voice.speechEngine);
  const actions = useSessionActions();
  const cap = useSttCapabilities();
  const localModel = localTtsUsable(cap);
  const oneVoice = localTtsSingleVoice(cap);
  const model = cap?.tts?.local?.model;
  const on = speechEngine === 'system';

  useEffect(() => {
    const saved = recall(TTS_KEY);
    if (saved === true) actions.setVoice({ speechEngine: 'system' });
  }, [actions]);

  return (
    <Pill
      on={on}
      label="說：本地"
      ariaLabel={on ? '客戶語音改用雲端' : localModel ? '客戶語音改用本地模型' : '客戶語音改用本地系統語音'}
      title={
        on
          ? localModel
            ? `客戶語音：本地模型${model ? `（${model}）` : ''}，離線、免費、不外傳${
                oneVoice ? '；這個模型只有一個女聲，所有人物都用它' : ''
              }。模型無回應時改用系統語音。點擊改用雲端 ElevenLabs。`
            : '客戶語音：這台電腦的系統語音（離線、免費）。點擊改用雲端 ElevenLabs。'
          : localModel
            ? '客戶語音：雲端 ElevenLabs（男女聲皆有，需網路）。點擊改用本地模型。'
            : '客戶語音：雲端 ElevenLabs（音質較好，需網路）。點擊改用本地系統語音。'
      }
      onClick={() => {
        const next = !on;
        actions.setVoice({ speechEngine: next ? 'system' : 'auto' });
        remember(TTS_KEY, next);
      }}
      className={className}
    />
  );
}

/** Trainee speech: Mac on-device recogniser (local) vs ElevenLabs Scribe (cloud). */
export function SttLocalToggle({ className }: { className?: string }) {
  const sttEngine = useSessionStore((s) => s.voice.sttEngine);
  const actions = useSessionActions();
  const cap = useSttCapabilities();
  const macOk = macSttUsable(cap);
  const on = sttEngine === 'mac';

  useEffect(() => {
    // Apply the remembered choice only once the machine is known to be able to.
    if (macOk && recall(STT_KEY) === true) actions.setVoice({ sttEngine: 'mac' });
  }, [actions, macOk]);

  return (
    <Pill
      on={on}
      disabled={!macOk}
      label="聽：本地"
      ariaLabel={on ? '語音辨識改用雲端' : '語音辨識改用 Mac 本機'}
      title={
        !macOk
          ? `Mac 本機辨識不可用：${cap?.mac?.reason ?? cap?.mac?.authorization ?? '偵測中'}`
          : on
            ? '語音辨識：Mac 本機（離線，麥克風音訊不離開這台電腦）。點擊改用雲端。'
            : '語音辨識：雲端 ElevenLabs Scribe。點擊改用 Mac 本機。'
      }
      onClick={() => {
        const next = !on;
        actions.setVoice({ sttEngine: next ? 'mac' : 'auto' });
        remember(STT_KEY, next);
      }}
      className={className}
    />
  );
}

/**
 * The one thing about local mode that cannot live in a tooltip.
 *
 * Breeze2-VITS has a single female speaker, so with 「說：本地」 on, a
 * 67-year-old male customer answers in a young woman's voice. Nobody hovers a
 * pill mid-demo; they hear the wrong voice and start debugging something that
 * is working exactly as designed. So it is written next to the composer, and
 * only while it is actually true — local voice on, and the server reporting a
 * single-speaker model.
 */
export function TtsLocalVoiceNote() {
  const speechEngine = useSessionStore((s) => s.voice.speechEngine);
  const cap = useSttCapabilities();
  if (speechEngine !== 'system' || !localTtsSingleVoice(cap)) return null;
  return (
    <span className="text-text-tertiary" title="改用雲端 ElevenLabs 才有男女聲之分。">
      本地語音：單一女聲（不分男女）
    </span>
  );
}

/**
 * Whether the coach volunteers, next to the two engine switches because it is
 * the same kind of decision: a standing preference about how the session
 * behaves, not a per-turn action.
 *
 * Default off. With the coach commenting on every turn, the affect pipeline's
 * whole point — noticing that you look stuck and *offering* help — had nothing
 * left to offer: the note was already on screen before you frowned. Off, the
 * coach still runs and everything still reaches the report; it just waits to be
 * asked.
 */
export function CoachAutoToggle({ className }: { className?: string }) {
  const on = useSessionStore((s) => s.coachAutoPush);
  const held = useSessionStore((s) => s.heldCoachCount);
  const actions = useSessionActions();

  return (
    <Pill
      on={on}
      label="教練：主動"
      ariaLabel={on ? '改成只有詢問時才給教練建議' : '讓教練主動給建議'}
      title={
        on
          ? '教練會在每一輪主動給建議。點擊改成只在你詢問時才出現。'
          : `教練只在你按下「詢問教練」時才出現${held > 0 ? `（已為報告保留 ${held} 則）` : ''}。點擊改成每輪主動提示。`
      }
      onClick={() => actions.setCoachAutoPush(!on)}
      className={className}
    />
  );
}
