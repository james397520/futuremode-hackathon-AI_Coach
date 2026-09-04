"""Enumerations mirroring ``packages/shared-types/src/state-machines.ts``,
``persona.ts``, ``entities.ts``, ``events.ts`` and ``runtime.ts``.

``StrEnum`` is used so every member serialises to the *exact* literal string the
TypeScript union expects (e.g. ``Role.ADMIN`` -> ``"admin"``).
"""

from __future__ import annotations

from enum import StrEnum

# ---------------------------------------------------------------------------
# state-machines.ts
# ---------------------------------------------------------------------------


class SessionState(StrEnum):
    """§92 / §23 — Live Simulation session lifecycle."""

    IDLE = "idle"
    CONNECTING = "connecting"
    READY = "ready"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    PROCESSING = "processing"
    PERSONA_SPEAKING = "persona_speaking"
    PAUSED = "paused"
    RECONNECTING = "reconnecting"
    COMPLETED = "completed"
    ERROR = "error"


class DocumentState(StrEnum):
    """§92 / §11.3 — document processing pipeline."""

    UPLOADED = "uploaded"
    VALIDATING = "validating"
    PARSING = "parsing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


class RuntimeState(StrEnum):
    """§92 — client local-inference runtime."""

    UNKNOWN = "unknown"
    DETECTING = "detecting"
    SUPPORTED = "supported"
    LOADING = "loading"
    READY = "ready"
    DEGRADED = "degraded"
    FALLBACK = "fallback"


class ContentStatus(StrEnum):
    """§38 / §14 / §15 — content approval workflow."""

    DRAFT = "draft"
    GENERATED = "generated"
    REVIEW_REQUIRED = "review_required"
    APPROVED = "approved"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class SessionMode(StrEnum):
    """§8.4 — training vs assessment (gates hint / coach / knowledge peek)."""

    TRAINING = "training"
    ASSESSMENT = "assessment"


class Difficulty(StrEnum):
    """§18 — difficulty engine."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
    EXPERT = "expert"


class Role(StrEnum):
    """§9 — RBAC roles."""

    TRAINEE = "trainee"
    COACH = "coach"
    MANAGER = "manager"
    ADMIN = "admin"
    REVIEWER = "reviewer"


# ---------------------------------------------------------------------------
# persona.ts
# ---------------------------------------------------------------------------


class PersonaEmotion(StrEnum):
    NEUTRAL = "neutral"
    CURIOUS = "curious"
    SKEPTICAL = "skeptical"
    FRUSTRATED = "frustrated"
    INTERESTED = "interested"
    REASSURED = "reassured"
    READY = "ready"


class ScenarioPhase(StrEnum):
    OPENING = "opening"
    NEEDS_DISCOVERY = "needs_discovery"
    PRESENTATION = "presentation"
    OBJECTION_HANDLING = "objection_handling"
    CLOSING = "closing"
    ENDED = "ended"


class ComplianceRisk(StrEnum):
    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# ---------------------------------------------------------------------------
# entities.ts
# ---------------------------------------------------------------------------


class WorkspaceKind(StrEnum):
    B2B = "b2b"
    B2C = "b2c"


class DocumentSourceKind(StrEnum):
    PDF = "pdf"
    DOCX = "docx"
    PPTX = "pptx"
    TXT = "txt"
    CSV = "csv"
    HTML = "html"
    URL = "url"
    MANUAL = "manual"


class KnowledgeAclScope(StrEnum):
    """§39 — Knowledge Access Control subject scope."""

    ORGANIZATION = "organization"
    WORKSPACE = "workspace"
    DEPARTMENT = "department"
    TEAM = "team"
    ROLE = "role"
    USER = "user"


class KnowledgePermission(StrEnum):
    """§39 — Knowledge Access Control permissions."""

    VIEW = "view"
    USE_FOR_RAG = "use_for_rag"
    EDIT = "edit"
    REVIEW = "review"
    PUBLISH = "publish"
    EXPORT = "export"
    DELETE = "delete"


class ChunkStrategy(StrEnum):
    AUTO = "auto"
    SEMANTIC = "semantic"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    FIXED_TOKEN = "fixed_token"
    TABLE_AWARE = "table_aware"
    FAQ_AWARE = "faq_aware"


class QuestionType(StrEnum):
    MULTIPLE_CHOICE = "multiple_choice"
    TRUE_FALSE = "true_false"
    SHORT_ANSWER = "short_answer"
    OPEN_ENDED = "open_ended"
    SCENARIO = "scenario"
    VOICE_RESPONSE = "voice_response"
    ROLE_PLAY = "role_play"
    COMPLIANCE = "compliance"
    OBJECTION_HANDLING = "objection_handling"
    KNOWLEDGE_CHECK = "knowledge_check"


class VoiceProvider(StrEnum):
    OPENAI = "openai"
    ELEVENLABS = "elevenlabs"
    NONE = "none"


class SkillKey(StrEnum):
    """§26.1 — the ten evaluation dimensions (``SKILL_KEYS`` in entities.ts)."""

    PROFESSIONAL_KNOWLEDGE = "professional_knowledge"
    EMPATHY = "empathy"
    NEEDS_DISCOVERY = "needs_discovery"
    COMMUNICATION_CLARITY = "communication_clarity"
    OBJECTION_HANDLING = "objection_handling"
    TRUST_BUILDING = "trust_building"
    PRODUCT_KNOWLEDGE = "product_knowledge"
    COMPLIANCE = "compliance"
    CLOSING_ABILITY = "closing_ability"
    GOAL_ACHIEVEMENT = "goal_achievement"


#: Ordered tuple matching ``SKILL_KEYS`` in ``entities.ts`` (order is load-bearing for
#: the radar chart in §38 and for rubric weight tables).
SKILL_KEYS: tuple[SkillKey, ...] = (
    SkillKey.PROFESSIONAL_KNOWLEDGE,
    SkillKey.EMPATHY,
    SkillKey.NEEDS_DISCOVERY,
    SkillKey.COMMUNICATION_CLARITY,
    SkillKey.OBJECTION_HANDLING,
    SkillKey.TRUST_BUILDING,
    SkillKey.PRODUCT_KNOWLEDGE,
    SkillKey.COMPLIANCE,
    SkillKey.CLOSING_ABILITY,
    SkillKey.GOAL_ACHIEVEMENT,
)


class ComplianceFindingType(StrEnum):
    """§32 — compliance report finding taxonomy."""

    FALSE_PROMISE = "false_promise"
    MISLEADING_STATEMENT = "misleading_statement"
    UNSUPPORTED_CLAIM = "unsupported_claim"
    PRIVACY_ISSUE = "privacy_issue"
    UNAUTHORIZED_ADVICE = "unauthorized_advice"
    SENSITIVE_INFORMATION = "sensitive_information"
    MISSING_DISCLOSURE = "missing_disclosure"
    PROMPT_INJECTION = "prompt_injection"
    RESTRICTED_TOPIC = "restricted_topic"


class ReviewerStatus(StrEnum):
    OPEN = "open"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class SpeakerKind(StrEnum):
    TRAINEE = "trainee"
    PERSONA = "persona"
    COACH = "coach"
    SYSTEM = "system"
    COMPLIANCE = "compliance"
    KNOWLEDGE = "knowledge"


class CoachInsightKind(StrEnum):
    HINT = "hint"
    MISSED_SIGNAL = "missed_signal"
    NEXT_STRATEGY = "next_strategy"
    POST_SESSION = "post_session"


class AuditResult(StrEnum):
    SUCCESS = "success"
    DENIED = "denied"
    ERROR = "error"


# ---------------------------------------------------------------------------
# events.ts
# ---------------------------------------------------------------------------


class AgentName(StrEnum):
    """§19 / §66 — multi-agent names (``AGENT_NAMES`` in events.ts)."""

    ORCHESTRATOR = "orchestrator"
    SCENARIO_DIRECTOR = "scenario_director"
    CUSTOMER = "customer"
    COACH = "coach"
    KNOWLEDGE = "knowledge"
    EVALUATOR = "evaluator"
    COMPLIANCE = "compliance"


AGENT_NAMES: tuple[AgentName, ...] = tuple(AgentName)


class SpeechSpeaker(StrEnum):
    """``speech.*`` events carry only these two speakers (events.ts)."""

    TRAINEE = "trainee"
    PERSONA = "persona"


class FallbackTarget(StrEnum):
    """``runtime.fallback.to`` — WebGPU degrades to WASM then server (§62)."""

    WASM = "wasm"
    SERVER = "server"


# ---------------------------------------------------------------------------
# runtime.ts
# ---------------------------------------------------------------------------


class ComputeBackend(StrEnum):
    WEBGPU = "webgpu"
    WASM = "wasm"
    SERVER = "server"


class MemoryClass(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class LocalTask(StrEnum):
    """§52–§55 — tasks eligible for client-side execution; server stays authoritative."""

    EMBEDDING = "embedding"
    INTENT_CLASSIFICATION = "intent_classification"
    RERANKING = "reranking"
    SAFETY_PRECHECK = "safety_precheck"


class WebGpuMode(StrEnum):
    """§44 / §61 — enterprise runtime policy switch."""

    AUTO = "auto"
    ON = "on"
    OFF = "off"


# ---------------------------------------------------------------------------
# Platform-side enums (no TypeScript counterpart — API-only concepts)
# ---------------------------------------------------------------------------


class ReportKind(StrEnum):
    """§47 — report types."""

    INDIVIDUAL = "individual"
    TEAM = "team"
    SCENARIO = "scenario"
    SKILL = "skill"
    COMPLIANCE = "compliance"
    KNOWLEDGE_GAP = "knowledge_gap"
    TRAINING_COMPLETION = "training_completion"
    READINESS = "readiness"


class ExportFormat(StrEnum):
    """§47 — export targets."""

    PDF = "pdf"
    CSV = "csv"
    XLSX = "xlsx"


class IntegrationKind(StrEnum):
    """§43 — connector cards."""

    OPENAI = "openai"
    ELEVENLABS = "elevenlabs"
    AMD_AUP = "amd_aup"
    QDRANT = "qdrant"
    CHROMADB = "chromadb"
    FAISS = "faiss"
    CRM = "crm"
    LMS = "lms"
    HRIS = "hris"
    SSO = "sso"
    OAUTH_OIDC = "oauth_oidc"
    WEBHOOK = "webhook"
    OBJECT_STORAGE = "object_storage"


class IntegrationStatus(StrEnum):
    """§43 — connector state."""

    CONNECTED = "connected"
    NOT_CONNECTED = "not_connected"
    ERROR = "error"
