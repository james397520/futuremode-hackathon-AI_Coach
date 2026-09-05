"""Application service layer (spec §63).

Every service is constructed as `Service(db_session, ctx)` where `ctx` is
`app.core.context.RequestContext`. Routers import these eight names directly:

    SessionService     KnowledgeService   QuestionService    PersonaService
    ScenarioService    EvaluationService  ReportService      SafetyService

Import them from their own modules (`app.services.session_service`, …) rather than
from this package: the concrete modules pull in the agent/RAG stack, and importing
the package eagerly would make a router that only needs `SafetyService` construct
the whole graph.
"""

from app.services.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ReviewRequiredError,
    SafetyBlockedError,
    ServiceError,
    StateTransitionError,
    TenantMismatchError,
    ValidationFailedError,
)

__all__ = [
    "ConflictError",
    "NotFoundError",
    "PermissionDeniedError",
    "ReviewRequiredError",
    "SafetyBlockedError",
    "ServiceError",
    "StateTransitionError",
    "TenantMismatchError",
    "ValidationFailedError",
]
