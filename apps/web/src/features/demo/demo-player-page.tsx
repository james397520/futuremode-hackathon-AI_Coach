'use client';

/**
 * 展示模式播放頁（螢幕錄影用）——介面與正式模擬頁一模一樣，半自動演出。
 *
 * 直接用正式產品的版面元件：SessionHeader ＋ TrainingGrid(stage-left) ＋
 * ConversationPanel（對談、composer、教練卡、合規卡、引用晶片、事件列）＋
 * PersonaStage ＋「目前狀態」「AI 教練」兩張浮動卡（與語音頁相同）。差別只有資料來源：
 * 對話照 `demo-scripts.ts` 的劇本演出：AI（客戶／教練／合規）自動輸出，輪到學員時
 * 把該說的話自動貼進輸入框、由使用者親自按「送出」，按下後 AI 再自動接續。不呼叫
 * 後端對話、不呼叫模型，所以錄影逐字一致、不會中斷。
 *
 * 兩個時序保證：
 * 1. 整段流程與第一句 TTS 都**等虛擬人出現後**才開始（onPersonaVisible，含逾時
 *    後備），避免語音在畫面還沒好時就提前播。
 * 2. TTS 只借一個真實 session 呼叫 /sessions/{id}/speak（本地 Breeze 女聲），
 *    對話本身仍照劇本；session 或 TTS 不可用時虛擬人改用計時器動嘴，錄影不會停。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentName,
  CoachInsight,
  ComplianceFinding,
  PersonaSimulationState,
  SessionState,
  TranscriptTurn,
} from '@ai-coach/shared';
import { SessionHeader } from '@/features/simulation/components/session-header';
import { TrainingGrid } from '@/features/simulation/components/training-grid';
import { ConversationPanel } from '@/features/simulation/components/conversation-panel';
import { PersonaStage } from '@/features/simulation/components/persona-stage';
import { PersonaStateCard } from '@/features/simulation/components/persona-state-card';
import { CoachCard } from '@/features/simulation/components/coach-card';
import { SelfView } from '@/features/simulation/components/self-view';
import { cn } from '@/features/simulation/components/kit';
import { SimulationStyles } from '@/features/simulation/components/simulation-styles';
import { endpoints } from '@/lib/api-client';
import type { DemoBeat, DemoScript } from './demo-scripts';

const SESSION = 'demo-session';
const PERSONA_VISIBLE_TIMEOUT_MS = 6000; // fallback if the avatar never reports
const TYPING_MS = 1100; // persona "typing" before a reply
const AFTER_EVENT_MS = 900; // pause after a coach / compliance card
const OPENING_MS = 700; // small beat after the avatar appears
const RETRIEVE_MS = 850; // knowledge-retrieval step before a cited reply
const AFTER_SPEECH_MS = 1000; // breath after the customer finishes speaking

const TTS_ENGINE = 'local' as const;
const TTS_TUNING = { stability: 0.5, similarity: 0.75, style: 0.3, speed: 1 };
const speakMsFor = (text: string) => Math.min(6000, Math.max(1200, text.length * 90));

// Dev-only breadcrumb trail for pacing checks (`window.__demoTrace`). No-op in production.
const trace = (label: string): void => {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return;
  const w = window as unknown as { __demoTrace?: string[]; __demoT0?: number };
  w.__demoT0 ??= Date.now();
  (w.__demoTrace ??= []).push(`${((Date.now() - w.__demoT0) / 1000).toFixed(1)}s ${label}`);
};

function baseState(script: DemoScript): PersonaSimulationState {
  const t = script.personaTraits;
  return {
    scenario_phase: 'opening',
    emotion: 'neutral',
    trust: t.trust,
    interest: t.interest,
    resistance: t.resistance,
    patience: t.patience,
    intent: 'greeting',
    current_goal: 'understand_what_i_get',
    hidden_need_revealed: false,
    compliance_risk: 'safe',
    time_pressure: 3,
    budget: script.personaGender === 'male' ? 4000 : 3000,
  };
}

export function DemoPlayerPage({ script }: { script: DemoScript }) {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [insights, setInsights] = useState<CoachInsight[]>([]);
  const [findings, setFindings] = useState<ComplianceFinding[]>([]);
  const [status, setStatus] = useState<SessionState>('connecting');
  const [speaking, setSpeaking] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentName | null>(null);
  const [agentAtMs, setAgentAtMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // Persona state for the 目前狀態 card and the avatar's expression. Starts null
  // — exactly like the real store before the engine's first report — so the card
  // reads 「等待模擬人物回應中」 until the customer first answers.
  const [pstate, setPstate] = useState<PersonaSimulationState | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsSessionRef = useRef<string | null>(null);
  const speakTokenRef = useRef(0);
  const seqRef = useRef(1);
  const startRef = useRef(Date.now());
  const startedRef = useRef(false); // the auto-run has begun (once per mount)
  const rootRef = useRef<HTMLDivElement>(null); // scopes DOM control of the real composer
  const resumeRef = useRef(0); // beat index to resume at after the trainee line is sent
  const pstateRef = useRef<PersonaSimulationState>(baseState(script)); // mirror for merge
  const runRef = useRef(0); // bumped on begin/restart/unmount; stale continuations check it

  // Advance the persona state so the 目前狀態 card and avatar expression move
  // exactly as the real engine drives them. Card logic is untouched.
  const evolve = useCallback((patch: Partial<PersonaSimulationState>) => {
    const next = { ...pstateRef.current, ...patch };
    pstateRef.current = next;
    setPstate(next);
  }, []);
  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  const nextTs = useCallback(() => seqRef.current++ * 1000, []);
  const after = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Cosmetic running clock for the header.
  useEffect(() => {
    const id = setInterval(() => {
      if (startedRef.current) setElapsedMs(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // One real session, used ONLY to synthesise the persona voice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const created = await endpoints.createSession({
          scenario_id: script.ttsScenarioId,
          mode: 'training',
          voice_enabled: true,
          score_live_enabled: false,
        });
        if (!cancelled) ttsSessionRef.current = created.session.session_id;
      } catch {
        if (!cancelled) ttsSessionRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [script.ttsScenarioId]);

  /**
   * Wait for the "thinking" delay AND the prepared audio, whichever is later —
   * capped so a slow synth cannot stall the demo. Rendering the bubble on this
   * makes the subtitle and the voice land together instead of text leading.
   */
  const whenReady = useCallback(
    (minMs: number, prepared: Promise<Blob | null>, capMs = 6000): Promise<Blob | null> =>
      new Promise((resolve) => {
        let blob: Blob | null = null;
        let gotBlob = false;
        let minDone = false;
        let done = false;
        const tryFinish = () => {
          if (done) return;
          if (minDone && gotBlob) {
            done = true;
            resolve(blob);
          }
        };
        void prepared.then((b) => {
          blob = b;
          gotBlob = true;
          tryFinish();
        });
        timers.current.push(
          setTimeout(() => {
            minDone = true;
            tryFinish();
          }, minMs),
        );
        timers.current.push(
          setTimeout(() => {
            if (done) return;
            done = true;
            resolve(blob); // cap: go with whatever we have (null → procedural mouth)
          }, capMs),
        );
      }),
    [],
  );

  /** Start synthesis now; resolves to the audio blob, or null when TTS is unavailable. */
  const prepareSpeech = useCallback((text: string): Promise<Blob | null> => {
    const sid = ttsSessionRef.current;
    if (!sid) return Promise.resolve(null);
    return endpoints.synthesizeSpeech(sid, text, TTS_TUNING, TTS_ENGINE).catch(() => null);
  }, []);

  /**
   * Speak one persona line. Resolves when the line has FINISHED (audio `ended`,
   * or the fallback timer when there is no TTS). The mouth opens only once
   * `el.play()` actually starts — same as the real voice page — so lips and
   * sound line up instead of the mouth leading by the synthesis round-trip.
   */
  const speakLine = useCallback((text: string, prepared?: Promise<Blob | null>): Promise<void> => {
    const token = (speakTokenRef.current += 1);
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        trace(`speech:finish token=${token} cur=${speakTokenRef.current}`);
        if (speakTokenRef.current === token) setSpeaking(false);
        resolve();
      };
      const fallback = () => {
        // No usable audio: procedural mouth for a text-length-based duration.
        trace(`speech:fallback token=${token} cur=${speakTokenRef.current} sid=${ttsSessionRef.current ? 'y' : 'n'}`);
        if (speakTokenRef.current !== token) return finish();
        setSpeaking(true);
        timers.current.push(setTimeout(finish, speakMsFor(text)));
      };
      if (!prepared && !ttsSessionRef.current) return fallback();
      void (async () => {
        try {
          const blob = await (prepared ?? prepareSpeech(text));
          if (speakTokenRef.current !== token) return finish(); // superseded
          if (!blob) return fallback();
          const url = URL.createObjectURL(blob);
          audioRef.current?.pause();
          const el = new Audio(url);
          audioRef.current = el;
          el.onended = () => {
            URL.revokeObjectURL(url);
            finish();
          };
          el.onerror = () => {
            URL.revokeObjectURL(url);
            fallback();
          };
          await el.play();
          trace(`speech:audio-start token=${token}`);
          if (speakTokenRef.current === token) setSpeaking(true); // mouth starts WITH the audio
          // Safety net if `ended` never fires (e.g. tab throttled).
          timers.current.push(setTimeout(finish, speakMsFor(text) * 3 + 4000));
        } catch {
          fallback();
        }
      })();
    });
  }, [prepareSpeech]);

  const addTrainee = useCallback(
    (text: string) => {
      const ts = nextTs();
      setTurns((p) => [...p, { id: `t${ts}`, session_id: SESSION, speaker: 'trainee', text, timestamp_ms: ts }]);
    },
    [nextTs],
  );
  const addPersona = useCallback(
    (beat: Extract<DemoBeat, { speaker: 'persona' }>, prepared?: Promise<Blob | null>): Promise<void> => {
      const ts = nextTs();
      setTurns((p) => [
        ...p,
        {
          id: `p${ts}`,
          session_id: SESSION,
          speaker: 'persona',
          text: beat.text,
          timestamp_ms: ts,
          ...(beat.citations ? { citations: beat.citations } : {}),
        },
      ]);
      const done = speakLine(beat.text, prepared);
      // Drive the persona-column cards: a cited reply reads as progress into the
      // presentation phase and lifts interest/trust; a plain reply nudges it.
      if (beat.citations?.length) {
        evolve({
            emotion: 'interested',
            interest: clamp(pstateRef.current.interest + 8),
            trust: clamp(pstateRef.current.trust + 6),
            scenario_phase: 'presentation',
            compliance_risk: 'safe',
          });
      } else {
        evolve({
            emotion: 'curious',
            interest: clamp(pstateRef.current.interest + 4),
            trust: clamp(pstateRef.current.trust + 3),
          });
      }
      return done;
    },
    [nextTs, speakLine, evolve],
  );

  // Always points at the latest `play`, so the composer-driven trainee send can
  // resume the walk without a render-cycle dependency loop.
  const playRef = useRef<(i: number) => void>(() => {});

  // The trainee's turn: paste the scripted line into the REAL composer and
  // WAIT. The user presses 送出 themselves; onSendTrainee then adds the turn and
  // resumes the AI output. If the composer DOM is unreachable, the line is kept
  // as a hint the user can still send.
  const fillComposer = useCallback((text: string) => {
    const root = rootRef.current;
    const ta = root?.querySelector<HTMLTextAreaElement>('textarea');
    if (!ta) return;
    const nativeSet = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    nativeSet?.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }, []);

  // The user pressed 送出. Add the trainee turn, then auto-play the AI output up
  // to the next trainee line (which fillComposer pre-fills, then waits again).
  const onSendTrainee = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      addTrainee(clean);
      setStatus('processing');
      // The first trainee turn moves the scenario out of the opening phase.
      if (pstateRef.current.scenario_phase === 'opening') {
        evolve({ scenario_phase: 'needs_discovery' });
      }
      after(600, () => playRef.current(resumeRef.current));
    },
    [addTrainee, after, evolve],
  );

  // The auto-player: walk every beat with human-readable pacing. No input.
  const play = useCallback(
    (i: number) => {
      trace(`play(${i})`);
      if (i >= script.beats.length) {
        setActiveAgent(null);
        setStatus('completed');
        evolve({
            emotion: 'reassured',
            trust: clamp(pstateRef.current.trust + 8),
            resistance: clamp(pstateRef.current.resistance - 10),
            scenario_phase: 'closing',
            compliance_risk: 'safe',
          });
        return;
      }
      const beat = script.beats[i];
      if (!beat) return;

      if (beat.speaker === 'trainee') {
        // "Your turn": pre-fill the line into the real composer and WAIT — the
        // user presses 送出 themselves. onSendTrainee resumes from resumeRef.
        setStatus('ready');
        setActiveAgent(null);
        resumeRef.current = i + 1;
        after(AFTER_SPEECH_MS, () => {
          trace('fillComposer');
          fillComposer(beat.text);
        });
        return;
      }

      if (beat.speaker === 'persona') {
        setStatus('persona_speaking');
        const prepared = prepareSpeech(beat.text); // synth while "thinking" shows
        // Pretend the answer is being generated. When the reply cites the
        // knowledge base, show the retrieval step first (查找核准資料) and then
        // the customer composing — mirroring the real RAG → generate pipeline —
        // so the wait reads as live AI work, not a canned line.
        if (beat.citations?.length) {
          setActiveAgent('knowledge');
          setAgentAtMs(Date.now());
          after(RETRIEVE_MS, () => {
            setActiveAgent('customer');
            setAgentAtMs(Date.now());
            const run = runRef.current;
            void whenReady(TYPING_MS, prepared).then((blob) => {
              if (runRef.current !== run) return;
              setActiveAgent(null);
              void addPersona(beat, Promise.resolve(blob)).then(() => {
                if (runRef.current !== run) return;
                after(AFTER_SPEECH_MS, () => play(i + 1));
              });
            });
          });
        } else {
          setActiveAgent('customer');
          setAgentAtMs(Date.now());
          const run = runRef.current;
          void whenReady(TYPING_MS, prepared).then((blob) => {
            if (runRef.current !== run) return;
            setActiveAgent(null);
            void addPersona(beat, Promise.resolve(blob)).then(() => {
              if (runRef.current !== run) return;
              after(AFTER_SPEECH_MS, () => play(i + 1));
            });
          });
        }
        return;
      }

      if (beat.speaker === 'coach') {
        setStatus('persona_speaking'); // keep the composer locked while AI works
        setActiveAgent('coach');
        setAgentAtMs(Date.now());
        after(TYPING_MS, () => {
          setInsights((p) => [
            ...p,
            {
              id: `c${nextTs()}`,
              session_id: SESSION,
              timestamp_ms: nextTs(),
              kind: 'hint',
              title: beat.title,
              body: beat.text,
              allowed_in_assessment: false,
              requested: false,
            },
          ]);
          evolve({ patience: clamp(pstateRef.current.patience - 4) });
          setActiveAgent(null);
          after(AFTER_EVENT_MS, () => play(i + 1));
        });
        return;
      }

      // compliance
      setStatus('persona_speaking'); // keep the composer locked while AI works
      setActiveAgent('compliance');
      setAgentAtMs(Date.now());
      after(TYPING_MS, () => {
        setFindings((p) => [...p, { ...beat.finding, timestamp_ms: nextTs() }]);
        evolve({
            emotion: 'skeptical',
            resistance: clamp(pstateRef.current.resistance + 8),
            trust: clamp(pstateRef.current.trust - 4),
            compliance_risk: beat.finding.severity,
            scenario_phase: 'objection_handling',
          });
        setActiveAgent(null);
        after(AFTER_EVENT_MS, () => play(i + 1));
      });
    },
    [script, after, addPersona, fillComposer, nextTs, evolve, prepareSpeech, whenReady],
  );

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  // Kick the whole run off ONCE, and only after the virtual human is on screen,
  // so no TTS plays before the avatar appears. A timeout is the fallback for a
  // portrait-only / WebGL-off avatar that never reports visible.
  const begin = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runRef.current += 1;
    trace(`begin run=${runRef.current}`);
    startRef.current = Date.now();
    setElapsedMs(0);
    pstateRef.current = baseState(script);
    setPstate(null);
    setStatus('ready');
    const opening = script.opening;
    if (opening.speaker === 'persona') {
      const prepared = prepareSpeech(opening.text);
      const run = runRef.current;
      void whenReady(OPENING_MS, prepared).then((blob) => {
        if (runRef.current !== run) return;
        const ts = nextTs();
        setTurns([
          { id: `p${ts}`, session_id: SESSION, speaker: 'persona', text: opening.text, timestamp_ms: ts },
        ]);
        void speakLine(opening.text, Promise.resolve(blob)).then(() => {
          trace(`opening:then run=${run} cur=${runRef.current}`);
          if (runRef.current !== run) return;
          after(AFTER_SPEECH_MS, () => play(0));
        });
      });
    } else {
      after(OPENING_MS, () => play(0));
    }
  }, [script, after, nextTs, speakLine, play, prepareSpeech, whenReady]);

  useEffect(() => {
    const fallback = setTimeout(begin, PERSONA_VISIBLE_TIMEOUT_MS);
    timers.current.push(fallback);
    return () => {
      trace('effect:cleanup');
      clearTimers();
      audioRef.current?.pause();
      speakTokenRef.current += 1;
      runRef.current += 1;
    };
  }, [begin, clearTimers]);

  const restart = useCallback(() => {
    clearTimers();
    audioRef.current?.pause();
    speakTokenRef.current += 1;
    runRef.current += 1;
    seqRef.current = 1;
    startedRef.current = false;
    setTurns([]);
    setInsights([]);
    setFindings([]);
    pstateRef.current = baseState(script);
    setPstate(null);
    setSpeaking(false);
    setActiveAgent(null);
    setStatus('connecting');
    // The avatar is already on screen on a replay, so onPersonaVisible will not
    // fire again — start again on a short delay directly.
    after(800, begin);
  }, [clearTimers, begin, after, script]);

  const noop = useCallback(() => {}, []);
  const traineeTurns = turns.filter((t) => t.speaker === 'trainee').length;

  return (
    <>
      <SimulationStyles />
      <div ref={rootRef} className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <SessionHeader
          scenarioName={script.scenarioTitle}
          personaName={script.personaName}
          personaSubtitle={script.personaOccupation}
          difficulty={script.difficulty}
          mode="training"
          status={status}
          elapsedMs={elapsedMs}
          remainingMs={Math.max(0, script.timeLimitSeconds * 1000 - elapsedMs)}
          overtime={false}
          turnCount={traineeTurns}
          maxTurns={script.maxTurns}
          runtime={{ backend: 'server', degraded: false }}
          online
          reconnectAttempt={0}
          onPauseResume={noop}
          onRestart={restart}
          onEnd={restart}
        />

        <TrainingGrid
          className="min-h-0 flex-1 overflow-hidden"
          variant="stage-left"
          left={
            <ConversationPanel
              className="h-full min-h-0 flex-1"
              sessionId={SESSION}
              mode="training"
              status={status}
              turns={turns}
              partials={{}}
              speechPartial={null}
              coachInsights={insights}
              complianceFindings={findings}
              systemNotices={[]}
              startedAtMs={startRef.current}
              personaName={script.personaName}
              activeAgent={activeAgent}
              agentActivityAtMs={agentAtMs}
              turnCount={traineeTurns}
              maxTurns={script.maxTurns}
              voiceEnabled
              micLive={false}
              muted={false}
              cameraLive={false}
              vadActive={false}
              captionsEnabled
              onSend={onSendTrainee}
              onPushToTalk={noop}
              onToggleMic={noop}
              onToggleCamera={noop}
              onRequestHint={noop}
              onPauseResume={noop}
              onRestart={restart}
              onEnd={restart}
              onToggleCaptions={noop}
              onOpenTranscript={noop}
              onReportIssue={noop}
              onOpenAudioDevice={noop}
              showQuickActions={false}
            />
          }
          right={
            <section className="relative h-full min-h-0 overflow-hidden" aria-label="AI 模擬人物">
              <SelfView videoRef={videoRef} live={false} reading={null} analyzerInstalled={false} />
              <PersonaStage
                fill
                className="h-full min-h-0"
                personaName={script.personaName}
                personaGender={script.personaGender}
                personaAge={script.personaAge}
                onPersonaVisible={begin}
                subtitle={`${script.personaOccupation} · ${script.industry}`}
                personaState={pstate}
                eyebrow="語音模擬"
                speaking={speaking}
                listening={status === 'listening'}
                thinking={status === 'processing'}
              />
              {/* Same two-column, chest-height glass stack as the real voice page. */}
              <div className="sim-stage-overlay-host pointer-events-none absolute inset-0 z-10 flex items-end p-3 pb-11">
                <div
                  className={cn(
                    'sim-stage-overlay pointer-events-auto grid w-full items-stretch gap-2',
                    'max-h-[38%] grid-cols-1 overflow-y-auto',
                    'sm:grid-cols-2 sm:grid-rows-1 sm:overflow-hidden',
                    '[&>*]:min-h-0 [&>*]:overflow-y-auto',
                  )}
                >
                  <PersonaStateCard state={pstate} updating={status === 'processing' || speaking} />
                  <CoachCard
                    mode="training"
                    insights={insights}
                    suppressedCount={0}
                    startedAtMs={startRef.current}
                    onAskCoach={noop}
                  />
                </div>
              </div>
            </section>
          }
        />
      </div>
    </>
  );
}
