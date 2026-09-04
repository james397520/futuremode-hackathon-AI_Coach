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
  HeadphonesIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  RadioIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  TranscriptIcon,
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
  pushToTalkHeld: boolean;
  captionsEnabled: boolean;
  onStart: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onTogglePushToTalkMode: () => void;
  onPushToTalkDown: () => void;
  onPushToTalkUp: () => void;
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
      className="sim-focusable sim-lift flex h-11 w-11 items-center justify-center rounded-input border disabled:cursor-not-allowed disabled:opacity-45"
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
  pushToTalkHeld,
  captionsEnabled,
  onStart,
  onToggleMute,
  onToggleSpeaker,
  onTogglePushToTalkMode,
  onPushToTalkDown,
  onPushToTalkUp,
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
        'glass-strong flex flex-wrap items-center gap-2.5 rounded-card border p-3 shadow-floating',
        className,
      )}
      style={{ borderColor: tint('neutral', 18) }}
      aria-label="Voice call controls"
    >
      {/* Status ------------------------------------------------------------- */}
      <span
        className="flex items-center gap-2 rounded-pill border px-3 py-1.5 text-meta"
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
          className="sim-focusable sim-lift flex h-11 items-center gap-2 rounded-input px-4 text-body font-medium disabled:opacity-50"
          style={{
            background:
              'linear-gradient(120deg, var(--accent-indigo), var(--accent-blue) 58%, var(--accent-mint))',
            color: 'var(--bg-canvas-soft)',
          }}
        >
          <MicIcon size={17} />
          {starting ? 'Starting…' : 'Start voice session'}
        </button>
      ) : (
        <>
          <ControlButton
            label={muted ? 'Unmute microphone' : 'Mute microphone'}
            icon={muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            onClick={onToggleMute}
            tone={muted ? 'warning' : 'blue'}
            pressed={!muted}
            fill={12}
          />

          <button
            type="button"
            onPointerDown={() => {
              if (pushToTalkMode) onPushToTalkDown();
            }}
            onPointerUp={() => {
              if (pushToTalkMode) onPushToTalkUp();
            }}
            onPointerLeave={() => {
              if (pushToTalkMode && pushToTalkHeld) onPushToTalkUp();
            }}
            onClick={() => {
              if (!pushToTalkMode) onTogglePushToTalkMode();
            }}
            onDoubleClick={onTogglePushToTalkMode}
            aria-pressed={pushToTalkMode}
            aria-label={
              pushToTalkMode
                ? 'Push to talk — hold to speak. Double-click to switch back to open mic.'
                : 'Switch to push to talk'
            }
            title={pushToTalkMode ? 'Hold to talk (double-click to leave push-to-talk)' : 'Push to talk'}
            className="sim-focusable sim-lift flex h-11 items-center gap-2 rounded-input border px-3.5 text-meta"
            style={insetSurface(pushToTalkHeld ? 'mint' : pushToTalkMode ? 'cyan' : 'neutral', pushToTalkHeld ? 20 : 11)}
          >
            <RadioIcon
              size={17}
              style={{ color: toneText(pushToTalkHeld ? 'mint' : pushToTalkMode ? 'cyan' : 'neutral') }}
            />
            <span style={{ color: toneText(pushToTalkHeld ? 'mint' : pushToTalkMode ? 'cyan' : 'neutral') }}>
              {pushToTalkHeld ? 'Talking' : 'Push to talk'}
            </span>
          </button>
        </>
      )}

      <ControlButton
        label={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
        icon={speakerMuted ? <SpeakerOffIcon size={18} /> : <SpeakerIcon size={18} />}
        onClick={onToggleSpeaker}
        tone={speakerMuted ? 'warning' : 'neutral'}
        pressed={!speakerMuted}
      />
      <ControlButton
        label="Audio device"
        icon={<HeadphonesIcon size={18} />}
        onClick={onOpenAudioDevice}
      />
      <ControlButton
        label="Transcript"
        icon={<TranscriptIcon size={18} />}
        onClick={onOpenTranscript}
      />
      <ControlButton
        label="Captions"
        icon={<CaptionsIcon size={18} />}
        onClick={onToggleCaptions}
        pressed={captionsEnabled}
        tone={captionsEnabled ? 'blue' : 'neutral'}
      />

      <div className="ml-auto">
        <button
          type="button"
          onClick={onEndCall}
          disabled={ended}
          className="sim-focusable sim-lift flex h-11 items-center gap-2 rounded-input border px-4 text-body font-medium disabled:opacity-45"
          style={insetSurface('danger', 14)}
        >
          <PhoneOffIcon size={17} style={{ color: toneText('danger') }} />
          <span style={{ color: toneText('danger') }}>End call</span>
        </button>
      </div>
    </div>
  );
}
