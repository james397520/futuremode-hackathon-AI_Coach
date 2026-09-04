# API reference

The REST and WebSocket surface of the AI Orchestration API (spec §56, §68, §69).

**The live OpenAPI document at `/docs` (and `/openapi.json`) is the authoritative
source.** It is generated from the same Pydantic models the handlers use, so it cannot
drift from the implementation; this page is a navigable map of that surface, the auth and
error contracts, and the realtime protocol that OpenAPI cannot describe. Both are disabled
when `APP_ENV=production`.

## Contents

- [Base URL and versioning](#base-url-and-versioning)
- [Authentication](#authentication)
- [Authorisation](#authorisation)
- [Error envelope](#error-envelope)
- [Rate limiting](#rate-limiting)
- [Conventions](#conventions)
- [Resource routes](#resource-routes)
- [Realtime: the session WebSocket](#realtime-the-session-websocket)
- [`StreamingEvent` reference](#streamingevent-reference)
- [`ClientCommand` reference](#clientcommand-reference)
- [A worked turn](#a-worked-turn)
- [curl examples](#curl-examples)
- [The contract source of truth](#the-contract-source-of-truth)

## Base URL and versioning

```text
http://localhost:8000/api/v1          REST
ws://localhost:8000/api/v1/…/ws       session socket
```

The prefix comes from `API_PREFIX` (default `/api/v1`). Spec §69 writes its examples
unversioned (`POST /api/sessions`); this deployment mounts the same shapes under an
explicit version prefix so the contract can evolve without breaking a deployed client.

Health probes sit **outside** the prefix and are unauthenticated:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | liveness; process state only, touches no dependency |
| `GET` | `/readyz` | readiness; probes Postgres, Redis, Qdrant and object storage in parallel with a 3 s timeout, `503` when any is down |

Breaking changes get a new prefix (`/api/v2`); additive fields do not.

## Authentication

Cookie-based, with a double-submit CSRF token. Implemented in
`apps/api/app/core/security.py` and `apps/api/app/core/deps.py`.

### The cookies

| Cookie | Default name | Attributes | Contents |
|---|---|---|---|
| session | `aicoach_session` | `HttpOnly`, `Secure` (relaxed only for plain-HTTP local), `SameSite=Lax`, path `/` | HS256 access token, 15 min |
| CSRF | `aicoach_csrf` | **not** `HttpOnly`, `Secure`, `SameSite=Lax`, path `/` | `<nonce>.<HMAC(nonce, jti)>` |
| refresh | `aicoach_refresh` | `HttpOnly`, `Secure`, **`SameSite=Strict`**, path `/api/v1/auth/refresh` | refresh token, 14 days |

The access token is `HttpOnly` so page JavaScript — and therefore XSS — cannot read it.
The CSRF cookie is deliberately readable so the SPA can echo it.

Token claims are short to keep the cookie small: `sub` user, `tid` tenant, `wid`
workspace, `rls` roles, `tms` team ids, `typ`, `jti`, `iat`, `exp`, `iss`. A refresh token
carries a different `typ` and **no** role or workspace claims, so it cannot be replayed as
an access token, and refresh re-derives privileges from the database — which makes the
access-token TTL the effective role-revocation window.

### CSRF

Every cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE` must send the CSRF cookie's
value in the `X-CSRF-Token` header. Cookie and header must be byte-equal *and* validly
signed; the HMAC is bound to the session's `jti`, so a token minted for one session is
useless for another. Failure is `403 csrf_invalid`.

Two deliberate exemptions:

- **`POST /auth/refresh`** — the refresh cookie is `SameSite=Strict` and scoped to that
  one path, so a cross-site POST cannot reach it with the cookie attached at all.
- **Bearer clients** — a service client sending `Authorization: Bearer <access token>`
  needs no CSRF token, because there is no ambient credential to abuse.

### The flow

```text
POST /auth/login      { email, password }        → sets session + csrf + refresh cookies
POST /auth/workspace  { workspace_id }           → re-mints the token with wid + roles
GET  /auth/me                                    → identity, permissions, workspaces
POST /auth/refresh                               → new access token from the refresh cookie
POST /auth/logout                                → clears all three cookies
```

`POST /auth/login` returns `LoginResponse`: `{ user, workspaces[], csrf_token,
expires_at }`. A user in more than one workspace must call `/auth/workspace` before
workspace-scoped endpoints work — otherwise they return `400 workspace_scope_required`.

`LoginResponse.csrf_token` exists so a client that cannot read cookies (a native app) can
still take part in the double-submit scheme.

### WebSocket authentication

The socket accepts the same session cookie, or an `Authorization: Bearer` header for
service clients. Differences from HTTP, both deliberate:

- **No token in the query string.** It would land in access logs and proxy history.
- **No CSRF token, but an `Origin` allowlist check** against `CORS_ALLOW_ORIGINS`.
  Browsers do not apply same-origin policy to WebSockets, so without this check any site
  could open an authenticated socket.

Authentication and authorisation both happen **before** `accept()`, so an unauthorised
socket is closed with a policy code (1008) and never observes an event.

## Authorisation

Routers declare a `Permission`, never a role. The §9 matrix lives in exactly one place,
`ROLE_PERMISSIONS` in `apps/api/app/core/deps.py`. Roles are additive — a user may hold
several.

| Role | Scope |
|---|---|
| `trainee` | run assigned training, review own results |
| `coach` | everything a trainee can do, plus authoring (scenario, persona, rubric, questions, knowledge), transcript review, score override, persona hidden state, content publish |
| `manager` | assign training, team review and benchmark, risk view, report read and export |
| `reviewer` | flagged-session review, compliance review, rubric and compliance-rule approval, finding closure, audit read |
| `admin` | every permission — §9.4 defines admin as full workspace control |

Tenant isolation is structural, not a filter convention (spec §74). A resource belonging to
another tenant returns **`404 not_found`**, never `403`, so the API does not confirm that
it exists; the audit trail records the real reason. See
[`architecture.md`](architecture.md#81-tenant-isolation).

## Error envelope

Every failure — validation, RBAC, provider, unhandled — leaves the API in one shape
(`apps/api/app/core/errors.py`):

```json
{
  "type": "https://docs.ai-coach.local/errors/rbac_denied",
  "title": "Not permitted",
  "status": 403,
  "code": "rbac_denied",
  "detail": "Your role does not allow this action.",
  "request_id": "9f1c…",
  "recoverable": false,
  "errors": [{ "field": "body.name", "message": "Field required" }]
}
```

- `detail` is **caller-safe text only**. Database messages, stack traces, SQL, provider
  payloads, file paths and prompt content never appear. The unhandled-exception handler
  logs the traceback server-side and returns a fixed sentence.
- `errors[]` is populated for validation failures with the field location and the
  validator message; the offending input value is dropped so request bodies (which may
  contain transcript text or PII) never reach a response or a log.
- `recoverable` mirrors `session.error.recoverable` in the streaming contract, so a client
  can choose an inline notice over a blocking modal.
- `request_id` is echoed in the `X-Request-ID` response header and ties the response to
  the API log line, the nginx access-log line and the `AuditEvent` row.

### Codes

`code` is part of the client contract — the web app switches on it, and
`session.error.code` reuses the same vocabulary.

| Code | Status | Meaning |
|---|---|---|
| `unauthenticated` | 401 | no or unusable credential |
| `invalid_credentials` | 401 | login failed; deliberately does not say whether the account exists |
| `token_expired` | 401 | past `exp`; refresh |
| `token_invalid` | 401 | bad signature, wrong issuer, wrong `typ` |
| `csrf_invalid` | 403 | double-submit check failed |
| `rbac_denied` | 403 | the caller's roles lack the permission |
| `knowledge_acl_denied` | 403 | not on the knowledge base ACL (§39) |
| `workspace_scope_required` | 400 | select a workspace first |
| `not_found` | 404 | absent — **or** owned by another tenant (§74) |
| `conflict` | 409 | state conflicts with the request |
| `version_conflict` | 409 | optimistic concurrency failure on a versioned entity (§38) |
| `validation_failed` | 422 | payload invalid; see `errors[]` |
| `unsupported_media_type` | 415 | file type cannot be ingested |
| `payload_too_large` | 413 | over the upload ceiling |
| `session_state_invalid` | 409 | the §92 state machine forbids the transition |
| `assessment_mode_restricted` | 403 | hints and coach help are off during an assessment (§8.4/§24) |
| `content_not_published` | 409 | trainees may only run published content (§38) |
| `safety_blocked` | 422 | the safety service blocked the request (§40.1) |
| `retrieval_unavailable` | 503 | retrieval is temporarily down |
| `rate_limited` | 429 | with a `Retry-After` header |
| `quota_exceeded` | 402 | workspace usage quota exhausted (§46) |
| `provider_unavailable` | 502 | upstream LLM/TTS/STT failure; provider detail stays server-side |
| `provider_timeout` | 504 | upstream did not answer in time |
| `service_unavailable` | 503 | a dependency is unavailable |
| `not_implemented` | 501 | capability absent from this deployment |
| `internal_error` | 500 | logged with a traceback, reported without one |

`TenantIsolationError` reports `not_found` / 404 on purpose — see
[Authorisation](#authorisation).

## Rate limiting

A Redis token bucket, refill-and-take in one atomic Lua script so it is correct across API
replicas (spec §40.3, §49.4). A caller may burst to the bucket capacity and then settles to
the refill rate.

- Global defaults: `RATE_LIMIT_DEFAULT_PER_MINUTE` (120) and
  `RATE_LIMIT_MUTATING_PER_MINUTE` (30); `RATE_LIMIT_ENABLED` turns the whole thing off.
- Most routes declare their own budget, which is what actually applies. Notable ones:
  `auth.login` 10/min, `questions.generate` 6/min, `reports.generate` 12/min,
  `integrations.test` 12/min, `sessions.create` 12/min, `sessions.message` 60/min,
  `retrieval.test` 30/min. The full set is in the [route tables](#resource-routes).
- Over budget → `429 rate_limited` with `Retry-After`.
- **Failure policy:** limiters **fail open** when Redis is unavailable, and log loudly, so
  a cache outage cannot take the product down — *except* credential endpoints, which fail
  **closed** so an unavailable limiter never becomes a free brute-force window.
- nginx adds an independent edge layer: 20 r/s (burst 40) on `/api/`, 5 r/m on
  `/api/v1/auth/(login|refresh|password)`, and 8 concurrent WebSocket connections per IP.

## Conventions

- **Content type** `application/json`, serialised with `orjson`.
- **Lists** return `Page<T>`: `{ items, total, limit, offset }`, with `limit` 1–200
  (default 50) and `offset` ≥ 0 as query parameters.
- **Deletes** return `Acknowledgement` rather than 204, so the audit id can travel with the
  response.
- **Long-running work** returns `202 Accepted` with `DocumentJobAccepted`
  (`{ document_id, job_id, state }`); poll the document.
- **Idempotency** — `POST /sessions/{id}/message` accepts `idempotency_key` so a retried
  turn is not replayed (§49.4).
- **Uploads never stream through the API.** `POST
  /knowledge-bases/{id}/documents` returns a `SignedUploadResponse`
  (`{ document_id, upload_url, method, headers, fields, storage_key, expires_at,
  max_size_bytes }`); the browser `PUT`s to object storage, then calls
  `POST /documents/{id}/ingest` (§73).
- **A `POST` that reads.** `POST /audit/events` and `POST /reports/team-analytics` are
  queries with bodies too large and too sensitive for a query string; personal data must
  never appear in a URL.

## Resource routes

Grouped by the §56 surface. `Permission` is what the router declares; the roles that hold
it follow from [`ROLE_PERMISSIONS`](#authorisation). All paths are relative to
`/api/v1`. `RL` is the per-route budget in requests per minute.

### `/auth`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `POST` | `/auth/login` | public | `LoginRequest` `{email, password}` | `LoginResponse` | 10 |
| `POST` | `/auth/workspace` | authenticated | `SelectWorkspaceRequest` `{workspace_id}` | `LoginResponse` | 30 |
| `POST` | `/auth/refresh` | refresh cookie | — | `LoginResponse` | 60 |
| `GET` | `/auth/me` | authenticated | — | `SessionIdentityResponse` `{user, permissions[], workspaces[]}` | — |
| `POST` | `/auth/logout` | authenticated | — | `Acknowledgement` | 30 |

### `/workspaces`, `/users`, `/teams`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `GET` | `/workspaces` | `workspace.read` | — | `WorkspaceResponse[]` | 120 |
| `POST` | `/workspaces` | `workspace.admin` | `WorkspaceCreateRequest` | `WorkspaceResponse` (201) | 10 |
| `PATCH` | `/workspaces/{workspace_id}` | `workspace.admin` | `WorkspaceUpdateRequest` | `WorkspaceResponse` | 20 |
| `GET` | `/users` | `user.read` | — | `Page<UserResponse>` | 120 |
| `GET` | `/users/{user_id}` | `user.read` | — | `UserResponse` | — |
| `POST` | `/users` | `user.admin` | `UserCreateRequest` | `UserResponse` (201) | 20 |
| `PATCH` | `/users/{user_id}` | `user.admin` | `UserUpdateRequest` | `UserResponse` | 40 |
| `PUT` | `/users/{user_id}/roles` | `role.admin` | `RoleAssignmentRequest` | `UserResponse` | 20 |
| `DELETE` | `/users/{user_id}` | `user.admin` | — | `Acknowledgement` (deactivate, not erase) | 10 |
| `GET` | `/teams` | `team.read` | — | `Page<TeamResponse>` | 120 |
| `GET` | `/teams/{team_id}` | `team.read` | — | `TeamResponse` | — |
| `POST` | `/teams` | `team.admin` | `TeamCreateRequest` | `TeamResponse` (201) | 20 |
| `PATCH` | `/teams/{team_id}` | `team.admin` | `TeamUpdateRequest` | `TeamResponse` | 40 |
| `POST` | `/teams/{team_id}/members` | `team.admin` | `TeamMembershipRequest` `{user_ids[]}` | `TeamResponse` | 40 |
| `DELETE` | `/teams/{team_id}/members/{user_id}` | `team.admin` | — | `TeamResponse` | 40 |
| `DELETE` | `/teams/{team_id}` | `team.admin` | — | `Acknowledgement` | 10 |

### `/knowledge-bases`, `/documents`, `/chunks`, `/retrieval`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `GET` | `/knowledge-bases` | `knowledge.read` | — | `Page<KnowledgeBaseResponse>` | 120 |
| `GET` | `/knowledge-bases/{id}` | `knowledge.read` | — | `KnowledgeBaseResponse` | — |
| `POST` | `/knowledge-bases` | `knowledge.write` | `KnowledgeBaseCreateRequest` | `KnowledgeBaseResponse` (201) | 20 |
| `PATCH` | `/knowledge-bases/{id}` | `knowledge.write` | `KnowledgeBaseUpdateRequest` | `KnowledgeBaseResponse` | 40 |
| `PUT` | `/knowledge-bases/{id}/acl` | `knowledge.acl_admin` | `KnowledgeAclUpdateRequest` | `KnowledgeBaseResponse` | 20 |
| `POST` | `/knowledge-bases/{id}/review` | `content.publish` | `ContentReviewRequest` `{status, note?}` | `KnowledgeBaseResponse` | 30 |
| `DELETE` | `/knowledge-bases/{id}` | `knowledge.write` | — | `Acknowledgement` | 10 |
| `GET` | `/knowledge-bases/{id}/documents` | `knowledge.read` | — | `Page<DocumentResponse>` | 120 |
| `POST` | `/knowledge-bases/{id}/documents` | `knowledge.write` | `DocumentUploadRequest` | `SignedUploadResponse` (201) | 30 |
| `POST` | `/knowledge-bases/{id}/documents/url` | `knowledge.write` | `DocumentUrlIngestRequest` | `DocumentJobAccepted` (202) | 20 |
| `POST` | `/documents/{document_id}/ingest` | `knowledge.write` | `DocumentIngestRequest` | `DocumentJobAccepted` (202) | 30 |
| `GET` | `/documents/{document_id}` | `knowledge.read` | — | `DocumentResponse` | — |
| `GET` | `/documents/{document_id}/versions` | `knowledge.read` | — | `DocumentVersion[]` | — |
| `POST` | `/documents/{document_id}/reprocess` | `knowledge.write` | `DocumentIngestRequest` | `DocumentJobAccepted` (202) | 10 |
| `DELETE` | `/documents/{document_id}` | `knowledge.write` | — | `Acknowledgement` | 20 |
| `GET` | `/chunks` | `knowledge.read` | — | `Page<ChunkResponse>` | 180 |
| `GET` | `/chunks/{chunk_id}` | `knowledge.read` | — | `ChunkResponse` | — |
| `PATCH` | `/chunks/{chunk_id}` | `knowledge.write` | `ChunkUpdateRequest` | `ChunkResponse` | 60 |
| `DELETE` | `/chunks/{chunk_id}` | `knowledge.write` | — | `Acknowledgement` | 30 |
| `POST` | `/retrieval/test` | `retrieval.test` | `RetrievalTestRequest` | `RetrievalTestResponse` | 30 |

`RetrievalTestRequest` is `{ query, knowledge_base_ids[], top_k=8, use_reranker=true,
rerank_top_n=5, min_similarity=0.0, filters{} }`; the response carries `hits[]` (each with
a `Citation`, text, token count, tags) plus `embedding_ms`, `search_ms`, `rerank_ms`,
`total_ms`, `embedding_model` and `reranker_model`. The query text itself is **not**
audited or logged — only which knowledge bases were searched and how many hits came back
(§49.5).

### `/questions`, `/personas`, `/scenarios` (+ rubrics), `/assignments`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `GET` | `/questions` | `question.read` | — | `Page<Question>` | 180 |
| `GET` | `/questions/{id}` | `question.read` | — | `Question` | — |
| `POST` | `/questions` | `question.write` | `QuestionCreateRequest` | `Question` (201) | 60 |
| `PATCH` | `/questions/{id}` | `question.write` | `QuestionUpdateRequest` | `Question` | 60 |
| `POST` | `/questions/generate` | `question.write` | `QuestionGenerateRequest` | `QuestionGenerateResponse` (201) | 6 |
| `POST` | `/questions/{id}/review` | `content.publish` | `ContentReviewRequest` | `Question` | 60 |
| `DELETE` | `/questions/{id}` | `question.write` | — | `Acknowledgement` | 30 |
| `GET` | `/personas` | `persona.read` | — | `Page<PersonaResponse>` | 180 |
| `GET` | `/personas/{id}` | `persona.read` | — | `PersonaResponse` | — |
| `POST` | `/personas` | `persona.write` | `PersonaCreateRequest` | `PersonaResponse` (201) | 30 |
| `PATCH` | `/personas/{id}` | `persona.write` | `PersonaUpdateRequest` | `PersonaResponse` | 60 |
| `POST` | `/personas/{id}/test` | `persona.write` | `PersonaTestRequest` | `PersonaTestResponse` | 20 |
| `POST` | `/personas/{id}/review` | `content.publish` | `ContentReviewRequest` | `PersonaResponse` | 30 |
| `DELETE` | `/personas/{id}` | `persona.write` | — | `Acknowledgement` | 20 |
| `GET` | `/scenarios` | `scenario.read` | — | `Page<ScenarioResponse>` | 180 |
| `GET` | `/scenarios/{id}` | `scenario.read` | — | `ScenarioResponse` | — |
| `GET` | `/scenarios/{id}/versions` | `scenario.read` | — | `ScenarioVersion[]` | — |
| `POST` | `/scenarios` | `scenario.write` | `ScenarioCreateRequest` | `ScenarioResponse` (201) | 30 |
| `PATCH` | `/scenarios/{id}` | `scenario.write` | `ScenarioUpdateRequest` | `ScenarioResponse` | 60 |
| `POST` | `/scenarios/{id}/review` | `content.publish` | `ContentReviewRequest` | `ScenarioResponse` | 30 |
| `DELETE` | `/scenarios/{id}` | `scenario.write` | — | `Acknowledgement` | 20 |
| `GET` | `/scenarios/rubrics` | `rubric.read` | — | `Page<Rubric>` | 120 |
| `GET` | `/scenarios/rubrics/{id}` | `rubric.read` | — | `Rubric` | — |
| `POST` | `/scenarios/rubrics` | `rubric.write` | `RubricCreateRequest` | `Rubric` (201) | 20 |
| `PATCH` | `/scenarios/rubrics/{id}` | `rubric.write` | `RubricUpdateRequest` | `Rubric` | 40 |
| `POST` | `/scenarios/rubrics/{id}/approve` | `rubric.approve` | `ContentReviewRequest` | `Rubric` | 20 |
| `GET` | `/assignments` | `assignment.view_assigned` | — | `Page<AssignmentResponse>` | 120 |
| `GET` | `/assignments/{id}` | `assignment.view_assigned` | — | `AssignmentResponse` | — |
| `GET` | `/assignments/{id}/progress` | `team.review` | — | `AssignmentProgressRow[]` | 60 |
| `POST` | `/assignments` | `assignment.write` | `AssignmentCreateRequest` | `AssignmentResponse` (201) | 30 |
| `PATCH` | `/assignments/{id}` | `assignment.write` | `AssignmentUpdateRequest` | `AssignmentResponse` | 40 |
| `DELETE` | `/assignments/{id}` | `assignment.write` | — | `Acknowledgement` | 20 |

Rubric routes live under `/scenarios/rubrics` — literal paths are declared before
`/{scenario_id}` so the parameter cannot shadow them.

### `/sessions`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `POST` | `/sessions` | `session.start` | `SessionCreateRequest` | `SessionResponse` (201) | 12 |
| `GET` | `/sessions` | `result.view_own` | — | `Page<TrainingSession>` | 120 |
| `GET` | `/sessions/{id}` | `result.view_own` | — | `SessionResponse` | — |
| `POST` | `/sessions/{id}/message` | `session.participate` | `SessionMessageRequest` | `SessionMessageResponse` | 60 |
| `POST` | `/sessions/{id}/hint` | `session.participate` | `CoachHintRequest` | `CoachInsight` | 20 |
| `POST` | `/sessions/{id}/pause` | `session.participate` | — | `TrainingSession` | 60 |
| `POST` | `/sessions/{id}/resume` | `session.participate` | — | `TrainingSession` | 60 |
| `POST` | `/sessions/{id}/end` | `session.participate` | `SessionEndRequest` | `SessionEndResponse` | 30 |
| `GET` | `/sessions/{id}/transcript` | `result.view_own` | — | `SessionTranscriptResponse` | 60 |
| `GET` | `/sessions/{id}/events` | `result.view_own` | — | `StreamingEvent[]` | 120 |
| `GET` | `/sessions/{id}/evaluation` | `result.view_own` | — | `Evaluation` | — |
| `POST` | `/sessions/{id}/evaluation/override` | `evaluation.override` | `EvaluationOverrideRequest` | `Evaluation` | 30 |
| `WS` | `/sessions/{id}/ws` | session cookie or bearer + `Origin` check | `ClientCommand` frames | `StreamingEvent` frames | 8 conns/IP at the edge |

Details worth knowing:

- `SessionCreateRequest` is `{ scenario_id, assignment_id?, mode?, voice_enabled=false,
  score_live_enabled=false, runtime='server', capability? }`. `scenario_version` and
  `persona_version` are **resolved and pinned server-side** — a client cannot choose them,
  so a completed session's report stays reproducible (§54). `mode` defaults to the
  scenario's; assessment mode cannot be relaxed.
- `SessionResponse` carries `websocket_url` (the relative WS path for this session) and
  `resume_from_seq`, plus `runtime_policy` and `coach_enabled` (false in assessment mode).
  **Use `websocket_url` rather than constructing the path yourself.**
- `POST /sessions/{id}/message` is the documented HTTP **fallback** for the socket (§69).
  It returns everything the UI must reconcile in one body: `trainee_turn`, `persona_turn`,
  `persona_state`, `citations[]`, `coach_insight?`, `scores[]`, `compliance_findings[]`
  and the `seq` the socket would have used.
- `POST /sessions/{id}/hint` returns `403 assessment_mode_restricted` during an
  assessment.
- An evaluation override is stored **alongside** the AI score, never replacing it (§28).
- `GET /sessions/{id}/events` replays persisted events for review and replay (§30); it is
  also how a client reconciles after a `replay_gap`.

### `/reports`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `GET` | `/reports` | `report.read` | — | `Page<ReportResponse>` | 120 |
| `POST` | `/reports` | `report.read` | `ReportGenerateRequest` | `ReportResponse` (201) | 12 |
| `GET` | `/reports/{report_id}` | `report.read` | — | `ReportResponse` | — |
| `POST` | `/reports/{report_id}/export` | `report.export` | `ReportExportRequest` | `ReportExportResponse` | 12 |
| `GET` | `/reports/skill-profile/{user_id}` | `progress.view_own` | — | `SkillProfileResponse` | 60 |
| `POST` | `/reports/team-analytics` | `team.benchmark` | body | `TeamAnalyticsResponse` | 30 |

Reading another user's skill profile additionally requires a team-review permission; with
only `progress.view_own` the id must be the caller's own.

### `/security`, `/audit`, `/integrations`, `/runtime`

| Method | Path | Permission | Request | Response | RL |
|---|---|---|---|---|---|
| `GET` | `/security/overview` | `risk.view` | — | `SecurityOverviewResponse` | — |
| `GET` | `/security/findings` | `risk.view` | — | `Page<ComplianceFinding>` | — |
| `GET` | `/security/findings/{id}` | `risk.view` | — | `ComplianceFinding` | — |
| `PATCH` | `/security/findings/{id}` | `finding.close` | `ComplianceFindingUpdateRequest` | `ComplianceFinding` | 60 |
| `POST` | `/security/safety-check` | `compliance.review` | `SafetyCheckRequest` | `SafetyCheckResponse` | 30 |
| `POST` | `/audit/events` | `audit.read` | query body | `Page<AuditEvent>` | — |
| `GET` | `/audit/events/{event_id}` | `audit.read` | — | `AuditEvent` | — |
| `GET` | `/integrations` | `integration.admin` | — | `IntegrationResponse[]` | 60 |
| `PUT` | `/integrations` | `integration.admin` | `IntegrationUpsertRequest` | `IntegrationResponse` | 20 |
| `POST` | `/integrations/{id}/test` | `integration.admin` | — | `IntegrationTestResponse` | 12 |
| `DELETE` | `/integrations/{id}` | `integration.admin` | — | `IntegrationResponse` | 20 |
| `GET` | `/runtime/policy` | `runtime.read` | — | `RuntimePolicy` | 120 |
| `POST` | `/runtime/capability` | `runtime.read` | `ComputeCapability` | `RuntimePolicyResponse` | 60 |
| `PATCH` | `/runtime/policy` | `runtime.policy_write` | `RuntimePolicyUpdateRequest` | `RuntimePolicy` | 20 |
| `POST` | `/runtime/telemetry` | `runtime.telemetry_write` | `RuntimeTelemetryRequest` | `Acknowledgement` | 120 |

`POST /runtime/capability` takes the browser's `ComputeCapability` (§59) and returns a
backend recommendation; `POST /runtime/telemetry` accepts operational fields only —
backend, model id, load ms, last inference ms, worker status, fallback reason. Content is
excluded by the type system, not by convention (see [`model.md`](model.md#telemetry)).
An integration's credential is write-only: it is never echoed back by
`IntegrationResponse`.

## Realtime: the session WebSocket

One socket carries a whole live simulation: `ClientCommand` frames up,
`StreamingEvent` frames down. Server: `apps/api/app/ws/gateway.py` and
`apps/api/app/ws/events.py`. Client: `apps/web/src/lib/ws-client.ts`.

```text
GET  /api/v1/sessions/{session_id}/ws        Upgrade: websocket
     Cookie: aicoach_session=…               (or Authorization: Bearer …)
     Origin: https://coach.example.com       must be in CORS_ALLOW_ORIGINS
     ?after_seq=<n>                          optional, resume point
```

### Handshake

1. The token is verified and the `Origin` checked **before** `accept()`. Failure closes
   with **1008** (policy violation) and a short reason; no event is ever sent.
2. The session is loaded and authorised against the caller's tenant and workspace. A
   session belonging to another tenant is indistinguishable from one that does not exist.
3. `accept()`.
4. If `after_seq > 0`, missed events are replayed (below), then the socket joins the live
   stream.
5. `session.started` carries the authoritative `SessionState` and `server_time`.

Both directions are JSON text frames. Every server frame carries `seq` (monotonic per
session, starting at 1), `session_id` and `at_ms`.

### Sequencing and acknowledgement

`seq` comes from a single counter per session: `INCR ws:session:{id}:seq` in Redis, so two
API replicas serving one session still produce one gap-free sequence. Without Redis (tests,
single-process development) an in-process counter guarded by a lock does the same job —
which is only correct with one replica.

The client sends `{ "type": "ack", "seq": n }` so the server can trim its replay buffer;
`apps/web/src/lib/ws-client.ts` does this automatically for every accepted event. A gap
between the expected and received `seq` is surfaced to the consumer rather than papered
over: reconcile with `GET /sessions/{id}/events` or the transcript endpoint.

### Reconnect and resume

The last `256` events per session are kept in a bounded ring buffer, mirrored to a Redis
list, with a TTL.

```text
disconnect
  → client emits connection.reconnecting locally, backs off with jitter
  → reconnect with ?after_seq=<highest seq seen>
  → server replays every buffered event with seq > after_seq, oldest first
  → live stream resumes
```

If the gap is larger than the buffer the server says so explicitly with
`session.error` and `code: "replay_gap"` rather than silently skipping events; the client
must then refetch state over REST. Client defaults: 8 attempts, 600 ms base delay, 15 s
ceiling.

### Liveness and shutdown

- Server heartbeat every 20 s; a client that sends nothing at all for 120 s is dropped.
- A malformed or failing command never kills the loop: it is reported as `session.error`
  and reading continues. Only a disconnect, an explicit `session.end`, or cancellation
  ends the session loop.
- Close codes: **1000** normal, **1008** policy violation (auth, origin, authorisation),
  **1011** internal error.

> **Current status.** Two live gaps in the realtime path:
>
> - `sessions.py` calls `session_ws_endpoint(websocket, session_id, ctx=…,
>   session_factory=…)`, but the gateway's signature accepts `token`, `after_seq`,
>   `emitters`, `authenticate` and `session_service_factory` — those keyword names do not
>   exist, so the call raises `TypeError`, and `after_seq` from the query string is never
>   forwarded. Resume-from-`seq` is therefore not reachable through the router yet.
> - The heartbeat frame is sent as `{"type": "connection.heartbeat", …}`, which is **not**
>   a declared `StreamingEvent`. `apps/web/src/lib/ws-client.ts` validates against the
>   declared union and will drop it as unknown, and `scripts/check-contracts.sh` does not
>   catch it because it only compares `type:` literals in the two contract files.
>
> Tracked in [`roadmap.md`](roadmap.md).

## `StreamingEvent` reference

All 18 declared types, from `packages/shared/src/events.ts`. Every one extends the base
`{ seq, session_id, at_ms }`.

| # | `type` | Payload | Fires when | Client should |
|---|---|---|---|---|
| 1 | `session.started` | `state: SessionState`, `server_time: string` | the socket is accepted, or the session transitions to live | render the session as live; take `state` as authoritative over local optimism |
| 2 | `session.paused` | — | the trainee pauses, or the server pauses the session (§24) | freeze the timer, disable the composer, show the paused affordance |
| 3 | `session.resumed` | — | the session resumes | restart the timer, re-enable input |
| 4 | `session.completed` | `evaluation_id?` | the session ends (§29) | stop input; if `evaluation_id` is present fetch the evaluation, otherwise poll `GET /sessions/{id}/evaluation` because scoring is async |
| 5 | `speech.started` | `speaker: 'trainee' \| 'persona'` | voice mode: an utterance begins | show the speaking indicator for that speaker; prepare the visualiser |
| 6 | `speech.partial` | `speaker`, `text` | partial ASR arrives (§49.2) | replace the in-progress bubble's text — do **not** append; partials are cumulative rewrites |
| 7 | `speech.final` | `turn: TranscriptTurn` | the utterance is finalised | replace the partial with the real turn, keyed by `turn.id` |
| 8 | `agent.thinking` | `agent: AgentName` | an agent starts work (§19) | show a thinking indicator naming the agent; one of `orchestrator`, `scenario_director`, `customer`, `coach`, `knowledge`, `evaluator`, `compliance` |
| 9 | `agent.response.partial` | `turn_id`, `delta` | incremental LLM output | **append** `delta` to the turn identified by `turn_id`; unlike `speech.partial` this is a delta |
| 10 | `agent.response.final` | `turn: TranscriptTurn` | the persona's turn is complete | replace the streamed text with the canonical turn; clear the thinking indicator |
| 11 | `persona.state.updated` | `state: PersonaSimulationState` | emotion, trust, interest, resistance, intent or goal moves (§20/§31) | update the persona live card and push a point onto the state timeline. Incremental by design (§95) |
| 12 | `coach.insight` | `insight: CoachInsight` | the Coach agent has advice (§23) | render on the coach card. Never expect this during an assessment — coaching is disabled (§8.4) |
| 13 | `knowledge.citation` | `turn_id`, `citations: Citation[]` | the Knowledge agent grounded a claim (§12.5) | attach citation chips to that turn; each carries document, version, page, section, chunk id and score |
| 14 | `score.updated` | `skill: SkillKey`, `score: number`, `confidence: number` | live scoring is on and a skill moves (§26) | update that skill's meter and show the confidence; only when `score_live_enabled` |
| 15 | `compliance.warning` | `finding: ComplianceFinding` | the Compliance agent flags something (§32/§40.1) | surface non-blockingly and record it; it will also appear under `/security/findings` |
| 16 | `runtime.fallback` | `from: RuntimeState`, `to: 'wasm' \| 'server'`, `reason` | the inference tier steps down (§62) | show a quiet status change — **never** an error. The UI must not crash or block (§62). Note the wire field is literally `from`, aliased on the Python side |
| 17 | `connection.reconnecting` | `attempt: number` | the transport is retrying | show a reconnect notice with the attempt count; keep the transcript on screen |
| 18 | `session.error` | `code`, `message`, `recoverable` | anything went wrong mid-session | `recoverable: true` → inline notice and continue; `false` → blocking modal (§94). `code` shares the REST vocabulary, plus `replay_gap` |

Neither side may invent an undeclared event (§55). An event that exists only in a mock, or
only in the Python mirror, is a bug.

## `ClientCommand` reference

From the same file. Sent as JSON text frames on the same socket.

| `type` | Payload | Use |
|---|---|---|
| `message.send` | `text: string` | send a trainee turn. The HTTP equivalent is `POST /sessions/{id}/message` |
| `session.pause` | — | pause (§24) |
| `session.resume` | — | resume |
| `session.end` | — | end the session; the server replies `session.completed` and closes the loop |
| `coach.request_hint` | — | ask the Coach agent for a hint. Rejected in assessment mode |
| `voice.push_to_talk` | `pressed: boolean` | push-to-talk edge in voice mode |
| `client.intent_hint` | `intent: string`, `confidence: number` | the browser's local intent classification (§53). **Advisory only** — the server orchestrator decides, and a low-confidence hint should not be sent at all |
| `ack` | `seq: number` | acknowledge receipt so the server can trim its replay buffer |

Unknown command types are rejected without closing the socket.

## A worked turn

One trainee turn in text mode, live scoring on, with a knowledge-grounded persona answer.
`seq` values are illustrative but the ordering is the contract.

```text
→  { "type": "message.send", "text": "我們這張保單的月繳保費是多少？" }

←  seq 41  speech.final              turn = the trainee's turn, persisted
←  seq 42  agent.thinking            agent = "orchestrator"
←  seq 43  agent.thinking            agent = "knowledge"
←  seq 44  knowledge.citation        turn_id = t_998, citations = [產品手冊 v3 p.12 §2.1]
←  seq 45  agent.thinking            agent = "customer"
←  seq 46  agent.response.partial    turn_id = t_998, delta = "月繳的話，"
←  seq 47  agent.response.partial    turn_id = t_998, delta = "大概是三千二"
←  seq 48  agent.response.final      turn = t_998, the persona's canonical turn
←  seq 49  persona.state.updated     interest 63 → 68, intent = "price_objection"
←  seq 50  coach.insight             "先確認需求再談價格"     (absent in assessment mode)
←  seq 51  score.updated             skill = "needs_discovery", score 62, confidence 0.7
←  seq 52  compliance.warning        finding = unsupported_claim, risk = low  (only if flagged)

→  { "type": "ack", "seq": 52 }
```

Reading this as a client implementer:

- The citation can arrive **before** the text it grounds; key it by `turn_id` and hold it
  until that turn exists.
- `agent.response.partial` deltas append; `speech.partial` text replaces. Confusing the two
  produces duplicated or truncated transcripts.
- `agent.response.final` is authoritative — replace the accumulated deltas with
  `turn.text` rather than trusting your concatenation.
- Everything after the final turn (state, insight, score, findings) is independent; do not
  wait for them before rendering the answer.

## curl examples

Log in, keeping the cookie jar:

```bash
curl -sS -c /tmp/aicoach.jar -X POST http://localhost:8000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"coach@demo.ai-coach.local","password":"demo-only-not-a-secret"}'
```

Select a workspace (a mutating request, so it needs the CSRF header — read the value from
the jar):

```bash
curl -sS -b /tmp/aicoach.jar -c /tmp/aicoach.jar -X POST http://localhost:8000/api/v1/auth/workspace -H 'Content-Type: application/json' -H "X-CSRF-Token: $(awk '/aicoach_csrf/ {print $7}' /tmp/aicoach.jar)" -d '{"workspace_id":"ws_demo"}'
```

Test retrieval (a `POST`, so the CSRF header applies here too):

```bash
curl -sS -b /tmp/aicoach.jar -X POST http://localhost:8000/api/v1/retrieval/test -H 'Content-Type: application/json' -H "X-CSRF-Token: $(awk '/aicoach_csrf/ {print $7}' /tmp/aicoach.jar)" -d '{"query":"保單月繳保費","knowledge_base_ids":["kb_demo"],"top_k":5,"use_reranker":true}'
```

A plain read needs no CSRF token:

```bash
curl -sS -b /tmp/aicoach.jar 'http://localhost:8000/api/v1/sessions?limit=10&offset=0'
```

## The contract source of truth

`packages/shared/src/events.ts` is the source of truth for the realtime contract;
`apps/api/app/domain/events.py` is a Pydantic **mirror** of it. TypeScript wins, always
(see [`ADR-0002`](adr/0002-typescript-as-contract-source-of-truth.md)).

```bash
scripts/check-contracts.sh
```

The guard compares the `type:` discriminant literals in both directions and fails on any
difference, in CI as its own job. It does **not** compare field shapes — a renamed field
inside `PersonaSimulationState` passes — so a contract change is still a reviewer's
responsibility. The change protocol (TypeScript first, mirror second, both in one commit)
is in [`CONTRIBUTING.md`](../CONTRIBUTING.md) and summarised in
[`development.md`](development.md#the-cross-language-contract-workflow).

> **Current status.** `scripts/check-contracts.sh` passes and reports 26 streaming-event
> literals in sync across TypeScript and Python. It previously aborted by resolving the
> repository root one directory too high — a leftover from moving the script out of
> `infra/scripts/` — which is written up in
> [`troubleshooting.md`](troubleshooting.md#check-contractssh-reports-a-missing-eventsts)
> because the same class of bug is easy to reintroduce.
