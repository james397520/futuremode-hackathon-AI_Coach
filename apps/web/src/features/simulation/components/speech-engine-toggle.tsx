'use client';

/**
 * Which synthesiser speaks the customer, and — separately — an honest note about
 * where speech *recognition* runs.
 *
 * Three states rather than a checkbox, because "off" is ambiguous here:
 *
 *   自動  prefer the server's ElevenLabs audio, fall back to the on-device voice
 *         when the server sent none. Also the no-key and no-network path.
 *   系統  force the OS voice: free, offline, nothing leaves the machine.
 *   雲端  force ElevenLabs and stay **silent** when there is no clip, so a demo
 *         cannot be quietly downgraded to a system voice without anyone noticing.
 *
 * The recognition note states the one real STT path (mic → our API → Scribe)
 * and says the browser's own `SpeechRecognition` is not used. That API sits
 * behind the same `webkit` prefix in every browser but is Apple's recogniser in
 * Safari and Google's servers in Chromium; an earlier wording mentioned Google
 * without saying "unused", which read as if two STT engines were in play.
 */
import type { RecognitionCapability } from '../lib/system-speech';
import { insetSurface, toneText } from '../lib/tone';
import { cn } from './kit';

export type SpeechEngine = 'auto' | 'system' | 'cloud';

const OPTIONS: { value: SpeechEngine; label: string; hint: string }[] = [
  { value: 'auto', label: '自動', hint: '優先用雲端語音，沒有時改用系統內建' },
  { value: 'system', label: '系統內建', hint: '一律用這台電腦的語音：免費、離線、不外傳' },
  { value: 'cloud', label: '雲端', hint: '一律用 ElevenLabs；沒有音檔時不出聲，不會偷偷降級' },
];

export interface SpeechEngineToggleProps {
  value: SpeechEngine;
  onChange: (value: SpeechEngine) => void;
  /** How many on-device voices matched the locale. 0 disables the system option. */
  systemVoiceCount: number;
  recognition?: RecognitionCapability | null;
  className?: string;
}

export function SpeechEngineToggle({
  value,
  onChange,
  systemVoiceCount,
  recognition = null,
  className,
}: SpeechEngineToggleProps) {
  const systemUnavailable = systemVoiceCount === 0;

  return (
    <div className={cn('grid gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-sm font-medium text-text-primary">客戶語音</span>
        <span className="text-tiny text-text-tertiary">
          {systemUnavailable ? '找不到系統中文語音' : `系統中文語音 ${systemVoiceCount} 種`}
        </span>
      </div>

      <div role="radiogroup" aria-label="客戶語音引擎" className="flex flex-wrap gap-1.5">
        {OPTIONS.map((option) => {
          const disabled = option.value === 'system' && systemUnavailable;
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              title={option.hint}
              className="sim-focusable rounded-pill px-3 py-1.5 text-meta disabled:cursor-not-allowed disabled:opacity-45"
              style={insetSurface(active ? 'blue' : 'neutral', active ? 15 : 8)}
            >
              <span style={{ color: active ? toneText('blue') : undefined }}>{option.label}</span>
            </button>
          );
        })}
      </div>

      <p className="text-tiny text-text-tertiary">
        {OPTIONS.find((o) => o.value === value)?.hint}
      </p>

      {/* One STT path exists: microphone → our API → ElevenLabs Scribe. The
          browser's own SpeechRecognition is deliberately NOT used — in Chromium
          it streams the mic to Google — and saying so here stops the previous
          wording from reading as if it were. */}
      <p className="text-tiny text-text-tertiary">
        語音辨識：由伺服器端（ElevenLabs Scribe）處理，麥克風音訊不會送到瀏覽器內建辨識
        {recognition?.engine === 'google' ? '（此瀏覽器的內建辨識會送 Google，已停用）' : ''}
        。
      </p>
    </div>
  );
}
