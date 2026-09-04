'use client';

/**
 * Voice Simulation — spec §24 (Part II) and §22 (Part I).
 *
 *   ┌──────────────────────────────────┬──────────────────────────────┐
 *   │ Captions + Transcript            │ Persona (enlarged)           │
 *   ├──────────────────────────────────┼──────────────────────────────┤
 *   │ Live waveform + call controls    │ Live state + Coach           │
 *   └──────────────────────────────────┴──────────────────────────────┘
 *
 * Voice-first: the captions are the primary reading surface, the transcript sits
 * underneath as history, and the waveform + floating mini controls own the
 * bottom of the conversation column. Connection states are the §22.2 set:
 * Connecting / Listening / Transcribing / Thinking / Speaking / Interrupted /
 * Reconnecting.
 *
 * Barge-in: `useVoiceSession` detects the trainee's voice while the persona is
 * speaking, cancels TTS locally, and this page tells the server the floor moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, endpoints } from '@/lib/api-client';

import { useSessionBootstrap } from '../hooks/use-session-bootstrap';
import { useSessionSocket } from '../hooks/use-session-socket';
import { useSessionTimer } from '../hooks/use-session-timer';
import { useTranscriptExport } from '../hooks/use-transcript-export';
import { useVoiceSession } from '../hooks/use-voice-session';
import { hasBackend } from '../lib/env';
import { voiceStatusFromSession } from '../lib/session-transitions';
import { insetSurface, toneText } from '../lib/tone';
import { createMockEvaluation, MOCK_NEXT_TRAINING } from '../mock/mock-session';
import {
  useActiveAgent,
  useCaptionsEnabled,
  useCoachInsights,
  useComplianceFindings,
  useConnectionStatus,
  useEvaluation,
  useEvaluationId,
  useLiveScores,
  usePartials,
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
  useTurns,
  useVoiceMuted,
} from '../store/session-store';
import { AgentActivity } from './agent-activity';
import { AudioDevicePicker } from './audio-device-picker';
import { Captions, type CaptionLine } from './captions';
import { CoachCard } from './coach-card';
import { CloseIcon, RestartIcon } from './icons';
import { cn, GlassCard, Skeleton } from './kit';
import { PersonaStage } from './persona-stage';
import { PersonaStateCard } from './persona-state-card';
import { SessionCompleteSummary } from './session-complete-summary';
import { SessionHeader } from './session-header';
import { ReportIssueDialog, TranscriptDialog } from './session-dialogs';
import { SimulationStyles } from './simulation-styles';
import { buildTranscriptItems, TranscriptFeed, type SystemNotice } from './transcript-feed';
import { TrainingGrid } from './training-grid';
import { VoiceControls } from './voice-controls';
import { Waveform } from './waveform';

export interface VoiceSimulationPageProps {
  sessionId: string;
}

export function VoiceSimulationPage({ sessionId }: VoiceSimulationPageProps) {
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

  const isTraining = mode === 'training';
  const finished = status === 'completed';

  const timer = useSessionTimer(bootstrap?.scenario.timeLimitSeconds);
  const transcriptExport = useTranscriptExport();

  const [epoch, setEpoch] = useState(0);
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [pushToTalkMode, setPushToTalkMode] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  const pushNotice = useCallback((id: string, text: string) => {
    setNotices((current) =>
      current.some((n) => n.id === id) ? current : [...current, { id, atMs: Date.now(), text }],
    );
  }, []);

  const socketRef = useRef<ReturnType<typeof useSessionSocket> | null>(null);
  const voiceRef = useRef<ReturnType<typeof useVoiceSession> | null>(null);
  const speakerMutedRef = useRef(speakerMuted);
  speakerMutedRef.current = speakerMuted;

  // ---- Voice pipeline ------------------------------------------------------

  const voice = useVoiceSession({
    enabled: true,
    personaSpeaking: status === 'persona_speaking',
    pushToTalk: pushToTalkMode,
    onBargeIn: () => {
      setInterrupted(true);
      socketRef.current?.pushToTalk(true);
      window.setTimeout(() => setInterrupted(false), 1400);
    },
    onSpeechEnd: () => {
      // The floor is released; the server decides what happens next.
      socketRef.current?.pushToTalk(false);
    },
    onSilenceTimeout: () => {
      pushNotice('silence', 'Still listening — say something whenever you are ready.');
    },
  });
  voiceRef.current = voice;

  const socket = useSessionSocket({
    sessionId,
    mode,
    enabled: Boolean(bootstrap),
    epoch,
    onEvent: (event) => {
      // Auto-play the persona's synthesised audio in voice mode (§22.1).
      if (speakerMutedRef.current) return;
      if (event.type === 'agent.response.final' || event.type === 'speech.final') {
        const turn = event.turn;
        if (turn?.speaker === 'persona' && turn.audio_url) {
          void voiceRef.current?.playTts(turn.audio_url);
        }
      }
    },
    onRuntimeFallback: (to, reason) => {
      pushNotice(
        `runtime-${to}`,
        `Voice pipeline moved to ${to === 'wasm' ? 'WASM' : 'server'} mode — ${reason}. The call continues.`,
      );
    },
    onCompleted: () => {
      voiceRef.current?.cancelTts();
      voiceRef.current?.stop();
    },
  });
  socketRef.current = socket;

  const voiceStatus = voiceStatusFromSession(status, voice.micLive, interrupted);

  useEffect(() => {
    actions.setVoice({ status: voiceStatus, pushToTalkMode });
  }, [actions, pushToTalkMode, voiceStatus]);

  useEffect(() => {
    if (status === 'reconnecting') {
      pushNotice(
        `reconnect-${connection.reconnectAttempt}`,
        `Reconnecting the call (attempt ${Math.max(1, connection.reconnectAttempt)})…`,
      );
    }
  }, [connection.reconnectAttempt, pushNotice, status]);

  // ---- Evaluation ----------------------------------------------------------

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
        // Stay quiet — the summary explains itself (§94).
      } finally {
        if (!cancelled) setEvaluationLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [actions, evaluation, evaluationId, finished, sessionId]);

  // ---- Captions ------------------------------------------------------------

  const liveCaption = useMemo<CaptionLine | null>(() => {
    if (speechPartial?.text) {
      return { speaker: speechPartial.speaker, text: speechPartial.text, final: false };
    }
    const streaming = Object.values(partials).filter((text) => text.length > 0);
    const last = streaming.length > 0 ? streaming[streaming.length - 1] : undefined;
    if (last) return { speaker: 'persona', text: last, final: false };
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
    if (lastTurn && (lastTurn.speaker === 'persona' || lastTurn.speaker === 'trainee')) {
      return { speaker: lastTurn.speaker, text: lastTurn.text, final: true };
    }
    return null;
  }, [partials, speechPartial, turns]);

  const previousCaption = useMemo<CaptionLine | null>(() => {
    const spoken = turns.filter((turn) => turn.speaker === 'persona' || turn.speaker === 'trainee');
    const previous = spoken.length > 1 ? spoken[spoken.length - 2] : undefined;
    if (!previous) return null;
    if (previous.speaker !== 'persona' && previous.speaker !== 'trainee') return null;
    return { speaker: previous.speaker, text: previous.text, final: true };
  }, [turns]);

  // ---- Handlers ------------------------------------------------------------

  const handleStart = useCallback(() => {
    void voice.start();
  }, [voice]);

  const handleRestart = useCallback(() => {
    voice.cancelTts();
    actions.resetForRestart();
    setNotices([]);
    setInterrupted(false);
    setEpoch((n) => n + 1);
  }, [actions, voice]);

  const handleEnd = useCallback(() => {
    voice.cancelTts();
    voice.stop();
    socket.end();
  }, [socket, voice]);

  const handlePauseResume = useCallback(() => {
    if (status === 'paused') {
      socket.resume();
    } else {
      voice.cancelTts();
      socket.pause();
    }
  }, [socket, status, voice]);

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

  // ---- Shells --------------------------------------------------------------

  if (loading && !bootstrap) {
    return (
      <>
        <SimulationStyles />
        <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-card" />
          <TrainingGrid
            variant="voice"
            left={<Skeleton className="h-full min-h-[24rem] w-full rounded-card" />}
            right={<Skeleton className="aspect-[4/3] w-full rounded-card" />}
          />
        </div>
      </>
    );
  }

  if (!bootstrap) {
    return (
      <>
        <SimulationStyles />
        <GlassCard className="sim-card-enter m-auto max-w-lg p-6 text-center">
          <h2 className="text-section text-text-primary">This voice session could not be loaded</h2>
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
  const personaListening = voiceStatus === 'listening' || voiceStatus === 'transcribing';

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

        {voice.error ? (
          <div
            className="sim-card-enter flex items-start gap-3 rounded-card border px-4 py-3"
            style={insetSurface(voice.permission === 'denied' ? 'danger' : 'warning', 11)}
            role="status"
          >
            <div className="min-w-0 flex-1">
              <p
                className="text-body font-medium"
                style={{ color: toneText(voice.permission === 'denied' ? 'danger' : 'warning') }}
              >
                Microphone problem
              </p>
              <p className="mt-0.5 text-body-sm text-text-secondary">{voice.error}</p>
            </div>
            <button
              type="button"
              onClick={() => setDeviceOpen(true)}
              className="sim-focusable shrink-0 rounded-pill border px-3 py-1.5 text-meta text-text-secondary"
              style={insetSurface('neutral', 9)}
            >
              Audio settings
            </button>
          </div>
        ) : null}

        {sessionError ? (
          <div
            className="sim-card-enter flex items-start gap-3 rounded-card border px-4 py-3"
            style={insetSurface(sessionError.recoverable ? 'warning' : 'danger', 11)}
            role="status"
          >
            <p className="min-w-0 flex-1 text-body-sm text-text-secondary">{sessionError.message}</p>
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

        {finished ? (
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
          <TrainingGrid
            variant="voice"
            left={
              <>
                <Captions
                  enabled={captionsEnabled}
                  personaName={bootstrap.persona.name}
                  live={liveCaption}
                  previous={previousCaption}
                  captionLanguage={bootstrap.persona.language}
                />

                <GlassCard className="flex min-h-[14rem] flex-1 flex-col p-4">
                  <div className="flex items-center justify-between gap-3 px-1.5 pb-2">
                    <h2 className="text-card-title text-text-primary">Transcript</h2>
                    <AgentActivity
                      agent={activeAgent}
                      atMs={agentActivityAtMs}
                      status={status}
                      className="justify-end"
                    />
                  </div>
                  <TranscriptFeed
                    turns={turns}
                    partials={partials}
                    speechPartial={speechPartial}
                    coachInsights={coachInsights}
                    complianceFindings={complianceFindings}
                    systemNotices={notices}
                    sessionId={sessionId}
                    startedAtMs={startedAtMs}
                    personaName={bootstrap.persona.name}
                    personaAvatarUrl={bootstrap.persona.avatarUrl}
                    status={status}
                    openingContext={bootstrap.scenario.openingContext}
                  />
                </GlassCard>

                {/* Live waveform (§24) */}
                <GlassCard className="p-4">
                  <div className="flex items-center justify-between px-1 pb-2">
                    <span className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">
                      Live waveform
                    </span>
                    <span className="text-tiny tabular-nums text-text-tertiary">
                      noise floor {Math.round(voice.noiseFloor * 100)}%
                    </span>
                  </div>
                  <div className="h-16">
                    <Waveform
                      analyser={voice.analyser}
                      active={voice.micLive && !muted}
                      ariaLabel="Your microphone input level"
                    />
                  </div>
                </GlassCard>

                <VoiceControls
                  status={voiceStatus}
                  micLive={voice.micLive}
                  starting={voice.starting}
                  muted={muted}
                  speakerMuted={speakerMuted}
                  pushToTalkMode={pushToTalkMode}
                  pushToTalkHeld={voice.pushToTalkHeld}
                  captionsEnabled={captionsEnabled}
                  onStart={handleStart}
                  onToggleMute={voice.toggleMute}
                  onToggleSpeaker={() => {
                    setSpeakerMuted((value) => {
                      if (!value) voice.cancelTts();
                      return !value;
                    });
                  }}
                  onTogglePushToTalkMode={() => setPushToTalkMode((value) => !value)}
                  onPushToTalkDown={() => {
                    voice.setPushToTalkHeld(true);
                    socket.pushToTalk(true);
                  }}
                  onPushToTalkUp={() => {
                    voice.setPushToTalkHeld(false);
                    socket.pushToTalk(false);
                  }}
                  onOpenAudioDevice={() => setDeviceOpen(true)}
                  onOpenTranscript={() => setTranscriptOpen(true)}
                  onToggleCaptions={() =>
                    actions.setVoice({ captionsEnabled: !captionsEnabled })
                  }
                  onEndCall={handleEnd}
                />
              </>
            }
            right={
              <div className={cn('sim-scroll grid content-start gap-4 overflow-y-auto pb-4 pr-1')}>
                {/* §24 — the persona visual is enlarged in voice mode. */}
                <PersonaStage
                  personaName={bootstrap.persona.name}
                  subtitle={bootstrap.persona.subtitle ?? bootstrap.persona.occupation}
                  avatarUrl={bootstrap.persona.avatarUrl}
                  eyebrow="Voice simulation"
                  speaking={personaSpeaking}
                  listening={personaListening}
                  thinking={status === 'processing'}
                  waveform={
                    <Waveform
                      analyser={voice.analyser}
                      active={voice.micLive && !muted}
                      bars={28}
                      ariaLabel="Microphone level"
                    />
                  }
                />

                <PersonaStateCard
                  state={personaState}
                  updating={status === 'processing' || personaSpeaking}
                />

                <CoachCard
                  mode={mode}
                  insights={coachInsights}
                  suppressedCount={suppressedCoachCount}
                  startedAtMs={startedAtMs}
                  onAskCoach={isTraining ? () => socket.requestHint() : undefined}
                />
              </div>
            }
          />
        )}
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
        onRequestPermission={handleStart}
      />
    </>
  );
}
