'use client';

/**
 * Recognition engine + live status, right under the composer where the
 * microphone is — not buried in a settings dialog, which is where nobody
 * looked for it.
 *
 * Click cycles 自動 → Mac 本機 → 雲端 (skipping Mac when the API says the
 * on-device daemon is not usable). The status half says what the last
 * utterance did: transcribing, sent via which provider in how long, heard
 * nothing, or failed and why. Speech with no visible reaction is
 * indistinguishable from a dead microphone; this is the reaction.
 */
import { macSttUsable, useSttCapabilities } from '../hooks/use-stt-capabilities';
import { insetSurface, toneText } from '../lib/tone';
import { useSessionActions, useSessionStore } from '../store/session-store';
import { LiveDot } from './atoms';

const LABEL: Record<'auto' | 'mac' | 'cloud', string> = {
  auto: '自動',
  mac: 'Mac 本機',
  cloud: '雲端',
};

const PROVIDER_LABEL: Record<string, string> = {
  mac: 'Mac 本機',
  elevenlabs: '雲端',
  openai: '雲端',
  none: '未設定',
};

export function SttEnginePill() {
  const engine = useSessionStore((s) => s.voice.sttEngine);
  const status = useSessionStore((s) => s.voice.sttStatus);
  const actions = useSessionActions();
  const cap = useSttCapabilities();
  const macOk = macSttUsable(cap);

  const next = (): void => {
    const order: Array<'auto' | 'mac' | 'cloud'> = macOk ? ['auto', 'mac', 'cloud'] : ['auto', 'cloud'];
    const i = order.indexOf(engine);
    actions.setVoice({ sttEngine: order[(i + 1) % order.length] ?? 'auto' });
  };

  let statusText = '';
  let tone: 'neutral' | 'mint' | 'warning' | 'danger' | 'blue' = 'neutral';
  switch (status.phase) {
    case 'transcribing':
      statusText = '正在轉寫…';
      tone = 'blue';
      break;
    case 'done':
      statusText = `已送出 · ${PROVIDER_LABEL[status.provider ?? ''] ?? status.provider} ${status.ms ?? 0}ms`;
      tone = 'mint';
      break;
    case 'empty':
      statusText = '沒有聽到內容';
      tone = 'warning';
      break;
    case 'error':
      statusText = `轉寫失敗${status.detail ? `：${status.detail}` : ''}`;
      tone = 'danger';
      break;
    default:
      statusText = '';
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={next}
        title={
          macOk
            ? '語音辨識引擎（點擊切換）。Mac 本機：離線、音訊不離開這台電腦'
            : `語音辨識引擎（點擊切換）。Mac 本機不可用：${cap?.mac?.reason ?? cap?.mac?.authorization ?? '偵測中'}`
        }
        aria-label={`語音辨識引擎：${LABEL[engine]}，點擊切換`}
        className="sim-focusable flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-tiny"
        style={insetSurface(engine === 'mac' ? 'mint' : engine === 'cloud' ? 'blue' : 'neutral', 12)}
      >
        <span className="text-text-tertiary">辨識</span>
        <span style={{ color: toneText(engine === 'mac' ? 'mint' : engine === 'cloud' ? 'blue' : 'neutral') }}>
          {LABEL[engine]}
        </span>
      </button>
      {statusText ? (
        <span className="flex items-center gap-1.5" style={{ color: toneText(tone) }} role="status">
          <LiveDot tone={tone === 'neutral' ? 'neutral' : tone} pulsing={status.phase === 'transcribing'} />
          {statusText}
        </span>
      ) : null}
    </span>
  );
}
