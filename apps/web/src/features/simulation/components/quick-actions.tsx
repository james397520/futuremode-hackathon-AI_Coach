'use client';

/**
 * Quick actions — spec §19 (pastel pills, no big button cluster), §24 (controls),
 * §8.4 (Training vs Assessment separation).
 *
 * The four coaching affordances — Hint, Suggested Strategy, Ask Coach, View
 * Knowledge Reference — are **not rendered at all** in Assessment Mode. They are
 * not hidden with CSS and not merely disabled: the elements never enter the
 * tree, and the corresponding handlers are not passed down, so there is nothing
 * to re-enable from devtools. `useSessionSocket.requestHint()` refuses to emit
 * the command in an assessment as a second line of defence.
 */
import type { ReactNode } from 'react';
import type { SessionMode, SessionState } from '@ai-coach/shared';

import { insetSurface, toneText, type ToneKey } from '../lib/tone';
import {
  BookIcon,
  CaptionsIcon,
  FlagIcon,
  HeadphonesIcon,
  LightbulbIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  ShieldIcon,
  SparkleIcon,
  StopIcon,
  TranscriptIcon,
  UserIcon,
} from './icons';
import { cn } from './kit';

export interface TrainingActionHandlers {
  onHint: () => void;
  onSuggestedStrategy: () => void;
  onAskCoach: () => void;
  onViewKnowledge: () => void;
}

export interface QuickActionsProps {
  mode: SessionMode;
  status: SessionState;
  /** Provided only for training sessions. */
  training?: TrainingActionHandlers;
  onPauseResume: () => void;
  onRestart: () => void;
  onEnd: () => void;
  captionsEnabled: boolean;
  onToggleCaptions: () => void;
  onOpenTranscript: () => void;
  onReportIssue: () => void;
  onOpenAudioDevice: () => void;
  className?: string;
}

interface PillButtonProps {
  tone: ToneKey;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  fill?: number;
}

function PillButton({ tone, icon, label, onClick, disabled, pressed, fill = 15 }: PillButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={cn(
        'sim-focusable sim-lift inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-meta',
        'disabled:cursor-not-allowed disabled:opacity-45',
      )}
      style={insetSurface(tone, pressed ? fill + 8 : fill)}
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center" style={{ color: toneText(tone) }}>
        {icon}
      </span>
      <span style={{ color: toneText(tone) }}>{label}</span>
    </button>
  );
}

export function QuickActions({
  mode,
  status,
  training,
  onPauseResume,
  onRestart,
  onEnd,
  captionsEnabled,
  onToggleCaptions,
  onOpenTranscript,
  onReportIssue,
  onOpenAudioDevice,
  className,
}: QuickActionsProps) {
  const isAssessment = mode === 'assessment';
  const paused = status === 'paused';
  const finished = status === 'completed';
  const busy = status === 'idle' || status === 'connecting';

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {/* ── Training-only coaching affordances (§8.4) ───────────────────────── */}
      {!isAssessment && training ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="教練工具">
          <PillButton
            tone="violet"
            icon={<LightbulbIcon size={13} />}
            label="提示"
            onClick={training.onHint}
            disabled={busy || finished}
          />
          <PillButton
            tone="indigo"
            icon={<SparkleIcon size={13} />}
            label="建議策略"
            onClick={training.onSuggestedStrategy}
            disabled={busy || finished}
          />
          <PillButton
            tone="blue"
            icon={<UserIcon size={13} />}
            label="詢問教練"
            onClick={training.onAskCoach}
            disabled={busy || finished}
          />
          <PillButton
            tone="mint"
            icon={<BookIcon size={13} />}
            label="知識庫參考"
            onClick={training.onViewKnowledge}
            disabled={busy || finished}
          />
        </div>
      ) : null}

      {isAssessment ? (
        <p className="flex items-center gap-1.5 text-tiny text-text-tertiary">
          <ShieldIcon size={13} />
          評測模式 — 本次練習無法使用提示、即時教練與知識庫查詢。
        </p>
      ) : null}

      {/* ── Always available (§24) ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2" aria-label="練習控制">
        <PillButton
          tone="neutral"
          fill={10}
          icon={paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
          label={paused ? '繼續' : '暫停'}
          onClick={onPauseResume}
          disabled={busy || finished}
        />
        <PillButton
          tone="neutral"
          fill={10}
          icon={<RestartIcon size={13} />}
          label="重新開始"
          onClick={onRestart}
          disabled={busy}
        />
        <PillButton
          tone="neutral"
          fill={10}
          icon={<CaptionsIcon size={13} />}
          label="字幕"
          onClick={onToggleCaptions}
          pressed={captionsEnabled}
        />
        <PillButton
          tone="neutral"
          fill={10}
          icon={<TranscriptIcon size={13} />}
          label="逐字稿"
          onClick={onOpenTranscript}
        />
        <PillButton
          tone="neutral"
          fill={10}
          icon={<HeadphonesIcon size={13} />}
          label="音訊裝置"
          onClick={onOpenAudioDevice}
        />
        <PillButton
          tone="neutral"
          fill={10}
          icon={<FlagIcon size={13} />}
          label="回報問題"
          onClick={onReportIssue}
        />
        <PillButton
          tone="danger"
          fill={12}
          icon={<StopIcon size={13} />}
          label="結束練習"
          onClick={onEnd}
          disabled={finished}
        />
      </div>
    </div>
  );
}
