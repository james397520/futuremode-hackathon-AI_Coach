"""Service-layer error taxonomy.

Defined here rather than imported from `app.core.errors` so the service layer stays
independently testable; the router edge (owned by the API-platform module) maps these
onto HTTP status codes.
"""

from __future__ import annotations

from typing import Any


class ServiceError(Exception):
    """Base class. `code` is stable and safe to show a client."""

    code = "service_error"
    status = 400

    def __init__(self, message: str, *, detail: Any = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class NotFoundError(ServiceError):
    code = "not_found"
    status = 404


class PermissionDeniedError(ServiceError):
    """RBAC (§9) or knowledge ACL (§39) refused the operation."""

    code = "permission_denied"
    status = 403


class TenantMismatchError(PermissionDeniedError):
    """A resource from another tenant/workspace was referenced (§10, §74)."""

    code = "tenant_mismatch"


class ConflictError(ServiceError):
    code = "conflict"
    status = 409


class ValidationFailedError(ServiceError):
    code = "validation_failed"
    status = 422


class StateTransitionError(ConflictError):
    """An illegal state-machine move (§92 session / document / content status)."""

    code = "illegal_state_transition"

    def __init__(self, resource: str, current: str, requested: str) -> None:
        super().__init__(
            f"{resource}: cannot move from '{current}' to '{requested}'",
            detail={"resource": resource, "from": current, "to": requested},
        )
        self.current = current
        self.requested = requested


class ReviewRequiredError(ConflictError):
    """Publishing something that has not passed human review (§15, §13, §38)."""

    code = "review_required"


class QuotaExceededError(ServiceError):
    code = "quota_exceeded"
    status = 429


class SafetyBlockedError(ServiceError):
    """The safety layer refused the input or output (§40.1)."""

    code = "safety_blocked"
    status = 400


__all__ = [
    "ConflictError",
    "NotFoundError",
    "PermissionDeniedError",
    "QuotaExceededError",
    "ReviewRequiredError",
    "SafetyBlockedError",
    "ServiceError",
    "StateTransitionError",
    "TenantMismatchError",
    "ValidationFailedError",
]
