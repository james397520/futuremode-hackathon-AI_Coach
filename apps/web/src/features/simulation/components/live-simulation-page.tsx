'use client';

/**
 * Live Simulation — the most important page of the product.
 * Spec §14 (layout decision), §15–§19, §20–§23, §29, §91, §92, §99, §100.
 *
 *   ┌──────────────────────────────────────┬───────────────────────────┐
 *   │ LEFT: Conversation / Training        │ RIGHT: AI Persona          │
 *   │ transcript / coach / composer        │ + Objective / Live State   │
 *   │                                      │ + Coach / Timeline         │
 *   └──────────────────────────────────────┴───────────────────────────┘
 *
 * Responsibilities kept here and nowhere else:
 *   - session bootstrap and the Training / Assessment gating decision,
 *   - socket + voice wiring (including barge-in),
 *   - the completion hand-off to the §29 summary,
 *   - keeping the page alive through runtime fallback, socket loss and unknown
 *     events (§62 / §94).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Citation } from '@ai-coach/shared-types';

import { api, endpoints } from '@/lib/api-client';

import { useSessionBootstrap } from '../hooks/use-session-bootstrap';
import { useSessionSocket } from '../hooks/use-session-socket';
import { useSessionTimer } from '../hooks/use-session-timer';
import { useTranscriptExport } from '../hooks/use-transcript-export';
import { useVoiceSession } from '../hooks/use-voice-session';
import { hasBackend } from '../lib/env';
import { insetSurface, toneText } from '../lib/tone';
import { createMockEvaluation, MOCK_NEXT_TRAINING } from '../mock/mock-session';
import {
  useActiveAgent,
  useCoachInsights,
  useComplianceFindings,
  useConnectionStatus,
  useEvaluation,
  useEvaluationId,
  useLiveScores,
  usePartials,
  usePersonaHistory,
  usePersonaState,
  useRuntimeStatus,
  useSessionActions,
  useSessionError,
  useSessionMode,
  useSessionStatus,
  useSessionStore,
  useSpeechPartial,
  useStartedAtMs,
  useSuppressedCoachCount,
  useTimeline,
  useTurns,
  useVoiceMuted,
  useCaptionsEnabled,
} from '../store/session-store';
import { AudioDevicePicker } from './audio-device-picker';
import { ConversationPanel } from './conversation-panel';
import { CloseIcon, RestartIcon } from './icons';
import { cn, GlassCard, Skeleton } from './kit';
import { PersonaColumn } from './persona-column';
import {
  KnowledgeReferenceDialog,
  ReportIssueDialog,
  TranscriptDialog,
} from './session-dialogs';
import { SessionCompleteSummary } from './session-complete-summary';
import { SessionHeader } from './session-header';
import { SimulationStyles } from './simulation-styles';
import { buildTranscriptItems, type SystemNotice } from './transcript-feed';
import { TrainingGrid } from './training-grid';

export interface LiveSimulationPageProps {
  sessionId: string;
}

export function LiveSimulationPage({ sessionId }: LiveSimulationPageProps) {
  const actions = useSessionActions();
  const { bootstrap, loading, error: bootstrapError, retry } = useSessionBootstrap(sessionId);

  const status = useSessionStatus();
  const mode = useSessionMode();
  const turns = useTurns();
  const partials = usePartials();
  const speechPartial = useSpeechPartial();
  const coachInsights = useCoachInsights();
  const suppressedCoachCount = useSuppressedCoachCount();
  const complianceFindings = useComplianceFindings();
  const personaState = usePersonaState();
  const personaHistory = usePersonaHistory();
  const timeline = useTimeline();
  const liveScores = useLiveScores();
  const activeAgent = useActiveAgent();
  const agentActivityAtMs = useSessionStore((s) => s.agentActivityAtMs);
  const runtime = useRuntimeStatus();
  const connection = useConnectionStatus();
  const sessionError = useSessionError();
  const startedAtMs = useStartedAtMs();
  const evaluation = useEvaluation();
  const evaluationId = useEvaluationId();
  const muted = useVoiceMuted();
  const captionsEnabled = useCaptionsEnabled();
  const citationsByTurn = useSessionStore((s) => s.citationsByTurn);

  const isTraining = mode === 'training';
  const finished = status === 'completed';

  const timer = useSessionTimer(bootstrap?.scenario.timeLimitSeconds);
  const transcriptExport = useTranscriptExport();

  const [epoch, setEpoch] = useState(0);
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [micWanted, setMicWanted] = useState(false);
  const [pushToTalkMode, setPushToTalkMode] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  const pushNotice = useCallback((id: string, text: string) => {
    setNotices((current) =>
      current.some((n) => n.id === id) ? current : [...current, { id, atMs: Date.now(), text }],
    );
  }, []);

  // ---- Voice + socket, cross-wired through refs to avoid a hook cycle ------

  const socketRef = useRef<ReturnType<typeof useSessionSocket> | null>(null);
  const voiceRef = useRef<ReturnType<typeof useVoiceSession> | null>(null);

  const voice = useVoiceSession({
    enabled: Boolean(bootstrap?.voiceEnabled) && micWanted,
    personaSpeaking: status === 'persona_speaking',
    pushToTalk: pushToTalkMode,
    onBargeIn: () => {
      // §22.3 — the trainee took the floor: TTS is already cancelled inside the
      // hook; tell the server the floor changed hands.
      socketRef.current?.pushToTalk(true);
      pushNotice(`barge-${Date.now()}`, 'You interrupted the customer — the simulation is listening.');
    },
    onSilenceTimeout: () => {
      pushNotice('silence', 'It has been quiet for a while. Type or talk whenever you are ready.');
    },
  });
  voiceRef.current = voice;

  const socket = useSessionSocket({
    sessionId,
    mode,
    enabled: Boolean(bootstrap),
    epoch,
    onRuntimeFallback: (to, reason) => {
      pushNotice(
        `runtime-${to}`,
        `Local acceleration changed to ${to === 'wasm' ? 'WASM' : 'server'} mode — ${reason}. Your session continues normally.`,
      );
    },
    onCompleted: () => {
      voiceRef.current?.cancelTts();
      voiceRef.current?.stop();
    },
  });
  socketRef.current = socket;

  // Reconnection notice (§62) — informational, never a modal.
  useEffect(() => {
    if (status === 'reconnecting') {
      pushNotice(
        `reconnect-${connection.reconnectAttempt}`,
        `Connection dropped — reconnecting (attempt ${Math.max(1, connection.reconnectAttempt)}).`,
      );
    }
  }, [connection.reconnectAttempt, pushNotice, status]);

  // ---- Evaluation on completion (§29) -------------------------------------

  useEffect(() => {
    if (!finished || evaluation) return;
    let cancelled = false;

    if (!hasBackend) {
      setEvaluationLoading(true);
      const id = window.setTimeout(() => {
        if (!cancelled) {
          actions.setEvaluation(createMockEvaluation(sessionId));
          setEvaluationLoading(false);
        }
      }, 1200);
      return () => {
        cancelled = true;
        window.clearTimeout(id);
      };
    }

    if (!evaluationId) return;
    setEvaluationLoading(true);
    void (async () => {
      try {
        const data = await endpoints.getReport(evaluationId);
        if (!cancelled && data) actions.setEvaluation(data);
      } catch {
        // The summary shows a calm "will appear shortly" state instead (§94).
      } finally {
        if (!cancelled) setEvaluationLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, evaluation, evaluationId, finished, sessionId]);

  // ---- Handlers ------------------------------------------------------------

  const handleToggleMic = useCallback(() => {
    if (!voice.micLive) {
      setMicWanted(true);
      void voice.start();
      return;
    }
    voice.toggleMute();
  }, [voice]);

  const handlePushToTalk = useCallback(
    (pressed: boolean) => {
      if (pressed) {
        // Holding the key switches the mic gate to push-to-talk semantics.
        setPushToTalkMode(true);
        if (!voice.micLive) {
          setMicWanted(true);
          void voice.start();
        }
      }
      voice.setPushToTalkHeld(pressed);
      socket.pushToTalk(pressed);
    },
    [socket, voice],
  );

  const handlePauseResume = useCallback(() => {
    if (status === 'paused') socket.resume();
    else socket.pause();
  }, [socket, status]);

  const handleRestart = useCallback(() => {
    voice.cancelTts();
    actions.resetForRestart();
    setNotices([]);
    setEpoch((n) => n + 1);
  }, [actions, voice]);

  const handleEnd = useCallback(() => {
    voice.cancelTts();
    socket.end();
  }, [socket, voice]);

  const allCitations = useMemo<Citation[]>(() => {
    const seen = new Set<string>();
    const out: Citation[] = [];
    for (const list of Object.values(citationsByTurn)) {
      for (const citation of list) {
        const key = `${citation.chunk_id}-${citation.document_version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(citation);
      }
    }
    return out.reverse();
  }, [citationsByTurn]);

  const transcriptItems = useMemo(
    () =>
      buildTranscriptItems({
        sessionId,
        turns,
        partials,
        speechPartial,
        coachInsights,
        complianceFindings,
        systemNotices: notices,
      }),
    [coachInsights, complianceFindings, notices, partials, sessionId, speechPartial, turns],
  );

  // Training-only handlers. In an assessment these are never constructed, so the
  // affordances cannot be reached from the component tree at all (§8.4).
  const trainingHandlers = useMemo(
    () =>
      isTraining
        ? {
            onHint: () => socket.requestHint(),
            onSuggestedStrategy: () => {
              socket.sendIntentHint('request_suggested_strategy', 1);
              socket.requestHint();
            },
            onAskCoach: () => {
              socket.sendIntentHint('ask_coach', 1);
              socket.requestHint();
            },
            onViewKnowledge: () => setKnowledgeOpen(true),
          }
        : undefined,
    [isTraining, socket],
  );

  // ---- Loading / error shells ---------------------------------------------

  if (loading && !bootstrap) {
    return (
      <>
        <SimulationStyles />
        <LiveSimulationSkeleton />
      </>
    );
  }

  if (!bootstrap) {
    return (
      <>
        <SimulationStyles />
        <GlassCard className="sim-card-enter m-auto max-w-lg p-6 text-center">
          <h2 className="text-section text-text-primary">This session could not be loaded</h2>
          <p className="mt-2 text-body text-text-secondary">
            {bootstrapError ?? 'The session may have ended or you may not have access to it.'}
          </p>
          <button
            type="button"
            onClick={retry}
            className="sim-focusable sim-lift mx-auto mt-5 flex items-center gap-2 rounded-input px-4 py-2.5 text-body font-medium"
            style={{
              background: 'linear-gradient(120deg, var(--accent-indigo), var(--accent-blue))',
              color: 'var(--bg-canvas-soft)',
            }}
          >
            <RestartIcon size={16} />
            Try again
          </button>
        </GlassCard>
      </>
    );
  }

  const personaSpeaking = status === 'persona_speaking';
  const personaListening = status === 'listening' || status === 'transcribing';
  const personaThinking = status === 'processing';

  return (
    <>
      <SimulationStyles />

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <SessionHeader
          scenarioName={bootstrap.scenario.name}
          personaName={bootstrap.persona.name}
          personaSubtitle={bootstrap.persona.subtitle ?? bootstrap.persona.occupation}
          difficulty={bootstrap.scenario.difficulty}
          mode={mode}
          status={status}
          elapsedMs={timer.elapsedMs}
          remainingMs={timer.remainingMs}
          overtime={timer.overtime}
          turnCount={turns.length}
          maxTurns={bootstrap.scenario.maxTurns}
          runtime={runtime}
          online={connection.online}
          reconnectAttempt={connection.reconnectAttempt}
          onPauseResume={handlePauseResume}
          onRestart={handleRestart}
          onEnd={handleEnd}
        />

        {sessionError ? (
          <div
            className="sim-card-enter flex items-start gap-3 rounded-card border px-4 py-3"
            style={insetSurface(sessionError.recoverable ? 'warning' : 'danger', 11)}
            role="status"
          >
            <div className="min-w-0 flex-1">
              <p
                className="text-body font-medium"
                style={{ color: toneText(sessionError.recoverable ? 'warning' : 'danger') }}
              >
                {sessionError.recoverable ? 'The session hit a hiccup' : 'The session stopped'}
              </p>
              <p className="mt-0.5 text-body-sm text-text-secondary">{sessionError.message}</p>
            </div>
            <button
              type="button"
              onClick={actions.dismissError}
              aria-label="Dismiss"
              className="sim-focusable shrink-0 text-text-tertiary hover:text-text-secondary"
            >
              <CloseIcon size={15} />
            </button>
          </div>
        ) : null}

        <TrainingGrid
          left={
            finished ? (
              <SessionCompleteSummary
                evaluation={evaluation}
                loading={evaluationLoading}
                scenarioName={bootstrap.scenario.name}
                personaName={bootstrap.persona.name}
                liveScores={liveScores}
                minimumScore={bootstrap.scenario.minimumScore}
                recommendedNextTraining={hasBackend ? undefined : MOCK_NEXT_TRAINING}
                onFullReport={() => setTranscriptOpen(true)}
                onReplay={() => setTranscriptOpen(true)}
                onRetry={handleRestart}
                onCompare={() => setTranscriptOpen(true)}
                onShare={() => void transcriptExport.copy()}
                onExportPdf={() => transcriptExport.download('md')}
              />
            ) : (
              <ConversationPanel
                className="min-h-[26rem] flex-1"
                sessionId={sessionId}
                mode={mode}
                status={status}
                turns={turns}
                partials={partials}
                speechPartial={speechPartial}
                coachInsights={coachInsights}
                complianceFindings={complianceFindings}
                systemNotices={notices}
                startedAtMs={startedAtMs}
                personaName={bootstrap.persona.name}
                personaAvatarUrl={bootstrap.persona.avatarUrl}
                openingContext={bootstrap.scenario.openingContext}
                language={bootstrap.persona.language}
                activeAgent={activeAgent}
                agentActivityAtMs={agentActivityAtMs}
                turnCount={turns.length}
                maxTurns={bootstrap.scenario.maxTurns}
                voiceEnabled={bootstrap.voiceEnabled}
                micLive={voice.micLive}
                muted={muted}
                vadActive={voice.vadActive}
                captionsEnabled={captionsEnabled}
                onSend={socket.sendMessage}
                onPushToTalk={handlePushToTalk}
                onToggleMic={handleToggleMic}
                onRequestHint={isTraining ? () => socket.requestHint() : undefined}
                training={trainingHandlers}
                onPauseResume={handlePauseResume}
                onRestart={handleRestart}
                onEnd={handleEnd}
                onToggleCaptions={() =>
                  actions.setVoice({ captionsEnabled: !captionsEnabled })
                }
                onOpenTranscript={() => setTranscriptOpen(true)}
                onReportIssue={() => setReportOpen(true)}
                onOpenAudioDevice={() => setDeviceOpen(true)}
              />
            )
          }
          right={
            <PersonaColumn
              className="max-h-full"
              mode={mode}
              scenarioName={bootstrap.scenario.name}
              category={bootstrap.scenario.category}
              industry={bootstrap.scenario.industry}
              trainingType={bootstrap.scenario.trainingType}
              difficulty={bootstrap.scenario.difficulty}
              learningObjectives={bootstrap.scenario.learningObjectives}
              restrictedTopics={bootstrap.scenario.restrictedTopics}
              personaName={bootstrap.persona.name}
              personaSubtitle={bootstrap.persona.subtitle ?? bootstrap.persona.occupation}
              personaAvatarUrl={bootstrap.persona.avatarUrl}
              speaking={personaSpeaking}
              listening={personaListening}
              thinking={personaThinking}
              requiredTalkingPoints={bootstrap.scenario.requiredTalkingPoints}
              keyObjections={bootstrap.scenario.keyObjections}
              successCondition={bootstrap.scenario.successCondition}
              timeLimitSeconds={bootstrap.scenario.timeLimitSeconds}
              remainingMs={timer.remainingMs}
              overtime={timer.overtime}
              scenarioPhase={personaState?.scenario_phase}
              turns={turns}
              personaState={personaState}
              personaStateUpdating={personaThinking || personaSpeaking}
              personaHistory={personaHistory}
              timelineMarkers={timeline}
              startedAtMs={startedAtMs}
              elapsedMs={timer.elapsedMs}
              coachInsights={coachInsights}
              suppressedCoachCount={suppressedCoachCount}
              onAskCoach={isTraining ? () => socket.requestHint() : undefined}
            />
          }
        />
      </div>

      {/* Dialogs -------------------------------------------------------------- */}
      <TranscriptDialog
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        items={transcriptItems}
        startedAtMs={startedAtMs}
        personaName={bootstrap.persona.name}
        onCopy={() => void transcriptExport.copy()}
        onDownload={() => transcriptExport.download('md')}
      />

      <ReportIssueDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={(report) => {
          // Reports are best-effort telemetry; a failure must not break training.
          if (hasBackend) {
            // Best-effort telemetry: there is no typed helper for this yet, and a
            // failure must never interrupt training.
            void api
              .post(`/api/sessions/${sessionId}/issues`, {
                body: { category: report.category, detail: report.detail, at_ms: Date.now() },
              })
              .catch(() => undefined);
          }
          pushNotice(`issue-${Date.now()}`, 'Thanks — your report was attached to this session.');
        }}
      />

      <AudioDevicePicker
        open={deviceOpen}
        onClose={() => setDeviceOpen(false)}
        devices={voice.devices}
        inputDeviceId={voice.inputDeviceId}
        outputDeviceId={voice.outputDeviceId}
        permission={voice.permission}
        micLive={voice.micLive}
        onSelectInput={(id) => void voice.selectInputDevice(id)}
        onSelectOutput={(id) => void voice.selectOutputDevice(id)}
        onRefresh={() => void voice.refreshDevices()}
        onRequestPermission={() => {
          setMicWanted(true);
          void voice.start();
        }}
      />

      {/* Knowledge peek is a Training-only affordance (§8.4). */}
      {isTraining ? (
        <KnowledgeReferenceDialog
          open={knowledgeOpen}
          onClose={() => setKnowledgeOpen(false)}
          citations={allCitations}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function LiveSimulationSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="glass-card flex items-center gap-4 px-5 py-4">
        <Skeleton className="h-6 w-52 rounded-card-sm" />
        <Skeleton className="h-5 w-20 rounded-pill" />
        <Skeleton className="ml-auto h-5 w-28 rounded-pill" />
      </div>
      <TrainingGrid
        left={
          <div className={cn('glass-strong flex min-h-[26rem] flex-1 flex-col gap-4 p-5')}>
            <Skeleton className="h-6 w-40 rounded-card-sm" />
            <Skeleton className="h-16 w-full rounded-card" />
            <Skeleton className="h-16 w-4/5 rounded-card" />
            <Skeleton className="h-16 w-3/4 rounded-card" />
            <div className="mt-auto">
              <Skeleton className="h-14 w-full rounded-card" />
            </div>
          </div>
        }
        right={
          <div className="grid gap-4">
            <Skeleton className="h-32 w-full rounded-card" />
            <Skeleton className="aspect-[4/3] w-full rounded-card" />
            <Skeleton className="h-44 w-full rounded-card" />
          </div>
        }
      />
    </div>
  );
}
