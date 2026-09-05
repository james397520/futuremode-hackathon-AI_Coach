'use client';

/**
 * Input composer — spec §18.
 *
 * One floating glass bar: microphone / push-to-talk, multiline text, turn +
 * character hints, send. Enter sends, Shift+Enter makes a newline. There is no
 * attachment control: a live simulation takes speech and text, nothing else
 * (attach-free by design).
 *
 * While the persona is speaking or the session is paused the composer is
 * genuinely disabled — and it says why, rather than silently swallowing keys
 * (§94: explain, don't block mysteriously).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SessionState } from '@ai-coach/shared';

import { INPUT_BLOCKED_STATES } from '../lib/session-transitions';
import { insetSurface, tint, toneText } from '../lib/tone';
import { LiveDot } from './atoms';
import { CameraIcon, CameraOffIcon, LightbulbIcon, MicIcon, MicOffIcon, SendIcon } from './icons';
import { cn, Textarea } from './kit';

const MAX_CHARS = 1200;

export interface ComposerProps {
  status: SessionState;
  onSend: (text: string) => void;
  onPushToTalk: (pressed: boolean) => void;
  /** Training Mode only. When undefined the hint control does not render (§8.4). */
  onRequestHint?: () => void;
  voiceEnabled: boolean;
  micLive: boolean;
  /**
   * Webcam channel for facial-affect recognition. Absent = no camera button at
   * all, which is the correct default: the control must not exist where the
   * feature is not wired (§47).
   */
  cameraLive?: boolean;
  onToggleCamera?: (() => void) | undefined;
  muted: boolean;
  onToggleMic: () => void;
  vadActive?: boolean;
  turnCount: number;
  maxTurns?: number;
  className?: string;
}

const BLOCK_REASON: Partial<Record<SessionState, string>> = {
  idle: '正在準備練習。',
  connecting: '正在連線…',
  persona_speaking: '客戶正在說話，請等他說完後再回覆。',
  paused: '練習已暫停，繼續後即可輸入。',
  reconnecting: '正在重新連線，連線完成後即可繼續。',
  completed: '本次練習已結束。',
  error: '練習發生問題，請繼續或重新開始。',
};

export function Composer({
  status,
  onSend,
  onPushToTalk,
  onRequestHint,
  voiceEnabled,
  micLive,
  cameraLive = false,
  onToggleCamera,
  muted,
  onToggleMic,
  vadActive = false,
  turnCount,
  maxTurns,
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [pttHeld, setPttHeld] = useState(false);

  const blocked = INPUT_BLOCKED_STATES.includes(status);
  const reason = blocked ? (BLOCK_REASON[status] ?? 'Input is unavailable right now.') : null;
  const overLimit = value.length > MAX_CHARS;
  const canSend = !blocked && value.trim().length > 0 && !overLimit;

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
  }, [canSend, onSend, value]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  // §18 — hold space for push-to-talk, but never while the caret is in a field.
  useEffect(() => {
    if (!voiceEnabled) return undefined;

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setPttHeld(true);
      onPushToTalk(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (isTypingTarget(event.target)) return;
      setPttHeld(false);
      onPushToTalk(false);
    };
    const blur = () => {
      setPttHeld(false);
      onPushToTalk(false);
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [onPushToTalk, voiceEnabled]);

  const turnHint = maxTurns ? `Turn ${turnCount} / ${maxTurns}` : `Turn ${turnCount}`;

  return (
    <div className={cn('shrink-0', className)}>
      <div
        className="relative flex items-end gap-2 overflow-hidden rounded-panel border bg-[color:color-mix(in_srgb,var(--glass-card-strong)_94%,transparent)] p-2.5 pt-3.5 shadow-soft"
        style={{ borderColor: 'color-mix(in srgb, var(--accent-indigo) 18%, var(--border-soft))' }}
      >
        <span className="absolute inset-x-0 top-0 h-1 bg-[color:color-mix(in_srgb,var(--accent-indigo)_16%,transparent)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <Textarea
            value={value}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={blocked}
            rows={1}
            maxLength={MAX_CHARS + 200}
            aria-label="你的回覆"
            aria-describedby="composer-hints"
            placeholder={blocked ? (reason ?? '') : '輸入你的回覆…'}
            className="sim-scroll max-h-32 min-h-[40px] w-full resize-none border-0 bg-transparent px-1 py-2 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:cursor-not-allowed"
          />
        </div>

        {voiceEnabled ? (
          <button
            type="button"
            onClick={onToggleMic}
            aria-pressed={micLive && !muted}
            aria-label={micLive && !muted ? '靜音麥克風' : '啟用麥克風'}
            className="sim-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-input"
            style={insetSurface(vadActive ? 'mint' : micLive && !muted ? 'blue' : 'neutral', 14)}
          >
            {micLive && !muted ? (
              <MicIcon size={17} style={{ color: toneText(vadActive ? 'mint' : 'blue') }} />
            ) : (
              <MicOffIcon size={17} className="text-text-tertiary" />
            )}
          </button>
        ) : null}

        {onToggleCamera ? (
          <button
            type="button"
            onClick={onToggleCamera}
            aria-pressed={cameraLive}
            aria-label={cameraLive ? '關閉攝影機' : '開啟攝影機'}
            title={cameraLive ? '關閉攝影機' : '開啟攝影機（分析你的表情，畫面不會離開這台電腦）'}
            className="sim-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-input"
            style={insetSurface(cameraLive ? 'cyan' : 'neutral', 14)}
          >
            {cameraLive ? (
              <CameraIcon size={17} style={{ color: toneText('cyan') }} />
            ) : (
              <CameraOffIcon size={17} className="text-text-tertiary" />
            )}
          </button>
        ) : null}

        {onRequestHint ? (
          <button
            type="button"
            onClick={onRequestHint}
            disabled={blocked}
          aria-label="向教練詢問提示"
            className="sim-focusable flex h-9 w-9 shrink-0 items-center justify-center rounded-input disabled:opacity-50"
            style={insetSurface('violet', 13)}
          >
            <LightbulbIcon size={17} style={{ color: toneText('violet') }} />
          </button>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="sim-focusable flex h-9 shrink-0 items-center gap-2 rounded-button px-3.5 text-body-sm font-medium transition-[background-color,transform,box-shadow] duration-150 ease-out-soft hover:-translate-y-px hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
          style={{
            background: 'var(--action-dark)',
            color: 'var(--text-on-accent)',
          }}
        >
          <SendIcon size={16} />
          送出
        </button>
      </div>

      <div
        id="composer-hints"
        className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5 text-tiny text-text-tertiary"
      >
        {pttHeld ? (
          <span className="flex items-center gap-1.5" style={{ color: toneText('mint') }}>
            <LiveDot tone="mint" pulsing />
            正在聆聽，放開空白鍵即可送出
          </span>
        ) : (
          <span>{voiceEnabled ? '按住空白鍵說話 · Enter 送出 · Shift + Enter 換行' : 'Enter 送出 · Shift + Enter 換行'}</span>
        )}
        <span className="tabular-nums">{turnHint}</span>
        <span className={cn('tabular-nums', overLimit && 'font-semibold')} style={overLimit ? { color: toneText('danger') } : undefined}>
          {value.length} / {MAX_CHARS}
        </span>
        {reason ? (
          <span className="basis-full" style={{ color: toneText('warning') }} role="status">
            {reason}
          </span>
        ) : null}
      </div>
    </div>
  );
}
