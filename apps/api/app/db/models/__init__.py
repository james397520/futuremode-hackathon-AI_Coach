"""SQLAlchemy models for every §53 entity.

Importing this package registers all mappings on ``app.db.base.Base.metadata`` — which
is what Alembic's ``env.py`` and the initial revision rely on.

Entity coverage (§53): Organization, Workspace, User, Team, RoleAssignment,
KnowledgeBase, Document, DocumentVersion, Chunk, EmbeddingIndex, Question,
QuestionVersion, Persona, Scenario, ScenarioVersion, Rubric, Assignment,
TrainingSession, TranscriptTurn, PersonaStateEvent, CoachInsight, Evaluation,
EvaluationEvidence, ComplianceFinding, Report, AuditEvent, Integration, RuntimePolicy.
"""

from app.db.base import Base, IdMixin, TimestampMixin, new_id
from app.db.models.evaluation import (
    ComplianceFinding,
    Evaluation,
    EvaluationEvidence,
    Report,
)
from app.db.models.knowledge import (
    Chunk,
    Document,
    DocumentVersion,
    EmbeddingIndex,
    KnowledgeBase,
)
from app.db.models.mixins import (
    ContentStatusMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    enum_column,
    scope_index,
)
from app.db.models.org import (
    Organization,
    RoleAssignment,
    Team,
    User,
    Workspace,
    user_team,
)
from app.db.models.persona import Persona
from app.db.models.platform import AuditEvent, Integration, RuntimePolicy
from app.db.models.question import Question, QuestionVersion
from app.db.models.scenario import Assignment, Rubric, Scenario, ScenarioVersion
from app.db.models.session import (
    CoachInsight,
    PersonaStateEvent,
    TranscriptTurn,
    TrainingSession,
)

__all__ = [
    "Assignment",
    "AuditEvent",
    "Base",
    "Chunk",
    "CoachInsight",
    "ComplianceFinding",
    "ContentStatusMixin",
    "Document",
    "DocumentVersion",
    "EmbeddingIndex",
    "Evaluation",
    "EvaluationEvidence",
    "IdMixin",
    "Integration",
    "KnowledgeBase",
    "Organization",
    "Persona",
    "PersonaStateEvent",
    "Question",
    "QuestionVersion",
    "Report",
    "RoleAssignment",
    "Rubric",
    "RuntimePolicy",
    "Scenario",
    "ScenarioVersion",
    "SoftDeleteMixin",
    "Team",
    "TenantScopedMixin",
    "TimestampMixin",
    "TrainingSession",
    "TranscriptTurn",
    "User",
    "Workspace",
    "enum_column",
    "new_id",
    "scope_index",
    "user_team",
]
