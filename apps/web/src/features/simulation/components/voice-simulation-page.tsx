'use client';

/**
 * Voice Simulation — spec §24 (Part II) and §22 (Part I).
 *
 *   ┌──────────────────────────────────┬──────────────────────────────┐
 *   │ Conversation + text reply        │ Persona (enlarged)           │
 *   ├──────────────────────────────────┼──────────────────────────────┤
 *   │ Live waveform + call controls    │ Live state + Coach           │
 *   └──────────────────────────────────┴──────────────────────────────┘
 *
 * Voice is optional: one continuous transcript is the primary reading surface,
 * with a text composer directly below it. Connection states are the §22.2 set:
 * Connecting / Listening / Transcribing / Thinking / Speaking / Interrupted /
 * Reconnecting.
 *
 * Barge-in: `useVoiceSession` detects the trainee's voice while the persona is
 * speaking, cancels TTS locally, and this page tells the server the floor moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { endpoints } from '@/lib/api-client';

import { useSessionBootstrap } from '../hooks/use-session-bootstrap';
import { useCameraSession } from '../hooks/use-camera-session';
import { setAffectAnalyzer } from '../lib/affect';
import { createMediaPipeAffectAnalyzer } from '../lib/mediapipe-affect';
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
  useCoachInsights,
  useComplianceFindings,
  useConnectionStatus,
  useEvaluation,
  useEvaluationId,
  useLiveScores,
  usePartials,
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
  useTurns,
  useVoiceMuted,
} from '../store/session-store';
import { AgentActivity } from './agent-activity';
import { CoachCard } from './coach-card';
import { Composer } from './composer';
import { CloseIcon, RestartIcon } from './icons';
import { cn, GlassCard, Skeleton } from './kit';
import { PersonaStage } from './persona-stage';
import { PersonaStateCard } from './persona-state-card';
import { SessionCompleteSummary } from './session-complete-summary';
import { SessionHeader } from './session-header';
import { SimulationStyles } from './simulation-styles';
import { TranscriptFeed, type SystemNotice } from './transcript-feed';
import { TrainingGrid } from './training-grid';
import { AffectNudge } from './affect-nudge';
import { SelfView } from './self-view';
import { Waveform } from './waveform';

/** How long the opening line waits for the 3D body before playing anyway. */
const PERSONA_VISIBLE_TIMEOUT_MS = 6000;

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
  const traineeAffect = useTraineeAffect();
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

  const isTraining = mode === 'training';
  const finished = status === 'completed';

  const timer = useSessionTimer(bootstrap?.scenario.timeLimitSeconds);
  const transcriptExport = useTranscriptExport();

  const [epoch, setEpoch] = useState(0);
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [interrupted, setInterrupted] = useState(false);
  const [evaluationLoading, setEvaluationLoading] = useState(false);

  const pushNotice = useCallback((id: string, text: string) => {
    setNotices((current) =>
      current.some((n) => n.id === id) ? current : [...current, { id, atMs: Date.now(), text }],
    );
  }, []);

  /** Rises on every trainee interruption; the persona stage interrupts the avatar. */
  const [bargeInAtMs, setBargeInAtMs] = useState(0);

  const socketRef = useRef<ReturnType<typeof useSessionSocket> | null>(null);
  const voiceRef = useRef<ReturnType<typeof useVoiceSession> | null>(null);

  // ---- Voice pipeline ------------------------------------------------------

  const sttEngine = useSessionStore((st) => st.voice.sttEngine);
  const sttEngineRef = useRef(sttEngine);
  sttEngineRef.current = sttEngine;

  const router = useRouter();
  const voice = useVoiceSession({
    enabled: true,
    sessionId,
    personaGender: bootstrap?.persona.gender ?? null,
    personaAge: bootstrap?.persona.age ?? null,
    locale: bootstrap?.persona.language ?? 'zh-TW',
    personaSpeaking: status === 'persona_speaking',
    pushToTalk: false,
    onBargeIn: () => {
      setInterrupted(true);
      // §44 — stop the avatar mid-word as well as the TTS.
      setBargeInAtMs(Date.now());
      socketRef.current?.pushToTalk(true);
      window.setTimeout(() => setInterrupted(false), 1400);
    },
    onSpeechEnd: () => {
      // The floor is released; the server decides what happens next.
      socketRef.current?.pushToTalk(false);
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
      pushNotice('silence', '還在聆聽——準備好時直接開口即可。');
    },
  });
  voiceRef.current = voice;

  // One line, one utterance.
  //
  // A persona turn arrives as `agent.response.final` *and*, in voice mode, as
  // `speech.final` — both carry the same turn, so the opening line was spoken
  // twice, and with the local engine a third time when the fallback chain also
  // produced a clip. Keying on the turn id is what makes it once.
  //
  // The first line also waits for the persona to be on screen. `speak` runs the
  // moment the socket says ready, which is before the 25 MB body has loaded, so
  // the customer was talking to an empty frame. The wait is capped: if the
  // avatar never reports (portrait-only, WebGL off), the line still plays.
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
      // Auto-play the persona's synthesised audio in voice mode (§22.1).
      if (event.type === 'agent.response.final' || event.type === 'speech.final') {
        const turn = event.turn;
        if (turn?.speaker === 'persona' && turn.text) {
          // Not `playTts(audio_url)`: that only spoke when the server had
          // synthesised audio, so with no key, no network, or the transport
          // still unbuilt the customer was simply mute. `speakTurn` prefers the
          // server clip and falls back to the on-device voice.
          speakOnce(turn.id || turn.text, turn.text, turn.audio_url ?? null);
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

  // Same webcam affect channel as the training page: frames stay in the
  // browser, only a label + confidence go over the socket.
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

  const voiceStatus = voiceStatusFromSession(status, voice.micLive, interrupted);

  useEffect(() => {
    actions.setVoice({ status: voiceStatus, pushToTalkMode: false });
  }, [actions, voiceStatus]);

  // Reconnects are NOT announced in the transcript. The header status and the
  // composer placeholder already say 正在重新連線; a system row per attempt
  // turned every 2s API restart into seven identical lines of noise.

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

  // ---- Handlers ------------------------------------------------------------

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
    setInterrupted(false);
    setEpoch((n) => n + 1);
    const scenarioId = bootstrap?.scenario?.id;
    if (!scenarioId) return;
    void endpoints
      .createSession({
        scenario_id: scenarioId,
        mode: bootstrap.mode,
        voice_enabled: true,
        score_live_enabled: bootstrap.scoreLiveEnabled ?? true,
      })
      .then((created) => {
        router.push(`/simulations/${created.session.session_id}/voice`);
      })
      .catch(() => {
        // The local reset above already happened; say nothing rather than
        // stranding the user on a half-reset page with an error toast.
      });
  }, [actions, bootstrap, router, voice]);

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

  // ---- Shells --------------------------------------------------------------

  if (loading && !bootstrap) {
    return (
      <>
        <SimulationStyles />
        <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-card" />
          <TrainingGrid
            variant="stage-left"
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
  const personaListening = voiceStatus === 'listening' || voiceStatus === 'transcribing';

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
            onFullReport={() => undefined}
            onReplay={() => undefined}
            onRetry={handleRestart}
            onCompare={() => undefined}
            onShare={() => void transcriptExport.copy()}
            onExportPdf={() => transcriptExport.download('md')}
          />
        ) : (
          <TrainingGrid
            variant="stage-left"
            className="min-h-0 flex-1 overflow-hidden"
            left={
              <>
                <GlassCard className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="flex items-center justify-between gap-3 px-1.5 pb-2">
                    <h2 className="text-card-title text-text-primary">對談</h2>
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

                <AffectNudge
                  reading={camera.reading}
                  cameraLive={camera.live}
                  noFace={camera.noFace}
                  // Anything except a session that is not running. Gating this
                  // on the trainee's *turn* meant a frown during the customer's
                  // answer — the most natural moment to look stuck — was
                  // ignored, and the card then appeared long after the
                  // expression had passed. Kept identical to the text page's
                  // copy in `conversation-panel.tsx`; the two drifted, and this
                  // one is the page the demo actually runs on.
                  traineesTurn={status !== 'connecting' && status !== 'error'}
                  onAskHint={isTraining ? () => socket.requestHint() : undefined}
                />

                <Composer
                  status={status}
                  onSend={socket.sendMessage}
                  onPushToTalk={(pressed) => {
                    voice.setPushToTalkHeld(pressed);
                    socket.pushToTalk(pressed);
                  }}
                  onRequestHint={isTraining ? () => socket.requestHint() : undefined}
                  voiceEnabled={bootstrap.voiceEnabled}
                  micLive={voice.micLive}
                  muted={muted}
                  onToggleMic={() => {
                    if (!voice.micLive) void voice.start();
                    else voice.toggleMute();
                  }}
                  turnCount={turns.length}
                  maxTurns={bootstrap.scenario.maxTurns}
                  cameraLive={camera.live}
                  onToggleCamera={camera.toggle}
                  className="px-1"
                />

              </>
            }
            right={
              /*
                §24 enlarged persona, in the stage-fill shape the training page
                uses: the virtual human owns the panel and the state / coach
                cards float over its lower-left instead of pushing it into a
                small card at the top of a scrolling column.
              */
              <section className="relative h-full min-h-0 overflow-hidden" aria-label="AI 模擬人物">
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
                <PersonaStage
                  fill
                  className="h-full min-h-0"
                  personaName={bootstrap.persona.name}
                  personaGender={bootstrap.persona.gender}
                  personaAge={bootstrap.persona.age}
                  onPersonaVisible={onPersonaVisible}
                  subtitle={bootstrap.persona.subtitle ?? bootstrap.persona.occupation}
                  avatarUrl={bootstrap.persona.avatarUrl}
                  personaState={personaState}
                  sessionId={sessionId}
                  bargeInAtMs={bargeInAtMs}
                  eyebrow="語音模擬"
                  speaking={personaSpeaking}
                  listening={personaListening}
                  thinking={status === 'processing'}
                  waveform={
                    <Waveform
                      analyser={voice.analyser}
                      active={voice.micLive && !muted}
                      bars={28}
                      ariaLabel="麥克風音量"
                    />
                  }
                />

                {/* Full-height wrapper, bottom-aligned: the stack's `max-h` is a
                    percentage, and against the old auto-height `bottom-0` box it
                    resolved to nothing — so the cards grew until they covered the
                    persona's face. */}
                {/* Same two-column, chest-height glass stack as PersonaColumn's
                    stage-fill layout — keep the two in step. */}
                <div className="sim-stage-overlay-host pointer-events-none absolute inset-0 z-10 flex items-end p-3 pb-11">
                  <div className={cn(
                      'sim-stage-overlay pointer-events-auto grid w-full items-stretch gap-2',
                      // Two columns of equal height whose tops line up, each
                      // scrolling inside its own rounded box. `sm:grid-rows-1`
                      // is what makes that work: Tailwind emits
                      // `minmax(0, 1fr)`, so the row is the container's height
                      // rather than the content's, and `min-h-0` on the cards
                      // lets them shrink into it. Without it the row sized to
                      // the tallest card (522px inside a 275px box) and the
                      // container simply cut it off — the meters were sliced
                      // through the middle and nothing scrolled.
                      'max-h-[38%] grid-cols-1 overflow-y-auto',
                      'sm:grid-cols-2 sm:grid-rows-1 sm:overflow-hidden',
                      '[&>*]:min-h-0 [&>*]:overflow-y-auto',
                    )}>
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
                </div>
              </section>
            }
          />
        )}
      </div>

      {/* Dialogs -------------------------------------------------------------- */}
    </>
  );
}
