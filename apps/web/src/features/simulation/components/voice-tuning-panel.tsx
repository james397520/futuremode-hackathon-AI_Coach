'use client';

/**
 * Sliders for the two voices, with a 試聽 button each.
 *
 * Cloud (ElevenLabs): 穩定度 / 相似度 / 風格 / 速度. The rising-intonation
 * complaint on Chinese — every sentence ending like a question — is stability
 * too low and style too high; the defaults are already set against it, and
 * these let a trainee push further or trade some flatness back for life.
 *
 * System (macOS voice): 速度 / 音高.
 *
 * Both are remembered in localStorage: a voice that sounds right is a standing
 * preference, not a per-session one.
 */
import { useEffect } from 'react';

import { insetSurface, toneText } from '../lib/tone';
import { useSessionActions, useSessionStore } from '../store/session-store';

const KEY = 'aicoach.voice.tuning';
const SAMPLE = '我比較想先知道這個方案一個月實際會多花多少錢。';

type Cloud = { stability: number; similarity: number; style: number; speed: number };
type System = { rate: number; pitch: number };

function Slider({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
  format = (v: number) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="grid gap-1 text-body-sm" title={hint}>
      <span className="flex items-center justify-between text-text-secondary">
        <span>{label}</span>
        <span className="tabular-nums text-text-tertiary">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent-indigo)]"
        aria-label={label}
      />
    </label>
  );
}

export interface VoiceTuningPanelProps {
  /** Speak the sample with a given engine, using the current sliders. */
  onPreview: (engine: 'system' | 'cloud') => Promise<unknown> | void;
}

export function VoiceTuningPanel({ onPreview }: VoiceTuningPanelProps) {
  const cloud = useSessionStore((s) => s.voice.ttsTuning);
  const system = useSessionStore((s) => s.voice.systemTuning);
  const actions = useSessionActions();

  // Restore once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { cloud?: Partial<Cloud>; system?: Partial<System> };
      if (saved.cloud) actions.setVoice({ ttsTuning: { ...cloud, ...saved.cloud } });
      if (saved.system) actions.setVoice({ systemTuning: { ...system, ...saved.system } });
    } catch {
      // ignore bad or unavailable storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount
  }, []);

  const persist = (nextCloud: Cloud, nextSystem: System): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ cloud: nextCloud, system: nextSystem }));
    } catch {
      // not persisted; still applied
    }
  };
  const setCloud = (patch: Partial<Cloud>): void => {
    const next = { ...cloud, ...patch };
    actions.setVoice({ ttsTuning: next });
    persist(next, system);
  };
  const setSystem = (patch: Partial<System>): void => {
    const next = { ...system, ...patch };
    actions.setVoice({ systemTuning: next });
    persist(cloud, next);
  };

  const preview = (engine: 'system' | 'cloud') => (
    <button
      type="button"
      onClick={() => void onPreview(engine)}
      className="sim-focusable rounded-pill px-3 py-1 text-meta"
      style={insetSurface('blue', 12)}
    >
      <span style={{ color: toneText('blue') }}>試聽</span>
    </button>
  );

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <span className="text-body-sm font-medium text-text-primary">雲端語音（ElevenLabs）</span>
          {preview('cloud')}
        </div>
        <Slider label="穩定度" value={cloud.stability} min={0} max={1} step={0.05}
          hint="越高越平穩、音調越不飄；太高會像唸稿。上飄問題先調這個。"
          onChange={(v) => setCloud({ stability: v })} />
        <Slider label="風格" value={cloud.style} min={0} max={1} step={0.05}
          hint="情緒表現的強度。0 最平；越高音調起伏越大、越容易句尾上揚。"
          onChange={(v) => setCloud({ style: v })} />
        <Slider label="相似度" value={cloud.similarity} min={0} max={1} step={0.05}
          hint="貼近原聲的程度。太高可能帶入原聲的雜訊。"
          onChange={(v) => setCloud({ similarity: v })} />
        <Slider label="速度" value={cloud.speed} min={0.7} max={1.2} step={0.05}
          hint="ElevenLabs 允許 0.7–1.2。" onChange={(v) => setCloud({ speed: v })} />
        <p className="text-tiny text-text-tertiary">
          建議：穩定度 0.75–0.9、風格 0。試聽用的是同一句客戶台詞。
        </p>
      </section>

      <section className="grid gap-3 border-t pt-4" style={{ borderColor: 'var(--border-soft)' }}>
        <div className="flex items-center justify-between">
          <span className="text-body-sm font-medium text-text-primary">系統語音（macOS）</span>
          {preview('system')}
        </div>
        <Slider label="速度" value={system.rate} min={0.6} max={1.6} step={0.05}
          hint="1.0 為原速。" onChange={(v) => setSystem({ rate: v })} />
        <Slider label="音高" value={system.pitch} min={0.6} max={1.4} step={0.05}
          hint="1.0 為原音高；覺得飄可以降到 0.85–0.95。" onChange={(v) => setSystem({ pitch: v })} />
        <button
          type="button"
          onClick={() => {
            setCloud({ stability: 0.75, similarity: 0.75, style: 0, speed: 1 });
            setSystem({ rate: 1, pitch: 1 });
          }}
          className="sim-focusable justify-self-start rounded-pill px-3 py-1 text-tiny text-text-secondary"
          style={insetSurface('neutral', 9)}
        >
          恢復預設
        </button>
      </section>
    </div>
  );
}
