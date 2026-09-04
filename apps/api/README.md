# `apps/api` — AI Orchestration API (FastAPI)

Python FastAPI service for the AI Coach platform.
Spec: [`docs/spec/AI_Coach_Spec_v3.md`](../../docs/spec/AI_Coach_Spec_v3.md) (§63 backend
architecture, §64 stack). Ownership map:
[`docs/PROJECT_STRUCTURE.md`](../../docs/PROJECT_STRUCTURE.md) §3.

---

## 1. Layering rules

```text
app/main.py                app factory, middleware, router mount, secret boundary
app/core/                  config, logging, security, RBAC deps, errors, tenancy, audit
app/api/v1/routers/        one module per §56 path — I/O adapters only
app/api/v1/platform/       platform-layer services (identity, directory, settings)
app/domain/                Pydantic mirror of packages/shared-types
app/db/                    SQLAlchemy models, async session, alembic migrations
--------------------------------------------------------------------------------
app/services/              application services (§63)      ← Agents & RAG owner
app/agents/                multi-agent orchestration (§19/§66)
app/rag/                   parse → chunk → embed → index → retrieve → rerank (§65)
app/ws/                    WebSocket gateway + event emitter (§55/§68)
app/workers/               async document jobs
```

Hard rules, in priority order:

1. **Routers do four things**: validate the payload, authorise via the §9 permission
   matrix, call exactly one service, shape the response (plus record the §42 audit
   event). No business logic, no SQL, no LLM calls in a router.
2. **Every LLM/model behaviour lives in `app/agents/`**, every retrieval step in
   `app/rag/`, every application workflow in `app/services/`.
3. **Every agent returns structured data** whose schema is defined in `app/domain/`
   (§66). Free-form model text never crosses a layer boundary untyped.
4. **`app/domain/` mirrors `packages/shared-types` exactly** — same field names, same
   enum literal values. A change to either side is a change to both, in one commit.
5. **Provider credentials never leave this process.** `OPENAI_API_KEY` /
   `ELEVENLABS_API_KEY` are read only by `app.core.config`; no response body, header,
   cookie or error message may contain them (§56 / §70 / §71). `/integrations` accepts
   a `secret_ref` into the secrets manager, never raw credential material.
6. **Uploads and downloads are signed URLs, not proxied bytes** (§40.2 / §73).

### Platform services vs domain services

`app/api/v1/platform/` holds `IdentityService`, `DirectoryService`,
`PlatformSettingsService` and `AuditReader` — identity, workspace/user/team directory,
connector and runtime-policy persistence. They are pure tenancy/RBAC/CRUD with no model
involvement, are owned by this layer, and exist so the routers stay thin. They follow
the same construction convention as the domain services below.

---

## 2. Interface contract with `app/services`, `app/ws`, `app/rag`

Everything in this section is **imported but not implemented** by this layer. Routers
already import these exact paths and names; the Agents & RAG owner supplies the bodies.

### Construction convention

Every service and the RAG pipeline is constructed with exactly two positional
arguments:

```python
Service(db_session: AsyncSession, ctx: RequestContext)
```

* `db_session` — the request-scoped `AsyncSession` from `app.core.deps.get_db`. The §74
  isolation guard is already armed on it (the router depends on `Scope` first), so a
  query that forgets its tenant filter raises rather than returning foreign rows.
* `ctx` — `app.core.context.RequestContext`
  (`tenant_id`, `workspace_id`, `user_id`, `roles`, `request_id`, `team_ids`, `ip`,
  `session_ref`). **Never re-derive tenancy from a request body.**

Read tenant data through `app.core.tenancy.ScopedRepository` (`repo.select`, `.get`,
`.require`, `.list`, `.count`, `.add`, `.delete`) or `scoped_select(Model, scope)`.

### Modules and members the routers import

| Import path | Member |
|---|---|
| `app.services.session_service` | `SessionService` |
| `app.services.knowledge_service` | `KnowledgeService` |
| `app.services.question_service` | `QuestionService` |
| `app.services.persona_service` | `PersonaService` |
| `app.services.scenario_service` | `ScenarioService` |
| `app.services.evaluation_service` | `EvaluationService` |
| `app.services.report_service` | `ReportService` |
| `app.services.safety_service` | `SafetyService` |
| `app.ws.gateway` | `session_ws_endpoint` |
| `app.ws.events` | `EventEmitter` |
| `app.rag.pipeline` | `RagPipeline` |

### Method signatures the routers call

All DTOs come from `app.domain.request_response` unless noted. `params` is
`app.domain.common.PageParams`; list endpoints return `app.domain.common.Page[T]`.

**`SessionService`** — `app/api/v1/routers/sessions.py`

```python
async def create_session(payload: SessionCreateRequest) -> SessionResponse
async def get_session(session_id: str) -> SessionResponse
async def list_sessions(*, params: PageParams, user_id: str | None,
                        scenario_id: str | None,
                        status: SessionState | None) -> Page[TrainingSession]
async def post_message(session_id: str,
                       payload: SessionMessageRequest) -> SessionMessageResponse
async def request_hint(session_id: str, payload: CoachHintRequest) -> CoachInsight
async def pause_session(session_id: str) -> TrainingSession
async def resume_session(session_id: str) -> TrainingSession
async def end_session(session_id: str, payload: SessionEndRequest) -> SessionEndResponse
async def get_transcript(session_id: str) -> SessionTranscriptResponse
async def list_events(session_id: str, *, since_seq: int,
                      limit: int) -> list[StreamingEvent]
```

Required behaviour: pin `scenario_version` / `persona_version` at creation (§54);
reject a hint in assessment mode with `AssessmentModeRestrictedError` (§8.4/§24); force
`user_id` to the caller unless they hold `transcript.review` (§9.1); enforce the §92
state machine and raise `SessionStateError` on an illegal transition.

**`KnowledgeService`** — `knowledge_bases.py`, `documents.py`, `chunks.py`

```python
async def list_knowledge_bases(*, params: PageParams,
                               status: ContentStatus | None) -> Page[KnowledgeBaseResponse]
async def get_knowledge_base(knowledge_base_id: str) -> KnowledgeBaseResponse
async def create_knowledge_base(payload: KnowledgeBaseCreateRequest) -> KnowledgeBaseResponse
async def update_knowledge_base(knowledge_base_id: str,
                                payload: KnowledgeBaseUpdateRequest) -> KnowledgeBaseResponse
async def update_acl(knowledge_base_id: str,
                     payload: KnowledgeAclUpdateRequest) -> KnowledgeBaseResponse
async def review_knowledge_base(knowledge_base_id: str,
                                payload: ContentReviewRequest) -> KnowledgeBaseResponse
async def delete_knowledge_base(knowledge_base_id: str) -> None

async def list_documents(knowledge_base_id: str, *, params: PageParams,
                         state: DocumentState | None) -> Page[DocumentResponse]
async def create_upload(knowledge_base_id: str,
                        payload: DocumentUploadRequest) -> SignedUploadResponse
async def ingest_url(knowledge_base_id: str,
                     payload: DocumentUrlIngestRequest) -> DocumentJobAccepted
async def ingest_document(document_id: str,
                          payload: DocumentIngestRequest) -> DocumentJobAccepted
async def reprocess_document(document_id: str,
                             payload: DocumentIngestRequest) -> DocumentJobAccepted
async def get_document(document_id: str) -> DocumentResponse
async def list_document_versions(document_id: str) -> list[DocumentVersion]
async def delete_document(document_id: str) -> None

async def list_chunks(*, params: PageParams, document_id: str | None,
                      knowledge_base_id: str | None,
                      query: str | None) -> Page[ChunkResponse]
async def get_chunk(chunk_id: str) -> ChunkResponse
async def update_chunk(chunk_id: str, payload: ChunkUpdateRequest) -> ChunkResponse
async def delete_chunk(chunk_id: str) -> None
```

Required behaviour: apply the §39 ACL on every read (a base the caller cannot `view` must
not appear in a list); `create_upload` returns a pre-signed URL and never accepts bytes
(§40.2); ingest/reprocess enqueue the §65 pipeline and return 202-style
`DocumentJobAccepted`; deletes are soft with a retention deadline.

**`QuestionService`** — `questions.py`

```python
async def list_questions(*, params: PageParams, status: ContentStatus | None,
                         question_type: QuestionType | None, skill: SkillKey | None,
                         difficulty: Difficulty | None, knowledge_base_id: str | None,
                         query: str | None) -> Page[Question]
async def get_question(question_id: str) -> Question
async def create_question(payload: QuestionCreateRequest) -> Question
async def update_question(question_id: str, payload: QuestionUpdateRequest) -> Question
async def generate_questions(payload: QuestionGenerateRequest) -> QuestionGenerateResponse
async def review_question(question_id: str, payload: ContentReviewRequest) -> Question
async def delete_question(question_id: str) -> None
```

Generated questions must carry `generated_by_model` + `citations` and land in
`review_required` (§15/§38).

**`PersonaService`** — `personas.py`

```python
async def list_personas(*, params: PageParams, status: ContentStatus | None,
                        industry: str | None,
                        include_hidden: bool) -> Page[PersonaResponse]
async def get_persona(persona_id: str, *, include_hidden: bool) -> PersonaResponse
async def create_persona(payload: PersonaCreateRequest) -> PersonaResponse
async def update_persona(persona_id: str, payload: PersonaUpdateRequest) -> PersonaResponse
async def test_persona(persona_id: str, payload: PersonaTestRequest) -> PersonaTestResponse
async def review_persona(persona_id: str, payload: ContentReviewRequest) -> PersonaResponse
async def delete_persona(persona_id: str) -> None
```

`include_hidden=False` must return `hidden=None` — use `Persona.public_view()` (§16.3).

**`ScenarioService`** — `scenarios.py`, `assignments.py`

```python
async def list_scenarios(*, params: PageParams, status: ContentStatus | None,
                         difficulty: Difficulty | None, industry: str | None,
                         query: str | None) -> Page[ScenarioResponse]
async def get_scenario(scenario_id: str) -> ScenarioResponse
async def list_scenario_versions(scenario_id: str) -> list[ScenarioVersion]
async def create_scenario(payload: ScenarioCreateRequest) -> ScenarioResponse
async def update_scenario(scenario_id: str, payload: ScenarioUpdateRequest) -> ScenarioResponse
async def review_scenario(scenario_id: str, payload: ContentReviewRequest) -> ScenarioResponse
async def delete_scenario(scenario_id: str) -> None

async def list_rubrics(*, params: PageParams, status: ContentStatus | None) -> Page[Rubric]
async def get_rubric(rubric_id: str) -> Rubric
async def create_rubric(payload: RubricCreateRequest) -> Rubric
async def update_rubric(rubric_id: str, payload: RubricUpdateRequest) -> Rubric
async def approve_rubric(rubric_id: str, payload: ContentReviewRequest) -> Rubric

async def list_assignments(*, params: PageParams,
                           mine_only: bool) -> Page[AssignmentResponse]
async def get_assignment(assignment_id: str) -> AssignmentResponse
async def get_assignment_progress(assignment_id: str) -> list[AssignmentProgressRow]
async def create_assignment(payload: AssignmentCreateRequest) -> AssignmentResponse
async def update_assignment(assignment_id: str,
                            payload: AssignmentUpdateRequest) -> AssignmentResponse
async def delete_assignment(assignment_id: str) -> None
```

Updating a scenario or rubric writes a new `scenario_version` / bumps `version` so a
completed session's report stays reproducible (§54). `mine_only` must be forced to
`True` for a caller without `team.review`.

**`EvaluationService`** — `sessions.py`, `reports.py`

```python
async def get_evaluation(session_id: str) -> Evaluation
async def override_evaluation(session_id: str,
                              payload: EvaluationOverrideRequest) -> Evaluation
async def get_skill_profile(user_id: str) -> SkillProfileResponse
async def get_team_analytics(filters: AnalyticsFilter) -> TeamAnalyticsResponse
```

Scores without evidence are rejected by the `Evaluation` model itself (§27). An override
is stored in `human_override`, never overwriting the AI score (§28). Reading another
user's profile requires `team.review`.

**`ReportService`** — `reports.py`

```python
async def list_reports(*, params: PageParams, kind: ReportKind | None) -> Page[ReportResponse]
async def get_report(report_id: str) -> ReportResponse
async def generate_report(payload: ReportGenerateRequest) -> ReportResponse
async def export_report(report_id: str,
                        payload: ReportExportRequest) -> ReportExportResponse
```

`export_report` returns a short-lived signed URL; the API never streams the file.

**`SafetyService`** — `security.py`

```python
async def get_security_overview() -> SecurityOverviewResponse
async def list_findings(*, params: PageParams, severity: ComplianceRisk | None,
                        reviewer_status: ReviewerStatus | None,
                        session_id: str | None) -> Page[ComplianceFinding]
async def get_finding(finding_id: str) -> ComplianceFinding
async def update_finding(finding_id: str,
                         payload: ComplianceFindingUpdateRequest) -> ComplianceFinding
async def check_text(payload: SafetyCheckRequest) -> SafetyCheckResponse
```

**`RagPipeline`** — `retrieval.py`

```python
class RagPipeline:
    def __init__(self, db_session: AsyncSession, ctx: RequestContext) -> None: ...
    async def retrieve_for_test(self,
                                payload: RetrievalTestRequest) -> RetrievalTestResponse
```

Every Qdrant filter must carry `tenant_id` + `workspace_id` + `knowledge_base_id` (§74)
and must respect the §39 `use_for_rag` permission. `RetrievalTestResponse` reports the
per-stage latency breakdown §49.5 asks for.

**`app.ws.gateway.session_ws_endpoint`** — `sessions.py`

```python
async def session_ws_endpoint(
    websocket: WebSocket,
    session_id: str,
    *,
    ctx: RequestContext,
    session_factory: async_sessionmaker[AsyncSession],
) -> None
```

The router has already authenticated the upgrade (cookie or bearer) and validated the
`Origin` header against the CORS allowlist — browsers do not apply the same-origin
policy to WebSockets, so this check is the only thing standing between a foreign page
and an authenticated socket. The gateway must call `websocket.accept()` itself.

It is handed the **session factory**, not a session: holding one transaction open for a
whole simulation would pin a pooled connection for minutes. Open a short transaction per
turn.

Protocol: emit `app.domain.events.StreamingEvent` members (serialise with
`dump_event_json` so `runtime.fallback`'s `from` alias is applied), and parse inbound
frames with `parse_client_command`. `seq` is monotonic per session and is what a
reconnecting client resumes from via `GET /sessions/{id}/events?since_seq=`.

**`app.ws.events.EventEmitter`** — used by services/agents, not by routers. It is the
sink that assigns `seq`, persists the event for replay and fans it out to connected
sockets.

### Errors and audit from inside a service

Raise the typed errors in `app.core.errors` (`NotFoundError.of("persona", id)`,
`PermissionDeniedError`, `SessionStateError`, `AssessmentModeRestrictedError`,
`SafetyBlockedError`, `ProviderUnavailableError`, `VersionConflictError`, …). They render
as the single problem shape with a stable `code`; never raise `HTTPException` and never
put a provider message, SQL or transcript text in `detail`.

Routers already write the §42 audit row for mutating routes. A service should only call
`app.core.audit.record_audit` for something the router cannot see, e.g. a background
retention purge.

---

## 3. Tenant isolation invariant (§74)

> **Cross-tenant retrieval must be impossible by construction, not by convention.**

A table is tenant-scoped purely by shape: if it has both `tenant_id` and `workspace_id`,
it is guarded. Adding a model cannot accidentally opt out.

Three independent layers:

1. **`ScopedRepository` / `scoped_select`** emit `WHERE tenant_id = :t AND workspace_id
   = :w` for you, so no service hand-writes the predicate.
2. **`install_tenant_guard`** (armed by the `Scope` dependency on the request's session)
   registers a SQLAlchemy `do_orm_execute` listener that **rejects** any
   SELECT/UPDATE/DELETE touching a tenant-scoped table without constraining both
   columns, plus a `before_flush` listener that stamps new rows and refuses a write
   carrying a foreign tenant. Forgetting the filter raises `TenantIsolationError` —
   reported to the client as `404` so the API never confirms that another tenant's
   resource exists, while the log and audit trail record the real reason.
3. **`assert_same_tenant(scope, *objects)`** is a pure, unit-testable assertion for
   trust boundaries: after a primary-key load, before emitting an object, before handing
   an id to Qdrant or S3.

Relationship and deferred-column loads are exempt (their parent was already fetched
through a scoped query). The **only** sanctioned bypass is
`allow_cross_tenant(statement, reason="…")`, which tags the statement with an explicit
execution option and logs the reason. Current legitimate uses: resolving a tenant from
an e-mail at login, re-deriving privileges on refresh, and the `workspace` /
`audit_event` tables (which have no or a nullable `workspace_id` and pin `tenant_id`
explicitly). `grep -rn allow_cross_tenant app/` is the complete audit list.

On the vector side the same invariant is a Qdrant payload filter of `tenant_id` +
`workspace_id` + `knowledge_base_id` (§74). Chunk *vectors* live only in Qdrant;
Postgres stores chunk text and metadata.

---

## 4. Running it

### Prerequisites

Postgres, Redis, Qdrant and MinIO (or S3). See `infra/`.

### Install

```bash
cd apps/api
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
```

### Configure

Copy the repository-root `.env.example` to `.env`; the API reads these names:

```text
APP_ENV  DATABASE_URL  REDIS_URL  QDRANT_URL
S3_ENDPOINT  S3_ACCESS_KEY  S3_SECRET_KEY  S3_BUCKET
OPENAI_API_KEY  ELEVENLABS_API_KEY  JWT_SECRET
NEXT_PUBLIC_ENABLE_WEBGPU        # reused as the default RuntimePolicy.webgpu (§61)
```

Optional extras, all with safe defaults (`app/core/config.py` is the reference):
`API_PREFIX`, `LOG_LEVEL`, `DEBUG_SQL`, `CORS_ALLOW_ORIGINS`, `JWT_ALGORITHM`,
`ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_SECONDS`, `COOKIE_DOMAIN`,
`LLM_PROVIDER`, `LLM_MODEL`, `TTS_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`,
`RATE_LIMIT_*`, `ALLOW_LOCAL_MODEL_CACHE`, `ALLOW_SENSITIVE_DATA_CACHE`,
`CLEAR_ON_LOGOUT`, `TRANSCRIPT_RETENTION_DAYS`, `OTEL_*`, `S3_REGION`,
`S3_SIGNED_URL_TTL_SECONDS`.

**Fail-fast:** outside `APP_ENV=local|test` the process refuses to boot if `JWT_SECRET`
is still `change-me` or shorter than 32 chars, if `OPENAI_API_KEY` is missing while the
OpenAI provider is enabled, if `ELEVENLABS_API_KEY` is missing while ElevenLabs TTS is
enabled, if `CORS_ALLOW_ORIGINS` is empty or contains `*`, or if
`ALLOW_SENSITIVE_DATA_CACHE` is true in production.

### Migrate

```bash
cd apps/api
alembic -c app/db/alembic.ini upgrade head                       # apply
alembic -c app/db/alembic.ini revision --autogenerate -m "..."   # new revision
alembic -c app/db/alembic.ini downgrade -1
```

`alembic.ini` contains no database URL: `env.py` reads `DATABASE_URL` through
`app.core.config`. Revision `0001_initial_schema` builds the schema from
`Base.metadata`; **every later revision must use explicit `op.*` operations** (see the
rationale in that file).

### Serve

```bash
cd apps/api
uvicorn app.main:app --reload --port 8000                        # development
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4      # production
```

* OpenAPI: `http://localhost:8000/docs` (disabled when `APP_ENV=production`)
* Liveness: `GET /healthz` — process only, no dependency calls
* Readiness: `GET /readyz` — Postgres, Redis, Qdrant, object storage; `503` when degraded
* API: `GET|POST /api/v1/...` (the §69 examples are written unversioned; this deployment
  mounts the same shapes under `/api/v1`)
* Session socket: `ws://localhost:8000/api/v1/sessions/{id}/ws`

### Workers

Async document processing runs on Celery with Redis as broker and result backend
(`REDIS_URL`). Celery was chosen over Dramatiq because the §65 pipeline needs
chained/grouped tasks with per-step retry and because the §40.2 retention sweep needs a
periodic scheduler — canvas and beat are built in. Worker entry points live in
`app/workers/` (Agents & RAG owner).

### Quality gates

```bash
cd apps/api
ruff check app && ruff format --check app
mypy app                     # strict
pytest                       # asyncio_mode = auto
```

---

## 5. Security notes worth knowing before you edit

* **Auth**: HS256 access token in an `HttpOnly` `SameSite=Lax` cookie; refresh token in a
  separate `HttpOnly` `SameSite=Strict` cookie scoped to `/api/v1/auth/refresh`. A bearer
  header is accepted for service clients. Refresh re-reads roles from the database, so a
  revocation takes effect within one access-token lifetime.
* **CSRF**: double-submit, and the token is HMAC-bound to the session's `jti`, so a token
  minted for one session is useless for another. Enforced on cookie-authenticated
  `POST/PUT/PATCH/DELETE` only — a bearer client needs no CSRF.
* **RBAC**: routers declare a `Permission`, never a role. The §9 matrix lives in exactly
  one place, `ROLE_PERMISSIONS` in `app/core/deps.py`.
* **Logging**: structlog JSON with a mandatory redaction processor. Transcript content,
  prompts, quotes, e-mail, IP and anything key-shaped are replaced with `[redacted]`,
  PII-shaped substrings are masked, long strings are truncated, and what was removed is
  listed in the `redacted` field (§49.5 / §40.2). Do not add a logging call that
  stringifies a request body to work around it.
* **Errors**: one problem shape, stable `code`, `recoverable` flag; the unhandled-exception
  handler logs the traceback and returns a fixed sentence — internals never leak.
* **Rate limiting**: Redis token bucket, atomic via Lua. Fails **open** so Redis cannot
  take the product down, except credential endpoints which fail **closed**.
* **Audit**: every mutating route records a §42 row. `detail` may carry ids, counts and
  changed field *names* — never field values, so the audit log cannot become a side
  channel for content. Failed logins are audited in their own transaction so the row
  survives the request rollback.
