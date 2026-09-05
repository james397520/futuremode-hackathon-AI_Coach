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

import { localTtsUsable, macSttUsable, useSttCapabilities } from '../hooks/use-stt-capabilities';
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
 * the local TTS *model* (services/local-tts, Kokoro zh) when the API reports it
 * reachable, and the OS system voice otherwise — the tooltip says which.
 */
export function TtsLocalToggle({ className }: { className?: string }) {
  const speechEngine = useSessionStore((s) => s.voice.speechEngine);
  const actions = useSessionActions();
  const cap = useSttCapabilities();
  const localModel = localTtsUsable(cap);
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
            ? '客戶語音：本地模型（Kokoro 中文，離線、免費、不外傳；模型無回應時改用系統語音）。點擊改用雲端 ElevenLabs。'
            : '客戶語音：這台電腦的系統語音（離線、免費）。點擊改用雲端 ElevenLabs。'
          : localModel
            ? '客戶語音：雲端 ElevenLabs（音質較好，需網路）。點擊改用本地模型。'
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
