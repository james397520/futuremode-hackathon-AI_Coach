'use client';

/**
 * Voice call controls — spec §22.2 (button set), §24 (floating mini controls).
 *
 * Start Voice Session · Mute/Unmute · Push to Talk · Speaker · Audio Device ·
 * Transcript · Captions · End Call — as one floating glass bar, never a big
 * video-conference control strip (§20.1).
 */
import type { ReactNode } from 'react';

import { VOICE_STATUS_LABEL } from '../lib/labels';
import { insetSurface, tint, toneText, type ToneKey } from '../lib/tone';
import type { VoiceStatus } from '../lib/types';
import { LiveDot } from './atoms';
import {
  CaptionsIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
} from './icons';
import { cn } from './kit';

const STATUS_TONE: Record<VoiceStatus, ToneKey> = {
  idle: 'neutral',
  connecting: 'blue',
  listening: 'cyan',
  transcribing: 'blue',
  thinking: 'indigo',
  speaking: 'violet',
  interrupted: 'warning',
  reconnecting: 'warning',
  ended: 'neutral',
};

export interface VoiceControlsProps {
  status: VoiceStatus;
  micLive: boolean;
  starting: boolean;
  muted: boolean;
  speakerMuted: boolean;
  pushToTalkMode: boolean;
  captionsEnabled: boolean;
  onStart: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onTogglePushToTalkMode: () => void;
  onOpenAudioDevice: () => void;
  onOpenTranscript: () => void;
  onToggleCaptions: () => void;
  onEndCall: () => void;
  className?: string;
}

function ControlButton({
  label,
  icon,
  onClick,
  tone = 'neutral',
  pressed,
  disabled,
  fill = 10,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: ToneKey;
  pressed?: boolean;
  disabled?: boolean;
  fill?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className="sim-focusable sim-lift flex h-11 w-11 items-center justify-center rounded-input disabled:cursor-not-allowed disabled:opacity-45"
      style={insetSurface(tone, pressed ? fill + 10 : fill)}
    >
      <span style={{ color: toneText(tone) }}>{icon}</span>
    </button>
  );
}

export function VoiceControls({
  status,
  micLive,
  starting,
  muted,
  speakerMuted,
  pushToTalkMode,
  captionsEnabled,
  onStart,
  onToggleMute,
  onToggleSpeaker,
  onTogglePushToTalkMode,
  onOpenAudioDevice,
  onOpenTranscript,
  onToggleCaptions,
  onEndCall,
  className,
}: VoiceControlsProps) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  const ended = status === 'ended';

  return (
    <div
      className={cn(
        'glass-strong flex items-center gap-2 rounded-card border px-3 py-2 shadow-floating',
        className,
      )}
      style={{ borderColor: tint('neutral', 18) }}
      aria-label="語音通話控制"
    >
      {/* Voice is optional. Text remains the primary way to reply. */}
      <span
        className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny"
        style={insetSurface(tone, 14)}
        role="status"
      >
        <LiveDot tone={tone} pulsing={status !== 'idle' && status !== 'ended'} />
        <span style={{ color: toneText(tone) }}>{VOICE_STATUS_LABEL[status]}</span>
      </span>

      {!micLive ? (
        <button
          type="button"
          onClick={onStart}
          disabled={starting || ended}
          className="sim-focusable sim-lift flex h-9 items-center gap-1.5 rounded-input px-3 text-meta font-medium disabled:opacity-50"
          style={{
            background: 'var(--action-dark)',
            color: 'var(--text-on-accent)',
          }}
        >
          <MicIcon size={17} />
          {starting ? '啟動中…' : '啟用語音'}
        </button>
      ) : (
        <>
          <ControlButton
            label={muted ? '取消靜音麥克風' : '靜音麥克風'}
            icon={muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            onClick={onToggleMute}
            tone={muted ? 'warning' : 'blue'}
            pressed={!muted}
            fill={12}
          />

        </>
      )}

      <ControlButton
        label="字幕"
        icon={<CaptionsIcon size={18} />}
        onClick={onToggleCaptions}
        pressed={captionsEnabled}
        tone={captionsEnabled ? 'blue' : 'neutral'}
      />

      <details className="relative ml-auto">
        <summary className="sim-focusable cursor-pointer list-none rounded-input px-3 py-2 text-meta text-text-secondary" style={insetSurface('neutral', 9)}>
          更多設定
        </summary>
        <div className="glass-strong absolute bottom-11 right-0 z-20 grid min-w-48 gap-1 rounded-card border p-2 shadow-floating" style={{ borderColor: tint('neutral', 18) }}>
          <button type="button" onClick={onToggleSpeaker} className="sim-focusable rounded-input px-3 py-2 text-left text-meta text-text-secondary hover:bg-black/5">
            {speakerMuted ? '開啟客戶語音' : '靜音客戶語音'}
          </button>
          <button type="button" onClick={onTogglePushToTalkMode} className="sim-focusable rounded-input px-3 py-2 text-left text-meta text-text-secondary hover:bg-black/5">
            {pushToTalkMode ? '切換為開放麥克風' : '切換為按住說話'}
          </button>
          <button type="button" onClick={onOpenAudioDevice} className="sim-focusable rounded-input px-3 py-2 text-left text-meta text-text-secondary hover:bg-black/5">
            音訊裝置
          </button>
          <button type="button" onClick={onOpenTranscript} className="sim-focusable rounded-input px-3 py-2 text-left text-meta text-text-secondary hover:bg-black/5">
            匯出逐字稿
          </button>
        </div>
      </details>

      <ControlButton
        label="結束練習"
        icon={<PhoneOffIcon size={18} />}
        onClick={onEndCall}
        disabled={ended}
        tone="danger"
        fill={12}
      />
    </div>
  );
}
