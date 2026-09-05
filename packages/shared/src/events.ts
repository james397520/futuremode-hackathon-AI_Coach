/**
 * WebSocket Streaming Event Schema — spec §55 / §68.
 * 這是 realtime 契約：後端 emit、前端 reduce，兩邊都不得私自新增未定義事件。
 */
import type { PersonaSimulationState } from './persona';
import type {
  Citation, CoachInsight, ComplianceFinding, ID, SkillKey, TranscriptTurn,
} from './entities';
import type { RuntimeState, SessionState } from './state-machines';

interface EventBase {
  /** 單調遞增，用於補洞與重連續傳 */
  seq: number;
  session_id: ID;
  at_ms: number;
}

export type StreamingEvent =
  | (EventBase & { type: 'session.started'; state: SessionState; server_time: string })
  | (EventBase & { type: 'session.paused' })
  | (EventBase & { type: 'session.resumed' })
  | (EventBase & { type: 'session.completed'; evaluation_id?: ID })
  | (EventBase & { type: 'speech.started'; speaker: 'trainee' | 'persona' })
  | (EventBase & { type: 'speech.partial'; speaker: 'trainee' | 'persona'; text: string })
  | (EventBase & { type: 'speech.final'; turn: TranscriptTurn })
  | (EventBase & { type: 'agent.thinking'; agent: AgentName })
  | (EventBase & { type: 'agent.response.partial'; turn_id: ID; delta: string })
  | (EventBase & { type: 'agent.response.final'; turn: TranscriptTurn })
  | (EventBase & { type: 'persona.state.updated'; state: PersonaSimulationState })
  | (EventBase & { type: 'coach.insight'; insight: CoachInsight })
  /**
   * 學員情緒（文字 + 臉部融合）。文字那路有逐字證據可稽核，臉部那路是瀏覽器端
   * 未校準的規則分數；兩者衝突時以文字為準並標記 conflict，不做平均。
   */
  | (EventBase & { type: 'trainee.affect.updated'; affect: TraineeAffect })
  | (EventBase & { type: 'knowledge.citation'; turn_id: ID; citations: Citation[] })
  | (EventBase & { type: 'score.updated'; skill: SkillKey; score: number; confidence: number })
  | (EventBase & { type: 'compliance.warning'; finding: ComplianceFinding })
  | (EventBase & { type: 'runtime.fallback'; from: RuntimeState; to: 'wasm' | 'server'; reason: string })
  | (EventBase & { type: 'connection.reconnecting'; attempt: number })
  | (EventBase & { type: 'session.error'; code: string; message: string; recoverable: boolean });

export type StreamingEventType = StreamingEvent['type'];

export type AffectLabel = '平穩' | '緊張' | '不耐煩' | '挫折' | '正向' | '不明確';
export type AffectIntensity = 'low' | 'medium' | 'high' | 'unknown';

export interface TraineeAffect {
  label: AffectLabel;
  intensity: AffectIntensity;
  confidence: number;
  /** 文字與臉部各有話說但說法不同。 */
  conflict: boolean;
  source: 'text' | 'face' | 'both' | 'none';
  text?: {
    label: AffectLabel;
    intensity: AffectIntensity;
    evidence_quote: string;
    reason: string;
    suggestion: string;
  } | null;
  face?: { raw_label: string; label: AffectLabel; confidence: number; at_ms: number } | null;
  evidence_quote: string;
  suggestion: string;
}

/** §19 Multi-Agent 名稱 — thinking indicator 與 telemetry 都用這組 */
export const AGENT_NAMES = [
  'orchestrator', 'scenario_director', 'customer', 'coach',
  'knowledge', 'evaluator', 'compliance',
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/** 前端 → 後端（同一條 socket） */
export type ClientCommand =
  | { type: 'message.send'; text: string }
  | { type: 'session.pause' }
  | { type: 'session.resume' }
  | { type: 'session.end' }
  | { type: 'coach.request_hint' }
  | { type: 'voice.push_to_talk'; pressed: boolean }
  | { type: 'client.intent_hint'; intent: string; confidence: number }
  /**
   * 學員臉部情緒（§webcam channel）。只送標籤與信心值，**永遠不送影像**：
   * 辨識在瀏覽器端完成，畫面不離開裝置。與 intent_hint 一樣是 advisory，
   * 後端只當提示，不當事實。
   */
  | { type: 'trainee.affect'; label: string; confidence: number; at_ms: number }
  | { type: 'ack'; seq: number };
