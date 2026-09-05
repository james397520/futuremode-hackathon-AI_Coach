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
export type SttEngine = 'auto' | 'mac' | 'cloud';

export interface SttCapability {
  default: string;
  cloud: boolean;
  mac: { available: boolean; onDevice?: boolean; authorization?: string; reason?: string };
}

const STT_OPTIONS: { value: SttEngine; label: string; hint: string }[] = [
  { value: 'auto', label: '自動', hint: '依伺服器設定（STT_PROVIDER）' },
  { value: 'mac', label: 'Mac 本機', hint: 'Apple 語音辨識，音訊不離開這台電腦；本機無法辨識時才送雲端' },
  { value: 'cloud', label: '雲端', hint: '一律送 ElevenLabs Scribe' },
];

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
  /** STT engine choice. Omit both to hide the recognition section. */
  sttValue?: SttEngine;
  onSttChange?: (value: SttEngine) => void;
  sttCapability?: SttCapability | null;
  className?: string;
}

export function SpeechEngineToggle({
  value,
  onChange,
  systemVoiceCount,
  recognition = null,
  sttValue,
  onSttChange,
  sttCapability = null,
  className,
}: SpeechEngineToggleProps) {
  const macOk = Boolean(sttCapability?.mac?.available && sttCapability?.mac?.authorization !== 'denied');
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

      {sttValue && onSttChange ? (
        <div className="mt-2 grid gap-2 border-t pt-3" style={{ borderColor: 'var(--border-soft)' }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-sm font-medium text-text-primary">語音辨識</span>
            <span className="text-tiny text-text-tertiary">
              {sttCapability == null
                ? '偵測中…'
                : macOk
                  ? `Mac 本機可用${sttCapability.mac.onDevice ? '（離線）' : ''}`
                  : `Mac 本機不可用：${sttCapability.mac.reason ?? sttCapability.mac.authorization ?? '未知'}`}
            </span>
          </div>
          <div role="radiogroup" aria-label="語音辨識引擎" className="flex flex-wrap gap-1.5">
            {STT_OPTIONS.map((option) => {
              const disabled = option.value === 'mac' && !macOk;
              const active = sttValue === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => onSttChange(option.value)}
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
            {STT_OPTIONS.find((o) => o.value === sttValue)?.hint}
            {recognition?.engine === 'google' ? '。瀏覽器內建辨識（會送 Google）未使用。' : '。'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
