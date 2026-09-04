/**
 * Typed REST client for the FastAPI orchestrator (§56 endpoints, §69 route shape).
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ NO API KEYS CLIENT-SIDE. EVER.                                            │
 * │                                                                           │
 * │ OpenAI / ElevenLabs / vector-DB credentials live only on the API server    │
 * │ (§56 / §70 / §71). This module must never gain an `Authorization: Bearer   │
 * │ <provider key>` header, never read a `NEXT_PUBLIC_*_API_KEY`, and never    │
 * │ talk to a model provider directly. The browser is authenticated with an    │
 * │ HttpOnly, SameSite session cookie — hence `credentials: 'include'` and no  │
 * │ token handling here at all. next.config.mjs pins `connect-src` to our own  │
 * │ origins so a regression here fails loudly instead of silently exfiltrating.│
 * └───────────────────────────────────────────────────────────────────────────┘
 */
import type {
  Assignment,
  AuditEvent,
  Chunk,
  Citation,
  ComplianceFinding,
  Evaluation,
  ID,
  KnowledgeBase,
  KnowledgeDocument,
  Persona,
  Question,
  Scenario,
  SessionMode,
  SkillProfile,
  Team,
  TrainingSession,
  TranscriptTurn,
  User,
  Workspace,
} from '@ai-coach/shared-types';
import type { RuntimeTelemetry } from '@ai-coach/shared-types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

/** Normalised failure — every call rejects with exactly this shape (§94). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly recoverable: boolean;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    recoverable?: boolean;
    details?: unknown;
    requestId?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    // 括號是必要的：`??` 與 `||` 不能混用而不加括號（TS5076）。
    // 語意＝顯式給的優先，否則 5xx 與 429 視為可重試。
    this.recoverable = init.recoverable ?? (init.status >= 500 || init.status === 429);
    this.details = init.details;
    this.requestId = init.requestId;
  }

  /** User-facing copy — never leak stack traces or provider errors (§94). */
  get userMessage(): string {
    switch (this.status) {
      case 401:
        return 'Your session expired. Please sign in again.';
      case 403:
        return 'You do not have permission to do that in this workspace.';
      case 404:
        return 'We could not find that item. It may have been moved or archived.';
      case 409:
        return 'Someone else changed this item. Reload and try again.';
      case 413:
        return 'That file is larger than this workspace allows.';
      case 429:
        return 'Too many requests. Give it a moment and try again.';
      default:
        return this.status >= 500
          ? 'The AI service is temporarily unavailable. Your work has been kept.'
          : this.message;
    }
  }
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** FormData for signed uploads — skips JSON serialisation. */
  form?: FormData;
  signal?: AbortSignal;
  /** Next.js fetch cache hint; server state is otherwise owned by TanStack Query. */
  cache?: RequestCache;
  headers?: Record<string, string>;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { query, body, form, signal, cache, headers } = options;

  const init: RequestInit = {
    method,
    // Session cookie is HttpOnly + SameSite; no bearer token ever touches JS.
    credentials: 'include',
    signal,
    cache: cache ?? 'no-store',
    headers: {
      Accept: 'application/json',
      ...(form ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  };

  if (form) init.body = form;
  else if (body !== undefined) init.body = JSON.stringify(body);

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the AI service.',
      recoverable: true,
      details: cause,
    });
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined);

  if (!response.ok) {
    const envelope = (payload ?? {}) as {
      code?: string;
      detail?: string | { code?: string; message?: string };
      message?: string;
      errors?: unknown;
    };
    const detail = typeof envelope.detail === 'object' ? envelope.detail : undefined;
    throw new ApiError({
      status: response.status,
      code: envelope.code ?? detail?.code ?? `http_${response.status}`,
      message:
        detail?.message ??
        (typeof envelope.detail === 'string' ? envelope.detail : undefined) ??
        envelope.message ??
        response.statusText ??
        'Request failed',
      details: envelope.errors ?? payload,
      requestId,
    });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions) => request<T>('POST', path, options),
  patch: <T>(path: string, options?: RequestOptions) => request<T>('PATCH', path, options),
  put: <T>(path: string, options?: RequestOptions) => request<T>('PUT', path, options),
  del: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

/* ────────────────────────── typed endpoint helpers (§69) ───────────────────── */

export interface CreateSessionInput {
  scenario_id: ID;
  mode: SessionMode;
  voice_enabled: boolean;
  score_live_enabled: boolean;
  /** Client-detected backend; the server stays authoritative (§55). */
  runtime_hint?: 'webgpu' | 'wasm' | 'server';
}

export interface RetrievalTestInput {
  knowledge_base_id: ID;
  query: string;
  top_k: number;
  threshold: number;
  hybrid: boolean;
  rerank: boolean;
}

export interface RetrievalTestResult {
  query: string;
  latency_ms: number;
  citations: Citation[];
}

export interface SessionReviewPayload {
  session: TrainingSession;
  transcript: TranscriptTurn[];
  evaluation?: Evaluation;
  findings: ComplianceFinding[];
}

export const endpoints = {
  /* --- auth / workspace --- */
  me: () => api.get<User>('/api/auth/me'),
  workspaces: () => api.get<Workspace[]>('/api/workspaces'),
  selectWorkspace: (workspaceId: ID) =>
    api.post<{ ok: true }>('/api/workspaces/select', { body: { workspace_id: workspaceId } }),
  logout: () => api.post<void>('/api/auth/logout'),

  /* --- sessions (§69) --- */
  createSession: (input: CreateSessionInput) =>
    api.post<TrainingSession>('/api/sessions', { body: input }),
  getSession: (id: ID) => api.get<TrainingSession>(`/api/sessions/${id}`),
  sendSessionMessage: (id: ID, text: string) =>
    api.post<{ turn_id: ID }>(`/api/sessions/${id}/message`, { body: { text } }),
  endSession: (id: ID) => api.post<{ evaluation_id?: ID }>(`/api/sessions/${id}/end`),
  getSessionReview: (id: ID) => api.get<SessionReviewPayload>(`/api/sessions/${id}/review`),
  listSessions: (query?: Query) => api.get<Paginated<TrainingSession>>('/api/sessions', { query }),

  /* --- personas (§69) --- */
  listPersonas: (query?: Query) => api.get<Paginated<Persona>>('/api/personas', { query }),
  getPersona: (id: ID) => api.get<Persona>(`/api/personas/${id}`),
  createPersona: (body: Partial<Persona>) => api.post<Persona>('/api/personas', { body }),
  updatePersona: (id: ID, body: Partial<Persona>) =>
    api.patch<Persona>(`/api/personas/${id}`, { body }),

  /* --- scenarios --- */
  listScenarios: (query?: Query) => api.get<Paginated<Scenario>>('/api/scenarios', { query }),
  getScenario: (id: ID) => api.get<Scenario>(`/api/scenarios/${id}`),
  saveScenario: (id: ID | null, body: Partial<Scenario>) =>
    id ? api.patch<Scenario>(`/api/scenarios/${id}`, { body }) : api.post<Scenario>('/api/scenarios', { body }),

  /* --- knowledge (§69) --- */
  listKnowledgeBases: () => api.get<KnowledgeBase[]>('/api/knowledge'),
  getKnowledgeBase: (id: ID) => api.get<KnowledgeBase>(`/api/knowledge/${id}`),
  listDocuments: (kbId: ID, query?: Query) =>
    api.get<Paginated<KnowledgeDocument>>(`/api/knowledge/${kbId}/documents`, { query }),
  /** Multipart upload; the server issues signed storage URLs (§73). */
  uploadDocuments: (kbId: ID, form: FormData) =>
    api.post<KnowledgeDocument[]>(`/api/knowledge/${kbId}/documents`, { form }),
  reprocessDocument: (kbId: ID, docId: ID) =>
    api.post<KnowledgeDocument>(`/api/knowledge/${kbId}/documents/${docId}/reprocess`),
  listChunks: (kbId: ID, query?: Query) =>
    api.get<Paginated<Chunk>>(`/api/knowledge/${kbId}/chunks`, { query }),
  updateChunk: (kbId: ID, chunkId: ID, body: Partial<Chunk>) =>
    api.patch<Chunk>(`/api/knowledge/${kbId}/chunks/${chunkId}`, { body }),
  testRetrieval: (body: RetrievalTestInput) =>
    api.post<RetrievalTestResult>('/api/retrieval/test', { body }),

  /* --- question bank --- */
  listQuestions: (query?: Query) => api.get<Paginated<Question>>('/api/questions', { query }),
  getQuestion: (id: ID) => api.get<Question>(`/api/questions/${id}`),
  saveQuestion: (id: ID | null, body: Partial<Question>) =>
    id ? api.patch<Question>(`/api/questions/${id}`, { body }) : api.post<Question>('/api/questions', { body }),
  generateQuestions: (body: {
    knowledge_base_id: ID;
    topics: string[];
    types: Question['type'][];
    difficulty: Question['difficulty'];
    count: number;
  }) => api.post<Question[]>('/api/questions/generate', { body }),
  /** §15 / §38 — AI output cannot publish itself. */
  reviewQuestion: (id: ID, body: { decision: 'approve' | 'reject'; note?: string }) =>
    api.post<Question>(`/api/questions/${id}/review`, { body }),

  /* --- assignments / training --- */
  listAssignments: (query?: Query) => api.get<Paginated<Assignment>>('/api/assignments', { query }),
  createAssignment: (body: Partial<Assignment>) =>
    api.post<Assignment>('/api/assignments', { body }),

  /* --- reports (§69) --- */
  getReport: (id: ID) => api.get<Evaluation>(`/api/reports/${id}`),
  getSkillProfile: (userId: ID) => api.get<SkillProfile>(`/api/reports/users/${userId}/skills`),
  getTeamReport: (query?: Query) => api.get<unknown>('/api/reports/team', { query }),
  getComplianceReport: (query?: Query) =>
    api.get<Paginated<ComplianceFinding>>('/api/reports/compliance', { query }),

  /* --- team / security / audit --- */
  listUsers: (query?: Query) => api.get<Paginated<User>>('/api/users', { query }),
  listTeams: () => api.get<Team[]>('/api/teams'),
  listFindings: (query?: Query) => api.get<Paginated<ComplianceFinding>>('/api/security/findings', { query }),
  listAuditEvents: (query?: Query) => api.get<Paginated<AuditEvent>>('/api/audit', { query }),

  /* --- integrations / runtime --- */
  listIntegrations: () => api.get<unknown[]>('/api/integrations'),
  testIntegration: (id: ID) => api.post<{ ok: boolean; message: string }>(`/api/integrations/${id}/test`),
  /** §93 — admin-only runtime telemetry. */
  getRuntimeTelemetry: () => api.get<RuntimeTelemetry>('/api/runtime/telemetry'),
} as const;
