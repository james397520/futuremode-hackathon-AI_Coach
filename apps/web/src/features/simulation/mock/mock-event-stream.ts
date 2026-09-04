/**
 * Scripted `StreamingEvent` generator — spec §59 核心 Demo 情境.
 *
 * Replays the insurance-sales demo end to end with realistic timing:
 *   opening → needs discovery → main price objection
 *   → compliance warning triggered by an over-promise
 *   → hidden-need reveal → trust rising past 70 → closing → session.completed
 *
 * It also deliberately exercises the awkward paths the real backend will produce:
 *   - partial-then-final text for both ASR and LLM output (§49.2)
 *   - a `knowledge.citation` that arrives BEFORE its transcript turn
 *   - a `runtime.fallback` mid-session (§62)
 *
 * The stream is interactive: a `message.send` command satisfies the next trainee
 * beat with the user's real text. If the user says nothing, autopilot plays the
 * scripted line so the demo drives itself on a projector.
 */
import type {
  AgentName,
  Citation,
  ClientCommand,
  CoachInsight,
  ComplianceFinding,
  ID,
  PersonaSimulationState,
  SessionMode,
  SkillKey,
  StreamingEvent,
  TranscriptTurn,
} from '@ai-coach/shared-types';

import { MOCK_CITATIONS, MOCK_COVERAGE_CITATION } from './mock-session';

/** 44-byte silent WAV so the transcript's audio replay control is real, not a dead link. */
const SILENT_AUDIO =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

export interface MockEventStreamOptions {
  sessionId: ID;
  mode?: SessionMode;
  onEvent: (event: StreamingEvent) => void;
  /** How long to wait for the trainee before autopilot types the scripted line. */
  autopilotMs?: number;
  /** Multiplier for every delay — 0.5 halves the demo length. */
  speed?: number;
}

export interface MockEventStream {
  start: () => void;
  stop: () => void;
  send: (command: ClientCommand) => void;
  readonly running: boolean;
}

// ---------------------------------------------------------------------------
// Script model
// ---------------------------------------------------------------------------

type Beat =
  | { kind: 'emit'; delay: number; make: (ctx: BeatContext) => StreamingEvent | StreamingEvent[] }
  | {
      kind: 'persona';
      delay: number;
      turnId: ID;
      text: string;
      intent?: string;
      thinkingAgent?: AgentName;
      citations?: Citation[];
      stateDelta?: Partial<PersonaSimulationState>;
    }
  | {
      kind: 'trainee';
      turnId: ID;
      scriptedText: string;
      intent?: string;
      scoreEvent?: { skill: SkillKey; delta: number };
    };

interface BeatContext {
  sessionId: ID;
  nextSeq: () => number;
  now: () => number;
}

function personaState(patch: Partial<PersonaSimulationState>): PersonaSimulationState {
  return {
    scenario_phase: 'opening',
    emotion: 'neutral',
    trust: 42,
    interest: 34,
    resistance: 58,
    patience: 74,
    intent: 'greeting',
    current_goal: '先確認對方今天要談什麼',
    hidden_need_revealed: false,
    compliance_risk: 'safe',
    ...patch,
  };
}

const HINT_INSIGHT: Omit<CoachInsight, 'session_id' | 'timestamp_ms'> = {
  id: 'insight-1',
  kind: 'hint',
  title: '客戶只給了 15 分鐘的心理預算',
  body: '先取得「一起檢視保單」的同意，不要進入商品說明。把這一輪的目標設成拿到檢視同意就好。',
  allowed_in_assessment: false,
};

const MISSED_SIGNAL_INSIGHT: Omit<CoachInsight, 'session_id' | 'timestamp_ms'> = {
  id: 'insight-2',
  kind: 'missed_signal',
  title: '客戶兩次提到「每個月又多一筆錢」',
  body: '這是家庭現金流的焦慮，不是嫌貴。先回應財務壓力，會比介紹商品規格更有效。',
  allowed_in_assessment: false,
};

const STRATEGY_INSIGHT: Omit<CoachInsight, 'session_id' | 'timestamp_ms'> = {
  id: 'insight-3',
  kind: 'next_strategy',
  title: '下一步：先問可接受的月預算',
  body: '信任度已經過 70，客戶願意評估。先確認可接受的月預算上限，再回頭排保障順序，不要急著 Closing。',
  allowed_in_assessment: false,
};

const POST_SESSION_INSIGHT: Omit<CoachInsight, 'session_id' | 'timestamp_ms'> = {
  id: 'insight-4',
  kind: 'post_session',
  title: '本次關鍵：你自己更正了「保證」用語',
  body: '主動更正讓信任度從 46 回到 62。下一次請直接用「宣告利率非保證、可能變動」的句型，避免先講錯再補救。',
  allowed_in_assessment: true,
};

const FALSE_PROMISE_FINDING: Omit<ComplianceFinding, 'session_id' | 'timestamp_ms'> = {
  id: 'finding-1',
  type: 'false_promise',
  severity: 'high',
  transcript_turn_id: 'turn-t3',
  evidence: '這張保單保證每年至少有 6% 的報酬，等於保費會自己長回來。',
  policy_rule: '業務員合規行為指引 §1.2 — 不得以「保證報酬率」等文字使要保人誤信收益確定。',
  explanation:
    '宣告利率並非保證項目，會隨市場調整。以「保證每年至少 6%」招攬屬於不實承諾，也超出商品手冊 p.12 的說明範圍。',
  suggested_correction:
    '改為：「這部分是宣告利率，不是保證的，會變動；真正保證的是保障內容。」並引用商品手冊 p.12。',
  reviewer_status: 'open',
};

const SCRIPT: Beat[] = [
  {
    kind: 'emit',
    delay: 350,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'session.started',
      state: 'ready',
      server_time: new Date().toISOString(),
    }),
  },
  {
    kind: 'emit',
    delay: 250,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'persona.state.updated',
      state: personaState({}),
    }),
  },
  {
    kind: 'persona',
    delay: 900,
    turnId: 'turn-p1',
    thinkingAgent: 'scenario_director',
    intent: 'guarded_opening',
    text: '不好意思，我時間有點趕。你們公司我上次買過一張壽險了，今天是要推新的嗎？',
  },
  {
    kind: 'trainee',
    turnId: 'turn-t1',
    intent: 'reframe_opening',
    scriptedText:
      '陳先生您好，謝謝您撥時間。今天不是要推商品，我想先花五分鐘確認您現有的保障夠不夠用；如果夠，我就直接跟您說夠了。',
  },
  {
    kind: 'emit',
    delay: 500,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'agent.thinking',
        agent: 'coach',
      },
    ],
  },
  {
    kind: 'emit',
    delay: 700,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'coach.insight',
      insight: { ...HINT_INSIGHT, session_id: ctx.sessionId, timestamp_ms: ctx.now() },
    }),
  },
  {
    kind: 'emit',
    delay: 300,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'persona.state.updated',
      state: personaState({
        scenario_phase: 'needs_discovery',
        emotion: 'curious',
        trust: 48,
        interest: 46,
        resistance: 50,
        patience: 70,
        intent: 'cautious_openness',
        current_goal: '看看檢視保單要花多久',
      }),
    }),
  },
  {
    kind: 'persona',
    delay: 650,
    turnId: 'turn-p2',
    intent: 'conditional_agreement',
    text: '檢視保單…好，那你要看什麼？我保額多少我自己也記不太清楚。',
  },
  {
    kind: 'trainee',
    turnId: 'turn-t2',
    intent: 'needs_discovery',
    scoreEvent: { skill: 'needs_discovery', delta: 6 },
    scriptedText:
      '我們先看兩件事：一是家裡每個月的固定支出，二是如果收入中斷，這些支出還撐得住幾個月。您和太太都有收入嗎？',
  },
  {
    kind: 'emit',
    delay: 420,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'agent.thinking',
      agent: 'knowledge',
    }),
  },
  {
    kind: 'emit',
    delay: 480,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'score.updated',
      skill: 'needs_discovery',
      score: 78,
      confidence: 0.71,
    }),
  },
  {
    kind: 'emit',
    delay: 200,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'persona.state.updated',
      state: personaState({
        scenario_phase: 'needs_discovery',
        emotion: 'curious',
        trust: 54,
        interest: 58,
        resistance: 44,
        patience: 68,
        intent: 'sharing_context',
        current_goal: '搞清楚自己的缺口到底在哪',
      }),
    }),
  },
  {
    kind: 'persona',
    delay: 700,
    turnId: 'turn-p3',
    intent: 'context_disclosure',
    citations: MOCK_COVERAGE_CITATION,
    text: '我太太是兼職，主要收入是我。房貸還有十八年…你這樣一問，我也不確定撐不撐得住。',
  },
  {
    kind: 'emit',
    delay: 900,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'runtime.fallback',
      from: 'ready',
      to: 'wasm',
      reason: 'WebGPU adapter lost — continuing on local CPU',
    }),
  },
  {
    kind: 'emit',
    delay: 260,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'persona.state.updated',
      state: personaState({
        scenario_phase: 'objection_handling',
        emotion: 'skeptical',
        trust: 52,
        interest: 60,
        resistance: 68,
        patience: 60,
        intent: 'price_objection',
        current_goal: '確認自己不需要多花錢',
        budget: 2500,
      }),
    }),
  },
  {
    kind: 'persona',
    delay: 600,
    turnId: 'turn-p4',
    intent: 'price_objection',
    text: '不過講到加保，我還是覺得——我已經有保險了，為什麼還要多買？每個月又多一筆錢。',
  },
  {
    kind: 'trainee',
    turnId: 'turn-t3',
    intent: 'price_objection_handling',
    // The deliberate over-promise that triggers the compliance layer.
    scriptedText:
      '我理解。其實這張保單保證每年至少有 6% 的報酬，等於保費會自己長回來，不算多花錢。',
  },
  {
    kind: 'emit',
    delay: 380,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'agent.thinking',
      agent: 'compliance',
    }),
  },
  {
    kind: 'emit',
    delay: 520,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'compliance.warning',
        finding: { ...FALSE_PROMISE_FINDING, session_id: ctx.sessionId, timestamp_ms: ctx.now() },
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'knowledge.citation',
        turn_id: 'turn-t3',
        citations: MOCK_CITATIONS,
      },
    ],
  },
  {
    kind: 'emit',
    delay: 260,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'persona.state.updated',
        state: personaState({
          scenario_phase: 'objection_handling',
          emotion: 'frustrated',
          trust: 46,
          interest: 58,
          resistance: 74,
          patience: 52,
          intent: 'distrust_spike',
          current_goal: '確認這個人有沒有在誇大',
          budget: 2500,
          compliance_risk: 'medium',
        }),
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'coach.insight',
        insight: { ...MISSED_SIGNAL_INSIGHT, session_id: ctx.sessionId, timestamp_ms: ctx.now() },
      },
    ],
  },
  {
    kind: 'persona',
    delay: 620,
    turnId: 'turn-p5',
    intent: 'challenge_claim',
    text: '保證 6%？我上次聽到有人這樣講，後來根本不是這樣。你確定？',
  },
  {
    kind: 'trainee',
    turnId: 'turn-t4',
    intent: 'self_correction',
    scoreEvent: { skill: 'trust_building', delta: 8 },
    scriptedText:
      '我更正一下，剛剛講「保證」是不精確的：宣告利率不是保證的，會變動；真正保證的是保障內容。我更想確認的是——萬一收入中斷，孩子的教育安排會不會被迫改變？',
  },
  {
    // Arrives BEFORE turn-p6 exists — exercises the pending-citation path.
    kind: 'emit',
    delay: 300,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'knowledge.citation',
      turn_id: 'turn-p6',
      citations: MOCK_COVERAGE_CITATION,
    }),
  },
  {
    kind: 'emit',
    delay: 420,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'persona.state.updated',
      state: personaState({
        scenario_phase: 'objection_handling',
        emotion: 'interested',
        trust: 62,
        interest: 72,
        resistance: 52,
        patience: 66,
        intent: 'hidden_need_reveal',
        current_goal: '確認孩子的教育不會被影響',
        budget: 2500,
        hidden_need_revealed: true,
        compliance_risk: 'medium',
      }),
    }),
  },
  {
    kind: 'persona',
    delay: 700,
    turnId: 'turn-p6',
    intent: 'hidden_need_reveal',
    text: '…其實我最怕的就是這個。老大明年要上小學，如果我出事，我不知道他們會不會得搬回中南部。',
  },
  {
    kind: 'emit',
    delay: 420,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'score.updated',
        skill: 'empathy',
        score: 86,
        confidence: 0.82,
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'score.updated',
        skill: 'trust_building',
        score: 84,
        confidence: 0.79,
      },
    ],
  },
  {
    kind: 'trainee',
    turnId: 'turn-t5',
    intent: 'goal_alignment',
    scriptedText:
      '那我們把目標放在這裡：讓孩子的教育安排，不會因為任何一年的收入中斷而改變。我先算最低需要多少保障，再回頭看保費能不能落在您可接受的範圍。',
  },
  {
    kind: 'emit',
    delay: 450,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'persona.state.updated',
        state: personaState({
          scenario_phase: 'closing',
          emotion: 'ready',
          // Trust crosses the §59 success threshold of 70 here.
          trust: 74,
          interest: 80,
          resistance: 30,
          patience: 70,
          intent: 'ready_to_evaluate',
          current_goal: '知道一個月要多少錢',
          budget: 2500,
          hidden_need_revealed: true,
          compliance_risk: 'low',
        }),
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'coach.insight',
        insight: { ...STRATEGY_INSIGHT, session_id: ctx.sessionId, timestamp_ms: ctx.now() },
      },
    ],
  },
  {
    kind: 'persona',
    delay: 620,
    turnId: 'turn-p7',
    intent: 'budget_disclosure',
    text: '好，那你幫我算一下，一個月大概多少？我可以接受的差不多是兩千五。',
  },
  {
    kind: 'trainee',
    turnId: 'turn-t6',
    intent: 'closing',
    scoreEvent: { skill: 'goal_achievement', delta: 10 },
    scriptedText:
      '兩千五我們就用這個上限來排。我會給您兩個版本：一個把保障做滿，一個先顧最重要的收入替代，兩個都不含任何保證收益的說法。',
  },
  {
    kind: 'emit',
    delay: 500,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'score.updated',
        skill: 'goal_achievement',
        score: 84,
        confidence: 0.88,
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'score.updated',
        skill: 'compliance',
        score: 62,
        confidence: 0.94,
      },
    ],
  },
  {
    kind: 'emit',
    delay: 400,
    make: (ctx) => [
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'persona.state.updated',
        state: personaState({
          scenario_phase: 'ended',
          emotion: 'reassured',
          trust: 78,
          interest: 82,
          resistance: 24,
          patience: 72,
          intent: 'agreed_next_step',
          current_goal: '等試算結果',
          budget: 2500,
          hidden_need_revealed: true,
          compliance_risk: 'low',
        }),
      },
      {
        seq: ctx.nextSeq(),
        session_id: ctx.sessionId,
        at_ms: ctx.now(),
        type: 'coach.insight',
        insight: { ...POST_SESSION_INSIGHT, session_id: ctx.sessionId, timestamp_ms: ctx.now() },
      },
    ],
  },
  {
    kind: 'emit',
    delay: 900,
    make: (ctx) => ({
      seq: ctx.nextSeq(),
      session_id: ctx.sessionId,
      at_ms: ctx.now(),
      type: 'session.completed',
      evaluation_id: 'eval-demo-1',
    }),
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** Split CJK-friendly: small fixed-size slices so partials look like real streaming. */
function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) {
    out.push(chars.slice(i, i + size).join(''));
  }
  return out;
}

export function createMockEventStream(options: MockEventStreamOptions): MockEventStream {
  const { sessionId, onEvent, autopilotMs = 16_000, speed = 1 } = options;

  let seq = 0;
  let index = 0;
  let running = false;
  let paused = false;
  let finished = false;
  let awaitingTrainee: Extract<Beat, { kind: 'trainee' }> | null = null;
  const timers = new Set<number>();
  /** Persona turns whose deltas were already streamed — replay must not double the text. */
  const streamedPersonaTurns = new Set<ID>();

  const ctx: BeatContext = {
    sessionId,
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => Date.now(),
  };

  const scaled = (ms: number): number => Math.max(16, Math.round(ms * (speed > 0 ? speed : 1)));

  const later = (ms: number, fn: () => void): void => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!running || paused) return;
      fn();
    }, scaled(ms));
    timers.add(id);
  };

  const emit = (event: StreamingEvent | StreamingEvent[]): void => {
    const list = Array.isArray(event) ? event : [event];
    for (const e of list) {
      try {
        onEvent(e);
      } catch {
        // A rendering error downstream must not kill the stream.
      }
    }
  };

  const makeTurn = (
    id: ID,
    speaker: TranscriptTurn['speaker'],
    text: string,
    extra?: Partial<TranscriptTurn>,
  ): TranscriptTurn => ({
    id,
    session_id: sessionId,
    speaker,
    text,
    timestamp_ms: Date.now(),
    audio_url: SILENT_AUDIO,
    ...extra,
  });

  const playTrainee = (beat: Extract<Beat, { kind: 'trainee' }>, text: string, stream: boolean): void => {
    const finalise = (): void => {
      emit({
        seq: ctx.nextSeq(),
        session_id: sessionId,
        at_ms: Date.now(),
        type: 'speech.final',
        turn: makeTurn(beat.turnId, 'trainee', text, {
          intent: beat.intent,
          score_event: beat.scoreEvent,
        }),
      });
      awaitingTrainee = null;
      index += 1;
      later(500, runNext);
    };

    if (!stream) {
      finalise();
      return;
    }

    // Autopilot types the line as partial ASR first (§49.2).
    emit({
      seq: ctx.nextSeq(),
      session_id: sessionId,
      at_ms: Date.now(),
      type: 'speech.started',
      speaker: 'trainee',
    });
    const pieces = chunkText(text, 6);
    let assembled = '';
    pieces.forEach((piece, i) => {
      later(120 * (i + 1), () => {
        assembled += piece;
        emit({
          seq: ctx.nextSeq(),
          session_id: sessionId,
          at_ms: Date.now(),
          type: 'speech.partial',
          speaker: 'trainee',
          text: assembled,
        });
      });
    });
    later(120 * (pieces.length + 1), finalise);
  };

  const playPersona = (beat: Extract<Beat, { kind: 'persona' }>): void => {
    const finalisePersona = (): void => {
      emit({
        seq: ctx.nextSeq(),
        session_id: sessionId,
        at_ms: Date.now(),
        type: 'agent.response.final',
        turn: makeTurn(beat.turnId, 'persona', beat.text, {
          intent: beat.intent,
          citations: beat.citations,
          state_delta: beat.stateDelta,
        }),
      });
      index += 1;
      later(320, runNext);
    };

    // Resuming after a pause mid-utterance: jump to the final turn instead of
    // replaying deltas (partials accumulate, so replaying would double the text).
    if (streamedPersonaTurns.has(beat.turnId)) {
      finalisePersona();
      return;
    }
    streamedPersonaTurns.add(beat.turnId);

    emit({
      seq: ctx.nextSeq(),
      session_id: sessionId,
      at_ms: Date.now(),
      type: 'agent.thinking',
      agent: beat.thinkingAgent ?? 'customer',
    });

    later(420, () => {
      emit({
        seq: ctx.nextSeq(),
        session_id: sessionId,
        at_ms: Date.now(),
        type: 'speech.started',
        speaker: 'persona',
      });

      const pieces = chunkText(beat.text, 5);
      pieces.forEach((piece, i) => {
        later(90 * (i + 1), () => {
          emit({
            seq: ctx.nextSeq(),
            session_id: sessionId,
            at_ms: Date.now(),
            type: 'agent.response.partial',
            turn_id: beat.turnId,
            delta: piece,
          });
        });
      });

      later(90 * (pieces.length + 1) + 160, finalisePersona);
    });
  };

  function runNext(): void {
    if (!running || paused || finished) return;
    const beat = SCRIPT[index];
    if (!beat) {
      finished = true;
      return;
    }

    if (beat.kind === 'emit') {
      later(beat.delay, () => {
        emit(beat.make(ctx));
        index += 1;
        runNext();
      });
      return;
    }

    if (beat.kind === 'persona') {
      later(beat.delay, () => playPersona(beat));
      return;
    }

    // Trainee beat: wait for a real message, or autopilot the scripted line.
    awaitingTrainee = beat;
    later(autopilotMs, () => {
      if (awaitingTrainee !== beat) return;
      playTrainee(beat, beat.scriptedText, true);
    });
  }

  const clearTimers = (): void => {
    if (typeof window === 'undefined') return;
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
  };

  return {
    get running() {
      return running;
    },

    start() {
      if (running) return;
      running = true;
      paused = false;
      finished = false;
      runNext();
    },

    stop() {
      running = false;
      clearTimers();
    },

    send(command: ClientCommand) {
      if (!running) return;
      switch (command.type) {
        case 'message.send': {
          const pending = awaitingTrainee;
          if (pending) {
            clearTimers();
            playTrainee(pending, command.text, false);
          } else {
            // Off-script input still produces a turn so the UI never swallows text.
            emit({
              seq: ctx.nextSeq(),
              session_id: sessionId,
              at_ms: Date.now(),
              type: 'speech.final',
              turn: makeTurn(`turn-free-${seq}`, 'trainee', command.text, { intent: 'free_form' }),
            });
            later(900, () => {
              emit({
                seq: ctx.nextSeq(),
                session_id: sessionId,
                at_ms: Date.now(),
                type: 'agent.thinking',
                agent: 'customer',
              });
            });
          }
          break;
        }

        case 'session.pause': {
          paused = true;
          clearTimers();
          emit({
            seq: ctx.nextSeq(),
            session_id: sessionId,
            at_ms: Date.now(),
            type: 'session.paused',
          });
          break;
        }

        case 'session.resume': {
          if (!paused) break;
          paused = false;
          emit({
            seq: ctx.nextSeq(),
            session_id: sessionId,
            at_ms: Date.now(),
            type: 'session.resumed',
          });
          runNext();
          break;
        }

        case 'session.end': {
          clearTimers();
          finished = true;
          emit({
            seq: ctx.nextSeq(),
            session_id: sessionId,
            at_ms: Date.now(),
            type: 'session.completed',
            evaluation_id: 'eval-demo-1',
          });
          break;
        }

        case 'coach.request_hint': {
          emit({
            seq: ctx.nextSeq(),
            session_id: sessionId,
            at_ms: Date.now(),
            type: 'coach.insight',
            insight: {
              id: `insight-ondemand-${seq}`,
              session_id: sessionId,
              timestamp_ms: Date.now(),
              kind: 'hint',
              title: '把「多買」換成「補缺口」',
              body: '陳先生反對的是「再多一筆支出」。先量化缺口月數，再談保費，順序反過來會卡住。',
              allowed_in_assessment: false,
            },
          });
          break;
        }

        case 'voice.push_to_talk':
        case 'client.intent_hint':
        case 'ack':
          break;

        default: {
          const exhaustive: never = command;
          void exhaustive;
          break;
        }
      }
    },
  };
}
