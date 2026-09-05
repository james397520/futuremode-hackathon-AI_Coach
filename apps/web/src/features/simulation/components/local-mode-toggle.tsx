'use client';

/**
 * One switch for "keep the voice on this machine": on = system TTS + Mac
 * on-device STT, off = the server defaults. It sits beside the microphone
 * because that is where someone deciding "I don't want audio leaving this
 * laptop" is looking; the three-way engine pickers stay in the audio dialog
 * for anyone who wants to mix.
 *
 * Remembered in localStorage: this is a stance about privacy and cost, not a
 * per-session whim, and having to re-enable it after every reload would make
 * the cloud the effective default regardless of what the user chose.
 */
import { useEffect } from 'react';

import { macSttUsable, useSttCapabilities } from '../hooks/use-stt-capabilities';
import { insetSurface, toneText } from '../lib/tone';
import { useSessionActions, useSessionStore } from '../store/session-store';
import { cn } from './kit';

const STORAGE_KEY = 'aicoach.voice.local-mode';

export function LocalModeToggle({ className }: { className?: string }) {
  const speechEngine = useSessionStore((s) => s.voice.speechEngine);
  const sttEngine = useSessionStore((s) => s.voice.sttEngine);
  const actions = useSessionActions();
  const cap = useSttCapabilities();
  const macOk = macSttUsable(cap);

  // TTS local is the part that always works; STT local depends on the daemon.
  const local = speechEngine === 'system' && (sttEngine === 'mac' || !macOk);

  // Restore the remembered choice once; apply STT only when the machine can.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') {
        actions.setVoice({ speechEngine: 'system', sttEngine: macOk ? 'mac' : 'auto' });
      }
    } catch {
      // Storage unavailable (private mode, blocked) — default stays.
    }
  }, [actions, macOk]);

  const toggle = (): void => {
    const next = !local;
    actions.setVoice(
      next
        ? { speechEngine: 'system', sttEngine: macOk ? 'mac' : 'auto' }
        : { speechEngine: 'auto', sttEngine: 'auto' },
    );
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Not persisted; the choice still applies for this page.
    }
  };

  const title = local
    ? macOk
      ? '本地模式：語音合成用系統語音、辨識用 Mac 本機。離線可用，音訊不離開這台電腦。點擊關閉。'
      : '本地模式（部分）：語音合成用系統語音；辨識本機不可用，仍走雲端。點擊關閉。'
    : '切換到本地模式：語音合成與辨識都在這台電腦完成，不經雲端。';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={local}
      aria-label={local ? '關閉本地語音模式' : '開啟本地語音模式'}
      title={title}
      className={cn(
        'sim-focusable flex h-9 shrink-0 items-center gap-1.5 rounded-input px-2.5 text-meta',
        className,
      )}
      style={insetSurface(local ? 'mint' : 'neutral', local ? 18 : 10)}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-pill"
        style={{ backgroundColor: local ? toneText('mint') : 'var(--text-tertiary)' }}
      />
      <span style={{ color: local ? toneText('mint') : undefined }}>本地</span>
    </button>
  );
}
