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
import { useRouter } from 'next/navigation';
import type { Citation } from '@ai-coach/shared';

import { useQuery } from '@tanstack/react-query';

import { api, endpoints } from '@/lib/api-client';

import { useSessionBootstrap } from '../hooks/use-session-bootstrap';
import { useCameraSession } from '../hooks/use-camera-session';
import { setAffectAnalyzer } from '../lib/affect';
import { createMediaPipeAffectAnalyzer } from '../lib/mediapipe-affect';
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
  useTraineeAffect,
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
import { SpeechEngineToggle } from './speech-engine-toggle';
import { VoiceTuningPanel } from './voice-tuning-panel';
import { ConversationPanel } from './conversation-panel';
import { SelfView } from './self-view';
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

/** How long the opening line waits for the 3D body before playing anyway. */
const PERSONA_VISIBLE_TIMEOUT_MS = 6000;

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
  const traineeAffect = useTraineeAffect();
  const speechEngine = useSessionStore((st) => st.voice.speechEngine);
  // Probed once per page: whether this deployment can transcribe on-device.
  const { data: sttCapability = null } = useQuery({
    queryKey: ['stt', 'capabilities'],
    queryFn: () => endpoints.sttCapabilities(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
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

  /** Rises on every trainee interruption; the avatar stage interrupts on change. */
  const [bargeInAtMs, setBargeInAtMs] = useState(0);

  const socketRef = useRef<ReturnType<typeof useSessionSocket> | null>(null);
  const voiceRef = useRef<ReturnType<typeof useVoiceSession> | null>(null);

  const sttEngine = useSessionStore((st) => st.voice.sttEngine);
  const sttEngineRef = useRef(sttEngine);
  sttEngineRef.current = sttEngine;

  const router = useRouter();
  const voice = useVoiceSession({
    enabled: Boolean(bootstrap?.voiceEnabled) && micWanted,
    sessionId,
    personaGender: bootstrap?.persona.gender ?? null,
    personaAge: bootstrap?.persona.age ?? null,
    locale: bootstrap?.persona.language ?? 'zh-TW',
    personaSpeaking: status === 'persona_speaking',
    pushToTalk: pushToTalkMode,
    onBargeIn: () => {
      // §22.3 — the trainee took the floor: TTS is already cancelled inside the
      // hook; tell the server the floor changed hands.
      socketRef.current?.pushToTalk(true);
      // §44 — the avatar must stop mid-word too: cancel TTS, flush stale frames,
      // close the mouth. The persona stage watches this timestamp.
      setBargeInAtMs(Date.now());
      pushNotice(`barge-${Date.now()}`, '你打斷了客戶——模擬人物正在聆聽。');
    },
    onUtterance: (blob, mime) => {
      // Server-side STT (§71): the vendor key never reaches the browser. The
      // text comes back and is sent as an ordinary turn so the transcript,
      // the optimistic echo and every downstream agent see exactly what a
      // typed message would have produced.
      const started = Date.now();
      actions.setVoice({ sttStatus: { phase: 'transcribing', at: started } });
      void endpoints
        .transcribeUtterance(sessionId, blob, mime, sttEngineRef.current)
        .then((result) => {
          const text = result.text.trim();
          const ms = Date.now() - started;
          if (text) {
            socketRef.current?.sendMessage(text);
            actions.setVoice({ sttStatus: { phase: 'done', provider: result.provider, ms, at: Date.now() } });
          } else {
            actions.setVoice({ sttStatus: { phase: 'empty', provider: result.provider, ms, at: Date.now() } });
          }
        })
        .catch((err: unknown) => {
          // The status code is the diagnosis: 401 = session expired, 429 = too
          // many utterances, 5xx = the recogniser. Hide it and every one of
          // those looks like "the mic does nothing".
          const detail =
            err && typeof err === 'object' && 'status' in err
              ? `HTTP ${(err as { status: unknown }).status}`
              : err instanceof Error
                ? err.message
                : '未知錯誤';
          actions.setVoice({ sttStatus: { phase: 'error', detail, at: Date.now() } });
        });
    },
    onSilenceTimeout: () => {
      pushNotice('silence', '已經安靜一段時間了，準備好時直接輸入或開口即可。');
    },
  });
  voiceRef.current = voice;

  // One line, one utterance, and not before the persona is on screen — see the
  // same block in `voice-simulation-page.tsx`. A persona turn arrives as
  // `agent.response.final` *and* `speech.final`, so without the turn-id guard
  // the opening line was spoken twice (three times with the local engine's
  // fallback chain), and it started before the 25 MB body had loaded.
  const spokenTurnsRef = useRef<Set<string>>(new Set());
  const personaVisibleRef = useRef(false);
  const pendingSpeechRef = useRef<{ text: string; url: string | null } | null>(null);

  const flushPendingSpeech = useCallback(() => {
    const pending = pendingSpeechRef.current;
    pendingSpeechRef.current = null;
    if (pending) void voiceRef.current?.speakTurn(pending.text, pending.url);
  }, []);

  const onPersonaVisible = useCallback(() => {
    if (personaVisibleRef.current) return;
    personaVisibleRef.current = true;
    flushPendingSpeech();
  }, [flushPendingSpeech]);

  const speakOnce = useCallback(
    (key: string, text: string, url: string | null) => {
      if (spokenTurnsRef.current.has(key)) return;
      spokenTurnsRef.current.add(key);
      if (!personaVisibleRef.current) {
        pendingSpeechRef.current = { text, url };
        window.setTimeout(() => {
          if (!personaVisibleRef.current) {
            personaVisibleRef.current = true;
            flushPendingSpeech();
          }
        }, PERSONA_VISIBLE_TIMEOUT_MS);
        return;
      }
      void voiceRef.current?.speakTurn(text, url);
    },
    [flushPendingSpeech],
  );

  const socket = useSessionSocket({
    sessionId,
    mode,
    enabled: Boolean(bootstrap),
    epoch,
    onEvent: (event) => {
      // The training page has always had voice available but never spoke: only
      // the voice page wired playback. Same path as there — server audio when
      // there is any, on-device voice when there is not.
      if (event.type === 'agent.response.final' || event.type === 'speech.final') {
        const turn = event.turn;
        if (turn?.speaker === 'persona' && turn.text && bootstrap?.voiceEnabled) {
          speakOnce(turn.id || turn.text, turn.text, turn.audio_url ?? null);
        }
      }
    },
    onRuntimeFallback: (to, reason) => {
      pushNotice(
        `runtime-${to}`,
        `本機加速已切換為${to === 'wasm' ? ' WASM ' : '伺服器'}模式——${reason}。練習照常進行。`,
      );
    },
    onCompleted: () => {
      voiceRef.current?.cancelTts();
      voiceRef.current?.stop();
    },
  });
  socketRef.current = socket;

  // Webcam affect channel. Off until the trainee turns it on, the recogniser is
  // pluggable (`lib/affect.ts`), and **frames never leave the browser** — only a
  // label + confidence go over the existing socket.
  // The recogniser is the team's `emotion_webcam` rule engine over MediaPipe
  // blendshapes, ported to run in the browser. Registered once, lazily — the
  // 3.6MB model is only fetched when the camera is actually started.
  useEffect(() => {
    setAffectAnalyzer(createMediaPipeAffectAnalyzer());
    return () => setAffectAnalyzer(null);
  }, []);

  const camera = useCameraSession({
    enabled: Boolean(bootstrap) && !finished,
    onReading: (r) => {
      socketRef.current?.send({
        type: 'trainee.affect',
        label: r.label,
        confidence: r.confidence,
        at_ms: Date.now(),
      });
    },
  });

  // Reconnects are NOT announced in the transcript. The header status and the
  // composer placeholder already say 正在重新連線; a system row per attempt
  // turned every 2s API restart into seven identical lines of noise.

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

  // Restart has to reset the *server* session, not just this page. Clearing the
  // store and remounting the socket left the transcript, the turn count and the
  // persona state on the API, so the next connect replayed all of it and the
  // whole conversation reappeared a second later — the button looked broken
  // precisely because it did something.
  //
  // A training product already has the right word for this: another attempt.
  // Creating a fresh session of the same scenario is the only reset that is
  // actually clean, and it keeps the finished attempt intact for review.
  const handleRestart = useCallback(() => {
    voice.cancelTts();
    actions.resetForRestart();
    setNotices([]);
    setEpoch((n) => n + 1);
    const scenarioId = bootstrap?.scenario?.id;
    if (!scenarioId) return;
    void endpoints
      .createSession({
        scenario_id: scenarioId,
        mode: bootstrap.mode,
        voice_enabled: bootstrap.voiceEnabled ?? false,
        score_live_enabled: bootstrap.scoreLiveEnabled ?? true,
      })
      .then((created) => {
        router.push(`/simulations/${created.session.session_id}/live`);
      })
      .catch(() => {
        // The local reset above already happened; say nothing rather than
        // stranding the user on a half-reset page with an error toast.
      });
  }, [actions, bootstrap, router, voice]);

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
              background: 'var(--action-dark)',
              color: 'var(--text-on-accent)',
            }}
          >
            <RestartIcon size={16} />
            Try again
          </button>
        </GlassCard>
      </>
    );
  }

  // The mouth has to move while the audio is *actually playing*, not while the
  // socket says the persona is speaking. `persona_speaking` is set by the text
  // stream (`agent.response.partial`) and clears when the text ends, which is
  // before the clip starts and long before it finishes — so the lipsync ran
  // against silence and the avatar sat still through the whole reply.
  const personaSpeaking = status === 'persona_speaking' || voice.ttsPlaying;
  const personaListening = status === 'listening' || status === 'transcribing';
  const personaThinking = status === 'processing';

  return (
    <>
      <SimulationStyles />

      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
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
          className="min-h-0 flex-1 overflow-hidden"
          variant="stage-left"
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
                className="h-full min-h-0 flex-1"
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
                cameraLive={camera.live}
                onToggleCamera={camera.toggle}
                affectReading={camera.reading}
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
              className="h-full max-h-full"
              layout="stage-fill"
              selfView={
                <SelfView
                  videoRef={camera.videoRef}
                  live={camera.live}
                  reading={camera.reading}
                  analyzerInstalled={camera.analyzerInstalled}
                  modelLoading={camera.modelLoading}
                  noFace={camera.noFace}
                  lastError={camera.lastError}
                  fused={traineeAffect}
                  error={camera.error}
                />
              }
              mode={mode}
              sessionId={sessionId}
              bargeInAtMs={bargeInAtMs}
              scenarioName={bootstrap.scenario.name}
              category={bootstrap.scenario.category}
              industry={bootstrap.scenario.industry}
              trainingType={bootstrap.scenario.trainingType}
              difficulty={bootstrap.scenario.difficulty}
              learningObjectives={bootstrap.scenario.learningObjectives}
              restrictedTopics={bootstrap.scenario.restrictedTopics}
              personaName={bootstrap.persona.name}
              personaGender={bootstrap.persona.gender}
              personaAge={bootstrap.persona.age}
              onPersonaVisible={onPersonaVisible}
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
          pushNotice(`issue-${Date.now()}`, '已收到——你的回報已附加在本次練習上。');
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
        speechEngine={
          <SpeechEngineToggle
            value={speechEngine}
            onChange={(next) => actions.setVoice({ speechEngine: next })}
            systemVoiceCount={voice.systemVoices.length}
            recognition={voice.recognition}
            sttValue={sttEngine}
            onSttChange={(next) => actions.setVoice({ sttEngine: next })}
            sttCapability={sttCapability}
          />
        }
        voiceTuning={
          <VoiceTuningPanel
            onPreview={(engine) =>
              voice.speakTurn('我比較想先知道這個方案一個月實際會多花多少錢。', null, engine)
            }
          />
        }
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
