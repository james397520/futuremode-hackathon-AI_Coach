'use client';

/**
 * Conversation panel — spec §16, and the §91 component tree:
 *   ConversationPanel → TranscriptHeader / TranscriptFeed / CoachInlineEvents /
 *                       QuickActions / Composer
 *
 * A single `glass-strong` surface (§3.3) so the transcript text is always
 * readable, with a thin right-hand scrollbar, a large title, a small language
 * tag and the gradient "AI Persona connected" status pill (§16).
 */
import { useMemo, useState } from 'react';
import type {
  AgentName,
  CoachInsight,
  ComplianceFinding,
  ID,
  SessionMode,
  SessionState,
  TranscriptTurn,
} from '@ai-coach/shared';

import { COACH_KIND_LABEL, COACH_KIND_TONE } from '../lib/labels';
import { isLive } from '../lib/session-transitions';
import { insetSurface, tint, toneText } from '../lib/tone';
import { AgentActivity } from './agent-activity';
import { LiveDot, TonePill } from './atoms';
import { Composer } from './composer';
import { ComplianceAlert } from './compliance-alert';
import { AlertIcon, CloseIcon, LightbulbIcon, SparkleIcon } from './icons';
import { cn, GradientPill } from './kit';
import { QuickActions, type TrainingActionHandlers } from './quick-actions';
import { TranscriptFeed, type SystemNotice } from './transcript-feed';

export interface ConversationPanelProps {
  sessionId: ID;
  mode: SessionMode;
  status: SessionState;

  turns: TranscriptTurn[];
  partials: Record<ID, string>;
  speechPartial: { speaker: 'trainee' | 'persona'; text: string } | null;
  coachInsights: CoachInsight[];
  complianceFindings: ComplianceFinding[];
  systemNotices: SystemNotice[];

  startedAtMs: number | null;
  personaName: string;
  personaAvatarUrl?: string;
  traineeName?: string;
  openingContext?: string;
  language?: string;

  activeAgent: AgentName | null;
  agentActivityAtMs: number;

  turnCount: number;
  maxTurns?: number;

  voiceEnabled: boolean;
  micLive: boolean;
  muted: boolean;
  vadActive: boolean;
  captionsEnabled: boolean;

  onSend: (text: string) => void;
  onPushToTalk: (pressed: boolean) => void;
  onToggleMic: () => void;
  /** Training Mode only — omitted entirely for assessments (§8.4). */
  onRequestHint?: () => void;
  training?: TrainingActionHandlers;

  onPauseResume: () => void;
  onRestart: () => void;
  onEnd: () => void;
  onToggleCaptions: () => void;
  onOpenTranscript: () => void;
  onReportIssue: () => void;
  onOpenAudioDevice: () => void;

  className?: string;
}

// ---------------------------------------------------------------------------
// §16 header
// ---------------------------------------------------------------------------

function TranscriptHeader({
  status,
  personaName,
  language,
}: {
  status: SessionState;
  personaName: string;
  language?: string;
}) {
  const live = isLive(status);
  return (
    <div className="flex flex-wrap items-center gap-3 px-1.5 pb-3">
      <h2 className="text-section text-text-primary">對談</h2>
      {live ? (
        <span className="text-tiny uppercase tracking-[0.14em]" style={{ color: toneText('mint') }}>
          進行中
        </span>
      ) : null}

      <GradientPill className="ml-auto flex items-center gap-1.5 px-3 py-1 text-tiny">
        <SparkleIcon size={11} />
        {live ? `AI 客戶已連線 · ${personaName}` : 'AI 客戶待命中'}
      </GradientPill>

      {language ? (
        <span
          className="rounded-pill px-2 py-0.5 text-tiny text-text-tertiary"
          style={insetSurface('neutral', 8)}
        >
          {language}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §91 CoachInlineEvents — the newest actionable signal, pinned above the input
// so it stays visible even when the transcript is scrolled up.
// ---------------------------------------------------------------------------

function CoachInlineEvents({
  mode,
  coachInsights,
  complianceFindings,
  startedAtMs,
}: {
  mode: SessionMode;
  coachInsights: CoachInsight[];
  complianceFindings: ComplianceFinding[];
  startedAtMs: number | null;
}) {
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});

  const insight = useMemo(() => {
    if (mode === 'assessment') return null;
    for (let i = coachInsights.length - 1; i >= 0; i -= 1) {
      const candidate = coachInsights[i];
      if (candidate && !dismissed[`insight-${candidate.id}`]) return candidate;
    }
    return null;
  }, [coachInsights, dismissed, mode]);

  const finding = useMemo(() => {
    for (let i = complianceFindings.length - 1; i >= 0; i -= 1) {
      const candidate = complianceFindings[i];
      if (
        candidate &&
        candidate.reviewer_status === 'open' &&
        !dismissed[`finding-${candidate.id}`] &&
        (candidate.severity === 'high' || candidate.severity === 'critical')
      ) {
        return candidate;
      }
    }
    return null;
  }, [complianceFindings, dismissed]);

  if (!insight && !finding) return null;

  return (
    <div className="grid gap-2 px-1.5 pb-2.5">
      {finding ? (
        <div className="relative">
          <ComplianceAlert finding={finding} startedAtMs={startedAtMs} compact />
          <button
            type="button"
            onClick={() => setDismissed((d) => ({ ...d, [`finding-${finding.id}`]: true }))}
            aria-label="Dismiss compliance notice"
            className="sim-focusable absolute right-3 top-3 text-text-tertiary hover:text-text-secondary"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      {insight ? (
        <div
          className="sim-card-enter flex items-start gap-2.5 rounded-card border p-3.5"
          style={insetSurface(COACH_KIND_TONE[insight.kind] ?? 'violet', 11)}
        >
          <span style={{ color: toneText(COACH_KIND_TONE[insight.kind] ?? 'violet') }}>
            {insight.kind === 'missed_signal' ? <AlertIcon size={15} /> : <LightbulbIcon size={15} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-body font-semibold"
                style={{ color: toneText(COACH_KIND_TONE[insight.kind] ?? 'violet') }}
              >
                {insight.title}
              </span>
              <TonePill tone={COACH_KIND_TONE[insight.kind] ?? 'violet'} fill={14}>
                {COACH_KIND_LABEL[insight.kind] ?? 'Coach'}
              </TonePill>
            </div>
            <p className="mt-1 text-body-sm text-text-secondary">{insight.body}</p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed((d) => ({ ...d, [`insight-${insight.id}`]: true }))}
            aria-label="Dismiss coach note"
            className="sim-focusable shrink-0 text-text-tertiary hover:text-text-secondary"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ConversationPanel(props: ConversationPanelProps) {
  const {
    sessionId,
    mode,
    status,
    turns,
    partials,
    speechPartial,
    coachInsights,
    complianceFindings,
    systemNotices,
    startedAtMs,
    personaName,
    personaAvatarUrl,
    traineeName,
    openingContext,
    language,
    activeAgent,
    agentActivityAtMs,
    turnCount,
    maxTurns,
    voiceEnabled,
    micLive,
    muted,
    vadActive,
    captionsEnabled,
    onSend,
    onPushToTalk,
    onToggleMic,
    onRequestHint,
    training,
    onPauseResume,
    onRestart,
    onEnd,
    onToggleCaptions,
    onOpenTranscript,
    onReportIssue,
    onOpenAudioDevice,
    className,
  } = props;

  return (
    <section
      className={cn('glass-strong flex min-h-0 flex-col p-4 shadow-soft', className)}
      aria-label="Conversation"
    >
      <TranscriptHeader status={status} personaName={personaName} language={language} />

      <TranscriptFeed
        turns={turns}
        partials={partials}
        speechPartial={speechPartial}
        coachInsights={coachInsights}
        complianceFindings={complianceFindings}
        systemNotices={systemNotices}
        sessionId={sessionId}
        startedAtMs={startedAtMs}
        personaName={personaName}
        personaAvatarUrl={personaAvatarUrl}
        traineeName={traineeName}
        status={status}
        openingContext={openingContext}
      />

      <div className="mt-3 border-t pt-3" style={{ borderColor: tint('neutral', 14) }}>
        <CoachInlineEvents
          mode={mode}
          coachInsights={coachInsights}
          complianceFindings={complianceFindings}
          startedAtMs={startedAtMs}
        />

        <div className="flex items-center justify-between gap-3 px-1.5 pb-2">
          <AgentActivity agent={activeAgent} atMs={agentActivityAtMs} status={status} />
          {status === 'listening' ? (
            <span className="flex items-center gap-1.5 text-tiny text-text-tertiary">
              <LiveDot tone="cyan" pulsing />
              Your turn
            </span>
          ) : null}
        </div>

        <QuickActions
          className="px-1.5 pb-3"
          mode={mode}
          status={status}
          training={training}
          onPauseResume={onPauseResume}
          onRestart={onRestart}
          onEnd={onEnd}
          captionsEnabled={captionsEnabled}
          onToggleCaptions={onToggleCaptions}
          onOpenTranscript={onOpenTranscript}
          onReportIssue={onReportIssue}
          onOpenAudioDevice={onOpenAudioDevice}
        />

        <Composer
          status={status}
          onSend={onSend}
          onPushToTalk={onPushToTalk}
          onRequestHint={onRequestHint}
          voiceEnabled={voiceEnabled}
          micLive={micLive}
          muted={muted}
          onToggleMic={onToggleMic}
          vadActive={vadActive}
          turnCount={turnCount}
          maxTurns={maxTurns}
        />
      </div>
    </section>
  );
}
