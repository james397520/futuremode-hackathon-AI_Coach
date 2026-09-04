"""Request/response DTOs for the §56 API surface.

These are *transport* shapes, not entities: they wrap or narrow the mirrored contract
models in the sibling modules. Rules:

* A response never contains a secret, a provider key, an object-storage credential or a
  ``PersonaHiddenState`` the caller is not authorised for (§16.3 / §56 / §70 / §71).
* Uploads are never proxied through the API: ``SignedUploadResponse`` hands the browser
  a short-lived signed URL and the API only records metadata (§40.2 / §73).
* Every list endpoint answers with :class:`~app.domain.common.Page`.
"""

from __future__ import annotations

from pydantic import Field

from app.domain.analytics import (
    Recommendation,
    Report,
    ReportExport,
    SkillProfile,
    TeamAnalytics,
)
from app.domain.common import (
    ID,
    Confidence,
    DomainModel,
    ISODateTime,
    Score100,
    Team,
    User,
    Workspace,
)
from app.domain.enums import (
    ChunkStrategy,
    ComplianceRisk,
    ComputeBackend,
    ContentStatus,
    Difficulty,
    DocumentSourceKind,
    ExportFormat,
    IntegrationKind,
    IntegrationStatus,
    QuestionType,
    ReportKind,
    ReviewerStatus,
    Role,
    SessionMode,
    SkillKey,
    WebGpuMode,
    WorkspaceKind,
)
from app.domain.evaluation import ComplianceFinding, Evaluation
from app.domain.knowledge import (
    Chunk,
    Citation,
    KnowledgeAcl,
    KnowledgeBase,
    KnowledgeDocument,
)
from app.domain.persona import (
    Persona,
    PersonaHiddenState,
    PersonaSimulationState,
    PersonaTraits,
    PersonaVoiceConfig,
)
from app.domain.question import Question
from app.domain.runtime import ComputeCapability, RuntimePolicy, RuntimeTelemetry
from app.domain.scenario import Assignment, CustomSkill, Scenario
from app.domain.session import CoachInsight, TrainingSession, TranscriptTurn

# ===========================================================================
# /auth
# ===========================================================================


class LoginRequest(DomainModel):
    """§58-1 sign-in. Rate limited and fail-closed (see ``LoginLimit``)."""

    email: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=200)


class WorkspaceSummary(DomainModel):
    """One entry of the §58-2 workspace picker."""

    id: ID
    name: str
    kind: WorkspaceKind
    roles: list[Role] = Field(default_factory=list)


class AuthenticatedUser(DomainModel):
    """The signed-in principal as the web app needs it."""

    id: ID
    tenant_id: ID
    workspace_id: ID | None = None
    email: str
    display_name: str
    roles: list[Role] = Field(default_factory=list)
    team_ids: list[ID] = Field(default_factory=list)
    locale: str


class LoginResponse(DomainModel):
    """Tokens are delivered as HttpOnly cookies — the body carries no credential.

    ``csrf_token`` is the value the client must echo in ``X-CSRF-Token``; it is also set
    as a readable cookie, so this field is a convenience, not a secret (§73).
    """

    user: AuthenticatedUser
    workspaces: list[WorkspaceSummary] = Field(default_factory=list)
    csrf_token: str
    expires_at: ISODateTime


class SelectWorkspaceRequest(DomainModel):
    workspace_id: ID


class SessionIdentityResponse(DomainModel):
    """``GET /auth/me``."""

    user: AuthenticatedUser
    permissions: list[str] = Field(default_factory=list)
    workspaces: list[WorkspaceSummary] = Field(default_factory=list)


# ===========================================================================
# /workspaces, /users, /teams
# ===========================================================================


class WorkspaceResponse(Workspace):
    """Exactly the ``Workspace`` contract shape — no API-only additions."""


class WorkspaceCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    kind: WorkspaceKind = WorkspaceKind.B2B


class WorkspaceUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: WorkspaceKind | None = None


class UserResponse(User):
    """``User`` plus two administrative fields the directory page needs.

    ``email`` is only returned to callers holding ``user.read``.
    """

    is_active: bool = True
    last_login_at: ISODateTime | None = None


class UserCreateRequest(DomainModel):
    email: str = Field(max_length=320)
    display_name: str = Field(min_length=1, max_length=200)
    roles: list[Role] = Field(default_factory=lambda: [Role.TRAINEE])
    team_ids: list[ID] = Field(default_factory=list)
    locale: str = "zh-TW"


class UserUpdateRequest(DomainModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=200)
    team_ids: list[ID] | None = None
    is_active: bool | None = None
    locale: str | None = None


class RoleAssignmentRequest(DomainModel):
    """§9 role change — always audited as ``permission_change``."""

    roles: list[Role] = Field(min_length=1)


class TeamResponse(Team):
    """``Team`` plus the derived member count shown in the §35 filters."""

    member_count: int = Field(default=0, ge=0)


class TeamCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    department: str | None = Field(default=None, max_length=200)


class TeamUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    department: str | None = Field(default=None, max_length=200)


class TeamMembershipRequest(DomainModel):
    user_ids: list[ID] = Field(min_length=1)


# ===========================================================================
# /knowledge-bases, /documents, /chunks, /retrieval
# ===========================================================================


class KnowledgeBaseCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    embedding_model: str | None = Field(
        default=None, description="Defaults to the workspace EMBEDDING_MODEL setting"
    )
    acl: KnowledgeAcl | None = None


class KnowledgeBaseUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: ContentStatus | None = None


class KnowledgeAclUpdateRequest(DomainModel):
    """§39 ACL replacement (admin only)."""

    acl: KnowledgeAcl


class KnowledgeBaseResponse(KnowledgeBase):
    """Knowledge base plus derived counters for the §26 overview cards."""

    ready_document_count: int = Field(default=0, ge=0)
    failed_document_count: int = Field(default=0, ge=0)


class DocumentUploadRequest(DomainModel):
    """Ask for a signed upload URL (§40.2). The API never receives the bytes."""

    filename: str = Field(min_length=1, max_length=500)
    source_kind: DocumentSourceKind
    size_bytes: int = Field(ge=1)
    content_type: str | None = Field(default=None, max_length=160)
    checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    chunk_strategy: ChunkStrategy = ChunkStrategy.AUTO


class SignedUploadResponse(DomainModel):
    """Short-lived, pre-signed POST/PUT target for direct-to-storage upload."""

    document_id: ID
    upload_url: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    fields: dict[str, str] = Field(
        default_factory=dict, description="Form fields for a pre-signed POST policy"
    )
    storage_key: str
    expires_at: ISODateTime
    max_size_bytes: int = Field(ge=1)


class DocumentIngestRequest(DomainModel):
    """Called by the browser once the upload finished; enqueues the §65 pipeline."""

    checksum_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    size_bytes: int | None = Field(default=None, ge=0)
    chunk_strategy: ChunkStrategy = ChunkStrategy.AUTO


class DocumentUrlIngestRequest(DomainModel):
    """Ingest a URL instead of a file (``source_kind='url'``)."""

    url: str = Field(min_length=1, max_length=2000)
    chunk_strategy: ChunkStrategy = ChunkStrategy.AUTO


class DocumentResponse(KnowledgeDocument):
    """Document plus the async job handle so the UI can poll §29 progress."""

    job_id: str | None = None


class DocumentJobAccepted(DomainModel):
    """202 body for an enqueued pipeline run."""

    document_id: ID
    job_id: str
    state: str


class ChunkUpdateRequest(DomainModel):
    """§30 Chunk Viewer edit. Editing text re-embeds that chunk only."""

    text: str | None = None
    tags: list[str] | None = None
    excluded_from_retrieval: bool | None = None
    section: str | None = None
    metadata: dict[str, str | int | float | bool] | None = None


class ChunkResponse(Chunk):
    """Chunk plus the document name so the viewer needs one request."""

    document_name: str | None = None


class RetrievalTestRequest(DomainModel):
    """§31 Retrieval Playground / ``POST /api/retrieval/test``."""

    query: str = Field(min_length=1, max_length=2000)
    knowledge_base_ids: list[ID] = Field(min_length=1)
    top_k: int = Field(default=8, ge=1, le=50)
    use_reranker: bool = True
    rerank_top_n: int = Field(default=5, ge=1, le=50)
    min_similarity: Confidence = 0.0
    filters: dict[str, str] = Field(default_factory=dict)


class RetrievalHit(DomainModel):
    """One retrieved chunk with its scores."""

    citation: Citation
    text: str
    token_count: int = Field(ge=0)
    tags: list[str] = Field(default_factory=list)


class RetrievalTestResponse(DomainModel):
    """Playground answer: hits plus the latency breakdown required by §49.5."""

    hits: list[RetrievalHit] = Field(default_factory=list)
    embedding_ms: float = Field(ge=0)
    search_ms: float = Field(ge=0)
    rerank_ms: float | None = Field(default=None, ge=0)
    total_ms: float = Field(ge=0)
    embedding_model: str
    reranker_model: str | None = None


# ===========================================================================
# /questions
# ===========================================================================


class QuestionCreateRequest(DomainModel):
    title: str = Field(min_length=1, max_length=300)
    type: QuestionType
    prompt: str = Field(min_length=1)
    knowledge_base_id: ID | None = None
    category: str | None = None
    skill: SkillKey | None = None
    difficulty: Difficulty = Difficulty.MEDIUM
    correct_answer: str | None = None
    rubric: str | None = None
    required_keywords: list[str] = Field(default_factory=list)
    forbidden_claims: list[str] = Field(default_factory=list)
    compliance_rules: list[str] = Field(default_factory=list)
    explanation: str | None = None
    tags: list[str] = Field(default_factory=list)


class QuestionUpdateRequest(DomainModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    prompt: str | None = None
    category: str | None = None
    skill: SkillKey | None = None
    difficulty: Difficulty | None = None
    correct_answer: str | None = None
    rubric: str | None = None
    required_keywords: list[str] | None = None
    forbidden_claims: list[str] | None = None
    compliance_rules: list[str] | None = None
    explanation: str | None = None
    tags: list[str] | None = None


class QuestionGenerateRequest(DomainModel):
    """§15 AI question generation. Output lands in ``review_required`` (§38)."""

    knowledge_base_id: ID
    count: int = Field(default=10, ge=1, le=50)
    types: list[QuestionType] = Field(default_factory=list)
    difficulty: Difficulty = Difficulty.MEDIUM
    skills: list[SkillKey] = Field(default_factory=list)
    focus: str | None = Field(default=None, max_length=500)


class QuestionGenerateResponse(DomainModel):
    questions: list[Question] = Field(default_factory=list)
    model: str
    generated_count: int = Field(ge=0)


class ContentReviewRequest(DomainModel):
    """§38 approval transition, shared by question / scenario / persona / rubric."""

    status: ContentStatus
    note: str | None = Field(default=None, max_length=2000)


# ===========================================================================
# /personas
# ===========================================================================


class PersonaCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=0, le=120)
    occupation: str | None = None
    industry: str | None = None
    background: str | None = None
    language: str = "zh-TW"
    locale: str = "zh-TW"
    traits: PersonaTraits
    hidden: PersonaHiddenState | None = None
    voice: PersonaVoiceConfig
    avatar_url: str | None = None


class PersonaUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    age: int | None = Field(default=None, ge=0, le=120)
    occupation: str | None = None
    industry: str | None = None
    background: str | None = None
    traits: PersonaTraits | None = None
    hidden: PersonaHiddenState | None = None
    voice: PersonaVoiceConfig | None = None
    avatar_url: str | None = None


class PersonaResponse(Persona):
    """``hidden`` is present only for callers holding ``persona.read_hidden`` (§16.3)."""


class PersonaTestRequest(DomainModel):
    """§34 Persona Test Lab: one turn against a persona, without creating a session."""

    message: str = Field(min_length=1, max_length=4000)
    scenario_id: ID | None = None
    state: PersonaSimulationState | None = None


class PersonaTestResponse(DomainModel):
    reply: str
    state: PersonaSimulationState
    citations: list[Citation] = Field(default_factory=list)
    latency_ms: float = Field(ge=0)


# ===========================================================================
# /scenarios, /assignments
# ===========================================================================


class ScenarioCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    industry: str | None = None
    training_type: str | None = None
    persona_id: ID
    knowledge_base_ids: list[ID] = Field(default_factory=list)
    difficulty: Difficulty = Difficulty.MEDIUM
    mode: SessionMode = SessionMode.TRAINING
    opening_context: str = Field(min_length=1)
    learning_objectives: list[str] = Field(default_factory=list)
    required_knowledge: list[str] = Field(default_factory=list)
    required_talking_points: list[str] = Field(default_factory=list)
    key_objections: list[str] = Field(default_factory=list)
    restricted_topics: list[str] = Field(default_factory=list)
    success_condition: str = Field(min_length=1)
    failure_condition: str = Field(min_length=1)
    time_limit_seconds: int | None = Field(default=None, ge=0)
    max_turns: int | None = Field(default=None, ge=1)
    minimum_score: Score100 | None = None
    rubric_id: ID | None = None


class ScenarioUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    industry: str | None = None
    training_type: str | None = None
    persona_id: ID | None = None
    knowledge_base_ids: list[ID] | None = None
    difficulty: Difficulty | None = None
    mode: SessionMode | None = None
    opening_context: str | None = None
    learning_objectives: list[str] | None = None
    required_knowledge: list[str] | None = None
    required_talking_points: list[str] | None = None
    key_objections: list[str] | None = None
    restricted_topics: list[str] | None = None
    success_condition: str | None = None
    failure_condition: str | None = None
    time_limit_seconds: int | None = Field(default=None, ge=0)
    max_turns: int | None = Field(default=None, ge=1)
    minimum_score: Score100 | None = None
    rubric_id: ID | None = None


class ScenarioResponse(Scenario):
    persona_name: str | None = None
    rubric_name: str | None = None


class RubricCreateRequest(DomainModel):
    name: str = Field(min_length=1, max_length=200)
    weights: dict[SkillKey, float]
    pass_threshold: Score100 = 80
    custom_skills: list[CustomSkill] | None = None
    required_evidence: list[str] = Field(default_factory=list)
    forbidden_behaviors: list[str] = Field(default_factory=list)


class RubricUpdateRequest(DomainModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    weights: dict[SkillKey, float] | None = None
    pass_threshold: Score100 | None = None
    custom_skills: list[CustomSkill] | None = None
    required_evidence: list[str] | None = None
    forbidden_behaviors: list[str] | None = None


class AssignmentCreateRequest(DomainModel):
    scenario_id: ID
    assignee_user_ids: list[ID] = Field(default_factory=list)
    assignee_team_ids: list[ID] = Field(default_factory=list)
    deadline: ISODateTime | None = None
    max_attempts: int | None = Field(default=None, ge=1)
    minimum_score: Score100 = 80
    mandatory: bool = False
    prerequisite_assignment_id: ID | None = None
    mode: SessionMode = SessionMode.TRAINING


class AssignmentUpdateRequest(DomainModel):
    assignee_user_ids: list[ID] | None = None
    assignee_team_ids: list[ID] | None = None
    deadline: ISODateTime | None = None
    max_attempts: int | None = Field(default=None, ge=1)
    minimum_score: Score100 | None = None
    mandatory: bool | None = None
    mode: SessionMode | None = None


class AssignmentProgressRow(DomainModel):
    """§36 completion tracking for one assignee."""

    user_id: ID
    display_name: str
    attempts: int = Field(ge=0)
    best_score: Score100 | None = None
    passed: bool = False
    highest_risk: ComplianceRisk = ComplianceRisk.SAFE
    last_session_id: ID | None = None
    completed_at: ISODateTime | None = None


class AssignmentResponse(Assignment):
    scenario_name: str | None = None
    assignee_count: int = Field(default=0, ge=0)
    completed_count: int = Field(default=0, ge=0)


# ===========================================================================
# /sessions
# ===========================================================================


class SessionCreateRequest(DomainModel):
    """``POST /api/sessions`` (§69).

    ``scenario_version`` / ``persona_version`` are resolved server-side and pinned;
    a client cannot choose them (§54).
    """

    scenario_id: ID
    assignment_id: ID | None = None
    mode: SessionMode | None = Field(
        default=None, description="Defaults to the scenario's mode; assessment cannot be relaxed"
    )
    voice_enabled: bool = False
    score_live_enabled: bool = False
    runtime: ComputeBackend = ComputeBackend.SERVER
    capability: ComputeCapability | None = Field(
        default=None, description="Client capability report (§59), used for runtime advice"
    )


class SessionResponse(DomainModel):
    """``GET /api/sessions/{id}`` and the 201 body of session creation."""

    session: TrainingSession
    scenario: ScenarioResponse
    persona: PersonaResponse
    persona_state: PersonaSimulationState | None = None
    runtime_policy: RuntimePolicy
    websocket_url: str = Field(description="Relative WS path for this session (§68)")
    resume_from_seq: int = Field(default=0, ge=0)
    coach_enabled: bool = Field(
        default=True, description="False in assessment mode (§8.4/§24)"
    )


class SessionMessageRequest(DomainModel):
    """``POST /api/sessions/{id}/message`` — the non-WebSocket fallback path."""

    text: str = Field(min_length=1, max_length=4000)
    client_intent_hint: str | None = Field(default=None, max_length=120)
    client_intent_confidence: Confidence | None = None
    idempotency_key: str | None = Field(
        default=None, max_length=64, description="§49.4 — safe retry of the same turn"
    )


class ScoreDelta(DomainModel):
    skill: SkillKey
    score: Score100
    confidence: Confidence


class SessionMessageResponse(DomainModel):
    """The persona's answer plus everything the UI must reconcile."""

    trainee_turn: TranscriptTurn
    persona_turn: TranscriptTurn
    persona_state: PersonaSimulationState
    citations: list[Citation] = Field(default_factory=list)
    coach_insight: CoachInsight | None = None
    scores: list[ScoreDelta] = Field(default_factory=list)
    compliance_findings: list[ComplianceFinding] = Field(default_factory=list)
    seq: int = Field(ge=0)


class SessionEndRequest(DomainModel):
    """``POST /api/sessions/{id}/end`` (§29 Session Completion)."""

    reason: str | None = Field(default=None, max_length=200)
    request_evaluation: bool = True


class SessionEndResponse(DomainModel):
    session: TrainingSession
    evaluation: Evaluation | None = None
    evaluation_pending: bool = False
    recommendation: Recommendation | None = None


class SessionTranscriptResponse(DomainModel):
    """§25 / §30 full transcript for review and replay."""

    session_id: ID
    turns: list[TranscriptTurn] = Field(default_factory=list)
    insights: list[CoachInsight] = Field(default_factory=list)
    state_timeline: list[PersonaSimulationState] = Field(default_factory=list)


class CoachHintRequest(DomainModel):
    """Explicit hint request. Rejected in assessment mode (§8.4 / §24)."""

    context: str | None = Field(default=None, max_length=500)


class EvaluationOverrideRequest(DomainModel):
    """§28 Rubric Calibration — coach overrides the AI score, with a reason."""

    score: Score100
    note: str = Field(min_length=1, max_length=2000)


class ComplianceFindingUpdateRequest(DomainModel):
    """§32 finding triage by a reviewer (§9.5)."""

    reviewer_status: ReviewerStatus
    note: str | None = Field(default=None, max_length=2000)


# ===========================================================================
# /reports
# ===========================================================================


class ReportGenerateRequest(DomainModel):
    kind: ReportKind
    session_id: ID | None = None
    user_id: ID | None = None
    team_id: ID | None = None
    scenario_id: ID | None = None
    period_start: ISODateTime | None = None
    period_end: ISODateTime | None = None
    title: str | None = Field(default=None, max_length=300)


class ReportResponse(Report):
    """A generated report; ``payload`` shape depends on ``kind`` (§47)."""


class ReportExportRequest(DomainModel):
    format: ExportFormat = ExportFormat.PDF


class ReportExportResponse(ReportExport):
    """Signed, short-lived download URL — bytes are never proxied by the API."""


class SkillProfileResponse(DomainModel):
    """§34 personal growth page."""

    profile: SkillProfile
    recommendation: Recommendation | None = None


class TeamAnalyticsResponse(DomainModel):
    """§35 manager dashboard."""

    analytics: TeamAnalytics
    generated_at: ISODateTime


# ===========================================================================
# /security, /audit
# ===========================================================================


class SecurityOverviewResponse(DomainModel):
    """§41 Security & Audit landing metrics (admin / reviewer only)."""

    open_findings: int = Field(ge=0)
    critical_findings: int = Field(ge=0)
    findings_by_severity: dict[ComplianceRisk, int] = Field(default_factory=dict)
    sessions_flagged_last_30d: int = Field(ge=0)
    last_scan_at: ISODateTime | None = None
    retention_days: int = Field(ge=0)


class SafetyCheckRequest(DomainModel):
    """§40.1 ad-hoc safety evaluation (used by the security console and tests)."""

    text: str = Field(min_length=1, max_length=4000)
    scenario_id: ID | None = None


class SafetyCheckResponse(DomainModel):
    blocked: bool
    risk: ComplianceRisk
    categories: list[str] = Field(default_factory=list)
    explanation: str | None = None


# ===========================================================================
# /integrations
# ===========================================================================


class IntegrationResponse(DomainModel):
    """§43 connector card. Never includes the credential itself."""

    id: ID
    kind: IntegrationKind
    display_name: str
    status: IntegrationStatus
    config: dict[str, str] = Field(default_factory=dict)
    has_credential: bool = False
    last_sync_at: ISODateTime | None = None
    last_error: str | None = None
    updated_at: ISODateTime


class IntegrationUpsertRequest(DomainModel):
    """Configure a connector.

    ``secret_ref`` is a *reference* into the secrets manager (§73), never a raw key:
    the API refuses to accept long-lived provider credentials over this endpoint.
    """

    kind: IntegrationKind
    display_name: str | None = Field(default=None, max_length=200)
    config: dict[str, str] = Field(default_factory=dict)
    secret_ref: str | None = Field(default=None, max_length=300)


class IntegrationTestResponse(DomainModel):
    status: IntegrationStatus
    latency_ms: float | None = Field(default=None, ge=0)
    message: str | None = None


# ===========================================================================
# /runtime
# ===========================================================================


class RuntimePolicyResponse(DomainModel):
    """§44 / §61 policy served to the browser, plus advice for this device."""

    policy: RuntimePolicy
    recommended_backend: ComputeBackend
    local_tasks_enabled: list[str] = Field(default_factory=list)
    reason: str | None = None


class RuntimePolicyUpdateRequest(DomainModel):
    """Admin-only policy change (§61)."""

    webgpu: WebGpuMode | None = None
    allow_local_model_cache: bool | None = None
    allow_sensitive_data_cache: bool | None = None
    clear_on_logout: bool | None = None


class RuntimeCapabilityReport(DomainModel):
    """§59 capability report from the client, used to pick a backend."""

    capability: ComputeCapability
    session_id: ID | None = None


class RuntimeTelemetryRequest(DomainModel):
    """§49.5 telemetry: timings only. Any content field is rejected by ``extra=forbid``."""

    telemetry: RuntimeTelemetry
    session_id: ID | None = None


# ===========================================================================
# /health
# ===========================================================================


class DependencyHealth(DomainModel):
    name: str
    ok: bool
    latency_ms: float | None = Field(default=None, ge=0)
    detail: str | None = Field(
        default=None, description="Short, non-sensitive reason when not ok"
    )


class HealthResponse(DomainModel):
    status: str
    version: str
    app_env: str


class ReadinessResponse(DomainModel):
    status: str
    dependencies: list[DependencyHealth] = Field(default_factory=list)
