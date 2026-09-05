/**
 * 狀態機定義 — spec §92 / §23 / §29.
 * 前後端共用；UI 只能顯示這裡列出的狀態。
 */

/** Live Simulation session lifecycle（§92 Session / §23 Session states） */
export const SESSION_STATES = [
  'idle',
  'connecting',
  'ready',
  'listening',
  'transcribing',
  'processing',
  'persona_speaking',
  'paused',
  'reconnecting',
  'completed',
  'error',
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** 文件處理 pipeline（§92 Document / §11.3） */
export const DOCUMENT_STATES = [
  'uploaded',
  'validating',
  'parsing',
  'chunking',
  'embedding',
  'indexing',
  'ready',
  'failed',
] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

/** 本地推論 runtime（§92 WebGPU） */
export const RUNTIME_STATES = [
  'unknown',
  'detecting',
  'supported',
  'loading',
  'ready',
  'degraded',
  'fallback',
] as const;
export type RuntimeState = (typeof RUNTIME_STATES)[number];

/** 內容審核流程（§38 / §14 / §15） */
export const CONTENT_STATUSES = [
  'draft',
  'generated',
  'review_required',
  'approved',
  'published',
  'archived',
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Training vs Assessment（§8.4）— 決定是否允許 Hint / Coach / Knowledge peek */
export type SessionMode = 'training' | 'assessment';

/** §18 Difficulty Engine */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** §9 RBAC */
export const ROLES = ['trainee', 'coach', 'manager', 'admin', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];
