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
} from '@ai-coach/shared';
import type { RuntimeTelemetry } from '@ai-coach/shared';

// Single source of truth — see lib/runtime-env.ts. Imported (not just
// re-exported) because `request()` joins paths against it below.
import { API_BASE_URL } from './runtime-env';

export { API_BASE_URL };

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

/**
 * What `POST /auth/login`, `POST /auth/workspace` and `GET /auth/me` return.
 *
 * Shape taken from the running API rather than guessed: the user carries the
 * roles of the *selected* workspace, and `workspaces` lists what the account may
 * switch to. `csrf_token` is re-issued on workspace selection, which is why a
 * token captured at login stops working after switching.
 */
export interface AuthSession {
  user: {
    id: ID;
    tenant_id: ID;
    workspace_id: ID | null;
    email: string;
    display_name: string;
    roles: string[];
    team_ids: ID[];
    locale: string;
  };
  workspaces: Array<{ id: ID; name: string; kind: string; roles: string[] }>;
  csrf_token: string;
  expires_at: string;
}

/** Read the double-submit CSRF cookie. Returns `{}` when there is no session. */
/**
 * Double-submit CSRF header. Exported because callers outside this module make
 * their own mutating requests (the ai-runtime telemetry reporter has its own
 * fetch) and would otherwise be rejected with 403 despite holding a session.
 */
export function csrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const match = document.cookie.match(/(?:^|;\s*)aicoach_csrf=([^;]+)/);
  return match?.[1] ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {};
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
      // Double-submit CSRF: the API sets `aicoach_csrf` as a *readable* cookie
      // precisely so the client can echo it back in a header on mutating calls.
      // Without this every POST/PATCH/DELETE comes back 403 `csrf_invalid`.
      ...(method === 'GET' ? {} : csrfHeader()),
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

/** Shape of `GET /api/v1/sessions/{id}` — the session plus everything pinned to it. */
export interface SessionEnvelope {
  session: TrainingSession;
  scenario: Scenario;
  persona: Persona;
  persona_state?: unknown;
  runtime_policy?: unknown;
  websocket_url?: string;
  resume_from_seq?: number;
  coach_enabled?: boolean;
}

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
  // Paths carry the `/v1` prefix the API actually mounts (`app/api/v1/v1`).
  // Without it every call 404s and the app silently stays on fixtures.
  login: (email: string, password: string) =>
    api.post<AuthSession>('/api/v1/auth/login', { body: { email, password } }),
  me: () => api.get<AuthSession>('/api/v1/auth/me'),
  workspaces: () => api.get<Workspace[]>('/api/v1/workspaces'),
  selectWorkspace: (workspaceId: ID) =>
    api.post<AuthSession>('/api/v1/auth/workspace', { body: { workspace_id: workspaceId } }),
  logout: () => api.post<void>('/api/v1/auth/logout'),

  /* --- sessions (§69) --- */
  /** Returns the same envelope as `getSession` (session + pinned scenario/persona). */
  createSession: (input: CreateSessionInput) =>
    api.post<SessionEnvelope>('/api/v1/sessions', { body: input }),
  /**
   * Returns the *envelope*, not a bare session: the backend's `SessionResponse`
   * carries `scenario`, `persona`, `runtime_policy` and `websocket_url` with it.
   * That matters for trainees, who have `session.read` but not `scenario.read` —
   * fetching the scenario separately 403s for exactly the people who run
   * sessions.
   */
  getSession: (id: ID) => api.get<SessionEnvelope>(`/api/v1/sessions/${id}`),
  sendSessionMessage: (id: ID, text: string) =>
    api.post<{ turn_id: ID }>(`/api/v1/sessions/${id}/message`, { body: { text } }),
  endSession: (id: ID) => api.post<{ evaluation_id?: ID }>(`/api/v1/sessions/${id}/end`),
  getSessionReview: (id: ID) => api.get<SessionReviewPayload>(`/api/v1/sessions/${id}/review`),
  listSessions: (query?: Query) => api.get<Paginated<TrainingSession>>('/api/v1/sessions', { query }),

  /* --- personas (§69) --- */
  listPersonas: (query?: Query) => api.get<Paginated<Persona>>('/api/v1/personas', { query }),
  getPersona: (id: ID) => api.get<Persona>(`/api/v1/personas/${id}`),
  createPersona: (body: Partial<Persona>) => api.post<Persona>('/api/v1/personas', { body }),
  updatePersona: (id: ID, body: Partial<Persona>) =>
    api.patch<Persona>(`/api/v1/personas/${id}`, { body }),

  /* --- scenarios --- */
  listScenarios: (query?: Query) => api.get<Paginated<Scenario>>('/api/v1/scenarios', { query }),
  getScenario: (id: ID) => api.get<Scenario>(`/api/v1/scenarios/${id}`),
  saveScenario: (id: ID | null, body: Partial<Scenario>) =>
    id ? api.patch<Scenario>(`/api/v1/scenarios/${id}`, { body }) : api.post<Scenario>('/api/v1/scenarios', { body }),

  /* --- knowledge (§69) --- */
  listKnowledgeBases: () => api.get<KnowledgeBase[]>('/api/v1/knowledge-bases'),
  getKnowledgeBase: (id: ID) => api.get<KnowledgeBase>(`/api/v1/knowledge-bases/${id}`),
  listDocuments: (kbId: ID, query?: Query) =>
    api.get<Paginated<KnowledgeDocument>>(`/api/v1/knowledge-bases/${kbId}/documents`, { query }),
  /**
   * One spoken utterance → text. The microphone never talks to a vendor from
   * the browser: audio goes to our API, which holds the key (§71). The client
   * decides whether to send the returned text as a turn.
   */
  transcribeUtterance: (
    sessionId: ID,
    blob: Blob,
    mime: string,
    engine: 'auto' | 'mac' | 'cloud' = 'auto',
  ) => {
    const form = new FormData();
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('mpeg') ? 'mp3' : 'webm';
    form.append('file', blob, `utterance.${ext}`);
    return api.post<{ text: string; provider: string; language: string }>(
      `/api/v1/sessions/${sessionId}/transcribe?engine=${engine}`,
      { form },
    );
  },
  /**
   * One persona line → MP3 from the cloud voice. Raw fetch rather than
   * `request()`: the body is audio, not JSON. Same cookie + CSRF discipline.
   */
  synthesizeSpeech: async (
    sessionId: ID,
    text: string,
    tuning: { stability: number; similarity: number; style: number; speed: number },
  ): Promise<Blob> => {
    const response = await fetch(new URL(`/api/v1/sessions/${sessionId}/speak`, API_BASE_URL), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      body: JSON.stringify({ text, ...tuning }),
    });
    if (!response.ok) throw new ApiError({ status: response.status, code: 'tts_failed', message: 'speech synthesis failed' } as never);
    return response.blob();
  },
  /** Which STT engines the deployment can offer — drives the on-device switch. */
  sttCapabilities: () =>
    api.get<{
      default: string;
      cloud: boolean;
      mac: { available: boolean; onDevice?: boolean; authorization?: string; reason?: string };
    }>('/api/v1/sessions/stt/capabilities'),
  /** Multipart upload; the server issues signed storage URLs (§73). */
  uploadDocuments: (kbId: ID, form: FormData) =>
    api.post<KnowledgeDocument[]>(`/api/v1/knowledge-bases/${kbId}/documents`, { form }),
  reprocessDocument: (kbId: ID, docId: ID) =>
    api.post<KnowledgeDocument>(`/api/v1/documents/${docId}/reprocess`),
  listChunks: (kbId: ID, query?: Query) =>
    api.get<Paginated<Chunk>>(`/api/v1/chunks`, { query }),
  updateChunk: (kbId: ID, chunkId: ID, body: Partial<Chunk>) =>
    api.patch<Chunk>(`/api/v1/chunks/${chunkId}`, { body }),
  testRetrieval: (body: RetrievalTestInput) =>
    api.post<RetrievalTestResult>('/api/v1/retrieval/test', { body }),

  /* --- question bank --- */
  listQuestions: (query?: Query) => api.get<Paginated<Question>>('/api/v1/questions', { query }),
  getQuestion: (id: ID) => api.get<Question>(`/api/v1/questions/${id}`),
  saveQuestion: (id: ID | null, body: Partial<Question>) =>
    id ? api.patch<Question>(`/api/v1/questions/${id}`, { body }) : api.post<Question>('/api/v1/questions', { body }),
  generateQuestions: (body: {
    knowledge_base_id: ID;
    topics: string[];
    types: Question['type'][];
    difficulty: Question['difficulty'];
    count: number;
  }) => api.post<Question[]>('/api/v1/questions/generate', { body }),
  /** §15 / §38 — AI output cannot publish itself. */
  reviewQuestion: (id: ID, body: { decision: 'approve' | 'reject'; note?: string }) =>
    api.post<Question>(`/api/v1/questions/${id}/review`, { body }),

  /* --- assignments / training --- */
  listAssignments: (query?: Query) => api.get<Paginated<Assignment>>('/api/v1/assignments', { query }),
  createAssignment: (body: Partial<Assignment>) =>
    api.post<Assignment>('/api/v1/assignments', { body }),

  /* --- reports (§69) --- */
  getReport: (id: ID) => api.get<Evaluation>(`/api/v1/reports/${id}`),
  getSkillProfile: (userId: ID) => api.get<SkillProfile>(`/api/v1/reports/skill-profile/${userId}`),
  getTeamReport: (query?: Query) => api.get<unknown>('/api/v1/reports/team-analytics', { query }),
  getComplianceReport: (query?: Query) =>
    api.get<Paginated<ComplianceFinding>>('/api/v1/security/findings', { query }),

  /* --- team / security / audit --- */
  listUsers: (query?: Query) => api.get<Paginated<User>>('/api/v1/users', { query }),
  listTeams: () => api.get<Team[]>('/api/v1/teams'),
  listFindings: (query?: Query) => api.get<Paginated<ComplianceFinding>>('/api/v1/security/findings', { query }),
  listAuditEvents: (query?: Query) => api.get<Paginated<AuditEvent>>('/api/v1/audit/events', { query }),

  /* --- integrations / runtime --- */
  listIntegrations: () => api.get<unknown[]>('/api/v1/integrations'),
  testIntegration: (id: ID) => api.post<{ ok: boolean; message: string }>(`/api/v1/integrations/${id}/test`),
  /** §93 — admin-only runtime telemetry. */
  getRuntimeTelemetry: () => api.get<RuntimeTelemetry>('/api/v1/runtime/telemetry'),
} as const;
