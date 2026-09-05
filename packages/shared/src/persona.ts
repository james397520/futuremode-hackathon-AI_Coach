/**
 * Persona 模擬狀態 — spec §20 / §67.
 * 右側 Persona State Card 必須完全由這個 state 驅動，UI 不得自行推測（§20 註記）。
 */

export type PersonaEmotion =
  | 'neutral'
  | 'curious'
  | 'skeptical'
  | 'frustrated'
  | 'interested'
  | 'reassured'
  | 'ready';

export type ScenarioPhase =
  | 'opening'
  | 'needs_discovery'
  | 'presentation'
  | 'objection_handling'
  | 'closing'
  | 'ended';

export type ComplianceRisk = 'safe' | 'low' | 'medium' | 'high' | 'critical';

/** 0–100 的模擬變數（§4.1 Dynamic Scenario Agent） */
export interface PersonaSimulationState {
  scenario_phase: ScenarioPhase;
  emotion: PersonaEmotion;
  trust: number;
  interest: number;
  resistance: number;
  patience: number;
  /** 目前偵測到的學員意圖 / persona 意圖，例如 "price_objection" */
  intent: string;
  current_goal: string;
  budget?: number;
  hidden_need_revealed: boolean;
  compliance_risk: ComplianceRisk;
  time_pressure?: number;
}

/** Persona Builder sliders（§16.2） */
export interface PersonaTraits {
  trust: number;
  patience: number;
  price_sensitivity: number;
  risk_aversion: number;
  product_knowledge: number;
  resistance: number;
  openness: number;
}

/** Persona 隱藏設定（§16.3）— 絕不可傳到前端未授權角色 */
export interface PersonaHiddenState {
  primary_goal: string;
  hidden_need: string;
  main_concern: string;
  budget?: number;
  trigger_points: string[];
  objections: string[];
  forbidden_knowledge: string[];
  opening_attitude: string;
  exit_condition: string;
  success_condition: string;
}
