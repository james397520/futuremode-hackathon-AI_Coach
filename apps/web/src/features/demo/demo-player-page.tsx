'use client';

/**
 * 展示模式播放頁（螢幕錄影用）——介面與正式模擬頁一模一樣。
 *
 * 直接用正式產品的版面元件：SessionHeader ＋ TrainingGrid(stage-left) ＋
 * ConversationPanel（對談、composer、教練卡、合規卡、引用晶片）＋
 * PersonaColumn(stage-fill)（大虛擬人＋自拍位＋情境資訊卡）。差別只有資料來源：
 * 對話照 `demo-scripts.ts` 的劇本走，不呼叫後端對話、不呼叫模型，所以錄影逐字
 * 一致、不會中斷。TTS 只借一個真實 session 呼叫 /sessions/{id}/speak（本地
 * Breeze 女聲），對話本身仍照劇本；session 或 TTS 不可用時，虛擬人改用計時器
 * 動嘴，錄影不會停。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CoachInsight,
  ComplianceFinding,
  PersonaSimulationState,
  SessionState,
  TranscriptTurn,
} from '@ai-coach/shared';
import { SessionHeader } from '@/features/simulation/components/session-header';
import { TrainingGrid } from '@/features/simulation/components/training-grid';
import { ConversationPanel } from '@/features/simulation/components/conversation-panel';
import { PersonaColumn } from '@/features/simulation/components/persona-column';
import { SimulationStyles } from '@/features/simulation/components/simulation-styles';
import { endpoints } from '@/lib/api-client';
import type { DemoBeat, DemoScript } from './demo-scripts';

const TYPING_MS = 900;
const BETWEEN_MS = 550;
const SESSION = 'demo-session';

const TTS_ENGINE = 'local' as const;
const TTS_TUNING = { stability: 0.5, similarity: 0.75, style: 0.3, speed: 1 };
const speakMsFor = (text: string) => Math.min(6000, Math.max(1200, text.length * 90));

const isTrainee = (b: DemoBeat) => b.speaker === 'trainee';

function nextTraineeLine(script: DemoScript, cursor: number): string | null {
  for (let i = cursor; i < script.beats.length; i += 1) {
    const beat = script.beats[i];
    if (beat && isTrainee(beat)) return (beat as { text: string }).text;
  }
  return null;
}

function baseState(script: DemoScript): PersonaSimulationState {
  return {
    scenario_phase: 'opening',
    emotion: 'neutral',
    trust: 45,
    interest: 50,
    resistance: 55,
    patience: 60,
    intent: 'greeting',
    current_goal: 'understand_what_i_get',
    hidden_need_revealed: false,
    compliance_risk: 'safe',
    time_pressure: 3,
    ...(script.personaGender === 'male' ? { budget: 4000 } : { budget: 3000 }),
  };
}

export function DemoPlayerPage({ script }: { script: DemoScript }) {
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [insights, setInsights] = useState<CoachInsight[]>([]);
  const [findings, setFindings] = useState<ComplianceFinding[]>([]);
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<SessionState>('ready');
  const [speaking, setSpeaking] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsSessionRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const speakTokenRef = useRef(0);
  const seqRef = useRef(1);
  const startRef = useRef(Date.now());

  const nextTs = useCallback(() => seqRef.current++ * 1000, []);
  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Running clock for the header — purely cosmetic, matches the real timer.
  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 1000);
    return () => clearInterval(id);
  }, []);

  // One real session, used ONLY to synthesise the persona voice. The scripted
  // conversation never touches it; if it cannot be created, TTS is skipped and
  // the avatar still lip-flaps on a timer so a recording never stalls.
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

  const speakLine = useCallback((text: string) => {
    const token = (speakTokenRef.current += 1);
    const stopTimer = setTimeout(() => {
      if (speakTokenRef.current === token) setSpeaking(false);
    }, speakMsFor(text));
    timers.current.push(stopTimer);
    setSpeaking(true);
    const sid = ttsSessionRef.current;
    if (!sid) return;
    void (async () => {
      try {
        const blob = await endpoints.synthesizeSpeech(sid, text, TTS_TUNING, TTS_ENGINE);
        if (speakTokenRef.current !== token) return;
        const url = URL.createObjectURL(blob);
        audioRef.current?.pause();
        const el = new Audio(url);
        audioRef.current = el;
        clearTimeout(stopTimer);
        el.onended = () => {
          if (speakTokenRef.current === token) setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        await el.play();
      } catch {
        /* keep the timer-driven mouth movement */
      }
    })();
  }, []);

  const renderBeat = useCallback(
    (beat: DemoBeat) => {
      if (beat.speaker === 'trainee') {
        setTurns((p) => [
          ...p,
          { id: `t${nextTs()}`, session_id: SESSION, speaker: 'trainee', text: beat.text, timestamp_ms: nextTs() },
        ]);
      } else if (beat.speaker === 'persona') {
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
        speakLine(beat.text);
      } else if (beat.speaker === 'coach') {
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
      } else {
        setFindings((p) => [...p, { ...beat.finding, timestamp_ms: nextTs() }]);
      }
    },
    [nextTs, speakLine],
  );

  const reset = useCallback(() => {
    clearTimers();
    audioRef.current?.pause();
    speakTokenRef.current += 1;
    busyRef.current = false;
    seqRef.current = 1;
    startRef.current = Date.now();
    setElapsedMs(0);
    setCursor(0);
    setStatus('ready');
    setSpeaking(false);
    setInsights([]);
    setFindings([]);
    const opening = script.opening;
    if (opening.speaker === 'persona') {
      const ts = nextTs();
      setTurns([
        { id: `p${ts}`, session_id: SESSION, speaker: 'persona', text: opening.text, timestamp_ms: ts },
      ]);
      speakLine(opening.text);
    } else {
      setTurns([]);
    }
  }, [clearTimers, script, nextTs, speakLine]);

  useEffect(() => {
    reset();
    return () => {
      clearTimers();
      audioRef.current?.pause();
      speakTokenRef.current += 1;
    };
  }, [reset, clearTimers]);

  const playAgentBeats = useCallback(
    (from: number) => {
      let i = from;
      const step = () => {
        const beat = script.beats[i];
        if (i >= script.beats.length || !beat || isTrainee(beat)) {
          setCursor(i);
          setStatus(i >= script.beats.length ? 'completed' : 'ready');
          busyRef.current = false;
          return;
        }
        setStatus('persona_speaking');
        const b = beat;
        timers.current.push(
          setTimeout(() => {
            renderBeat(b);
            i += 1;
            timers.current.push(setTimeout(step, BETWEEN_MS));
          }, TYPING_MS),
        );
      };
      step();
    },
    [script, renderBeat],
  );

  const handleSend = useCallback(() => {
    if (busyRef.current) return;
    const line = nextTraineeLine(script, cursor);
    if (line == null) return;
    busyRef.current = true;
    setStatus('processing');
    let i = cursor;
    while (i < script.beats.length) {
      const b = script.beats[i];
      if (b && isTrainee(b)) break;
      i += 1;
    }
    const traineeBeat = script.beats[i];
    if (!traineeBeat) return;
    renderBeat(traineeBeat);
    playAgentBeats(i + 1);
  }, [cursor, script, playAgentBeats, renderBeat]);

  const personaState = useMemo(() => baseState(script), [script]);
  const noop = useCallback(() => {}, []);

  return (
    <>
      <SimulationStyles />
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <SessionHeader
          scenarioName={script.scenarioTitle}
          personaName={script.personaName}
          personaSubtitle={script.personaOccupation}
          difficulty={script.difficulty}
          mode="training"
          status={status}
          elapsedMs={elapsedMs}
          remainingMs={null}
          overtime={false}
          turnCount={turns.filter((t) => t.speaker === 'trainee').length}
          runtime={{ backend: 'server', degraded: false }}
          online
          reconnectAttempt={0}
          onPauseResume={noop}
          onRestart={reset}
          onEnd={reset}
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
              openingContext={script.opening.speaker === 'persona' ? script.opening.text : undefined}
              activeAgent={null}
              agentActivityAtMs={0}
              turnCount={turns.filter((t) => t.speaker === 'trainee').length}
              voiceEnabled={false}
              micLive={false}
              muted
              vadActive={false}
              captionsEnabled={false}
              onSend={handleSend}
              onPushToTalk={noop}
              onToggleMic={noop}
              onPauseResume={noop}
              onRestart={reset}
              onEnd={reset}
              onToggleCaptions={noop}
              onOpenTranscript={noop}
              onReportIssue={noop}
              onOpenAudioDevice={noop}
            />
          }
          right={
            <PersonaColumn
              className="h-full max-h-full"
              layout="stage-fill"
              mode="training"
              scenarioName={script.scenarioTitle}
              difficulty={script.difficulty}
              learningObjectives={script.learningObjectives}
              restrictedTopics={script.restrictedTopics}
              personaName={script.personaName}
              personaGender={script.personaGender}
              personaAge={script.personaAge}
              personaSubtitle={script.personaOccupation}
              speaking={speaking}
              listening={false}
              thinking={status === 'processing'}
              requiredTalkingPoints={[]}
              keyObjections={[]}
              successCondition=""
              remainingMs={null}
              overtime={false}
              scenarioPhase="opening"
              turns={turns}
              personaState={personaState}
              personaStateUpdating={false}
              personaHistory={[]}
              timelineMarkers={[]}
              startedAtMs={startRef.current}
              elapsedMs={elapsedMs}
              coachInsights={insights}
              suppressedCoachCount={0}
            />
          }
        />
      </div>
    </>
  );
}
