'use client';

/**
 * Session header — spec §15 / §23.
 *
 * Scenario, persona, difficulty, mode, session-state pill, elapsed timer, turn
 * counter, connection indicator, runtime badge, and the Pause / Restart / End
 * controls. The runtime badge shows the acceleration tier only — never the GPU
 * model (§15) — and a fallback reads as information, not an error (§94).
 */
import type { ReactNode } from 'react';
import type { Difficulty, SessionMode, SessionState } from '@ai-coach/shared';

import { formatTimer } from '../lib/format';
import {
  DIFFICULTY_LABEL,
  DIFFICULTY_TONE,
  RUNTIME_BADGE,
  SESSION_STATE_LABEL,
  SESSION_STATE_TONE,
} from '../lib/labels';
import { isLive } from '../lib/session-transitions';
import { insetSurface, tint, toneText } from '../lib/tone';
import type { RuntimeStatus } from '../lib/types';
import { LiveDot, TonePill } from './atoms';
import { ClockIcon, PauseIcon, PlayIcon, RadioIcon, RestartIcon, ShieldIcon, StopIcon } from './icons';
import { cn, GradientPill, Tooltip } from './kit';

export interface SessionHeaderProps {
  scenarioName: string;
  personaName: string;
  personaSubtitle?: string;
  difficulty: Difficulty;
  mode: SessionMode;
  status: SessionState;
  elapsedMs: number;
  remainingMs: number | null;
  overtime: boolean;
  turnCount: number;
  maxTurns?: number;
  runtime: RuntimeStatus;
  online: boolean;
  reconnectAttempt: number;
  onPauseResume: () => void;
  onRestart: () => void;
  onEnd: () => void;
  className?: string;
}

function HeaderIconButton({
  label,
  onClick,
  disabled,
  tone = 'neutral',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
  children: ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="sim-focusable sim-lift flex h-9 w-9 items-center justify-center rounded-input disabled:cursor-not-allowed disabled:opacity-45"
        style={insetSurface(tone === 'danger' ? 'danger' : 'neutral', tone === 'danger' ? 12 : 9)}
      >
        <span style={{ color: toneText(tone === 'danger' ? 'danger' : 'neutral') }}>{children}</span>
      </button>
    </Tooltip>
  );
}

export function SessionHeader({
  scenarioName,
  personaName,
  personaSubtitle,
  difficulty,
  mode,
  status,
  elapsedMs,
  remainingMs,
  overtime,
  turnCount,
  maxTurns,
  runtime,
  online,
  reconnectAttempt,
  onPauseResume,
  onRestart,
  onEnd,
  className,
}: SessionHeaderProps) {
  const statusTone = SESSION_STATE_TONE[status] ?? 'neutral';
  const badge = RUNTIME_BADGE[runtime.backend];
  const paused = status === 'paused';
  const finished = status === 'completed';
  const live = isLive(status);

  return (
    <header
      className={cn('glass-card flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4', className)}
    >
      {/* Identity ------------------------------------------------------------ */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-section text-text-primary">{scenarioName}</h1>
          <TonePill tone={DIFFICULTY_TONE[difficulty]} fill={16}>
            {DIFFICULTY_LABEL[difficulty]}
          </TonePill>
          <TonePill
            tone={mode === 'assessment' ? 'indigo' : 'mint'}
            fill={16}
            icon={mode === 'assessment' ? <ShieldIcon size={11} /> : undefined}
            title={
              mode === 'assessment'
                ? 'Assessment — coaching affordances are disabled to keep the score valid'
                : 'Training — hints and coaching are available'
            }
          >
            {mode === 'assessment' ? 'Assessment' : 'Training'}
          </TonePill>
        </div>
        <p className="mt-1 truncate text-meta text-text-secondary">
          {personaName}
          {personaSubtitle ? <span className="text-text-tertiary"> · {personaSubtitle}</span> : null}
        </p>
      </div>

      {/* Live status --------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2.5">
        {live ? (
          <GradientPill className="flex items-center gap-1.5 px-3 py-1 text-tiny">
            <span
              aria-hidden="true"
              className="sim-listening-dot inline-block h-1.5 w-1.5 rounded-pill"
              style={{ backgroundColor: 'var(--bg-canvas-soft)' }}
            />
            {SESSION_STATE_LABEL[status]}
          </GradientPill>
        ) : (
          <TonePill tone={statusTone} fill={18} icon={<LiveDot tone={statusTone} pulsing={status === 'reconnecting'} />}>
            {SESSION_STATE_LABEL[status]}
            {status === 'reconnecting' && reconnectAttempt > 0 ? ` · attempt ${reconnectAttempt}` : ''}
          </TonePill>
        )}

        <span
          className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny tabular-nums"
          style={insetSurface(overtime ? 'warning' : 'neutral', 9)}
          title={remainingMs === null ? '經過時間' : '經過時間 / 剩餘時間'}
        >
          <ClockIcon size={12} className="text-text-tertiary" />
          <span className="text-text-primary">{formatTimer(elapsedMs)}</span>
          {remainingMs !== null ? (
            <span style={{ color: toneText(overtime ? 'warning' : 'neutral') }}>
              {overtime ? `+${formatTimer(Math.abs(remainingMs))}` : `· 剩餘 ${formatTimer(remainingMs)}`}
            </span>
          ) : null}
        </span>

        <span
          className="rounded-pill px-2.5 py-1 text-tiny tabular-nums text-text-secondary"
          style={insetSurface('neutral', 9)}
          title="已交流回合數"
        >
          {maxTurns ? `${turnCount} / ${maxTurns} 回合` : `${turnCount} 回合`}
        </span>

        {/* §15 runtime badge + §94 quiet fallback notice */}
        <Tooltip
          content={
            runtime.degraded && runtime.fallbackReason
              ? `${badge.label} — ${runtime.fallbackReason}。你的練習不受影響，會繼續正常進行。`
              : `${badge.label} · ${badge.sub}`
          }
        >
          <span
            className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny"
            style={insetSurface(badge.tone, 13)}
          >
            <RadioIcon size={12} style={{ color: toneText(badge.tone) }} />
            <span style={{ color: toneText(badge.tone) }}>{badge.label}</span>
          </span>
        </Tooltip>

        {!online ? (
          <span
            className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny"
            style={insetSurface('warning', 13)}
            role="status"
          >
            <LiveDot tone="warning" pulsing />
            <span style={{ color: toneText('warning') }}>離線</span>
          </span>
        ) : null}
      </div>

      {/* Controls ------------------------------------------------------------ */}
      <div
        className="flex items-center gap-2 border-l pl-4"
        style={{ borderColor: tint('neutral', 16) }}
      >
        <HeaderIconButton
          label={paused ? '繼續練習' : '暫停練習'}
          onClick={onPauseResume}
          disabled={finished || status === 'idle' || status === 'connecting'}
        >
          {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
        </HeaderIconButton>
        <HeaderIconButton label="重新開始（會開一場新的練習）" onClick={onRestart}>
          <RestartIcon size={16} />
        </HeaderIconButton>
        <HeaderIconButton label="結束練習" onClick={onEnd} disabled={finished} tone="danger">
          <StopIcon size={16} />
        </HeaderIconButton>
      </div>
    </header>
  );
}
