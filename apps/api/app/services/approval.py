"""§38 Content Approval Workflow — shared by persona / scenario / question / rubric.

    Draft -> Review -> Approved -> Published -> Archived
    高風險企業可要求 maker-checker 雙人覆核。

`maker_checker` is the enforcement of that last line: when the tenant enables it, the
user who authored (or last edited) a version may not be the user who approves it. That
check is here rather than in each service so all four content types behave identically.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.services.base import iso_now
from app.services.exceptions import (
    ConflictError,
    PermissionDeniedError,
    StateTransitionError,
    ValidationFailedError,
)

#: Mirrors `CONTENT_STATUSES` in packages/shared-types/src/state-machines.ts
CONTENT_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"review_required", "archived"}),
    "generated": frozenset({"review_required", "draft", "archived"}),
    "review_required": frozenset({"approved", "draft", "archived"}),
    "approved": frozenset({"published", "review_required", "archived"}),
    "published": frozenset({"archived", "approved"}),
    "archived": frozenset({"draft"}),
}

PUBLISHABLE_FROM = frozenset({"approved"})
#: A version that has never been reviewed may never be published (§15, §38).
REQUIRES_REVIEW = frozenset({"draft", "generated", "review_required"})


class ApprovalRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str
    reviewer_id: str | None = None
    reviewed_at: str | None = None
    review_note: str | None = None
    published_by: str | None = None
    published_at: str | None = None
    #: who authored the version under review — used by the maker-checker rule
    author_id: str | None = None


def assert_content_transition(resource: str, current: str, requested: str) -> None:
    if current == requested:
        return
    if requested not in CONTENT_TRANSITIONS.get(current, frozenset()):
        raise StateTransitionError(resource, current, requested)


def approve(
    record: ApprovalRecord,
    *,
    reviewer_id: str,
    reviewer_roles: Sequence[str],
    allowed_roles: Sequence[str],
    maker_checker: bool,
    note: str | None = None,
) -> ApprovalRecord:
    """Move `review_required -> approved` with the maker-checker rule applied."""
    assert_content_transition("content", record.status, "approved")
    if not set(reviewer_roles) & set(allowed_roles):
        raise PermissionDeniedError(
            f"role {sorted(reviewer_roles)} may not approve content; "
            f"requires one of {sorted(allowed_roles)}"
        )
    if maker_checker and record.author_id and record.author_id == reviewer_id:
        raise ConflictError(
            "maker-checker is enabled: the author of a version cannot approve it (§38)"
        )
    return record.model_copy(
        update={
            "status": "approved",
            "reviewer_id": reviewer_id,
            "reviewed_at": iso_now(),
            "review_note": note,
        }
    )


def publish(record: ApprovalRecord, *, publisher_id: str) -> ApprovalRecord:
    """Only reviewed+approved content may be published."""
    if record.status in REQUIRES_REVIEW:
        from app.services.exceptions import ReviewRequiredError

        raise ReviewRequiredError(
            f"content is '{record.status}' and has not passed human review; "
            "it cannot be published (§38/§15)"
        )
    assert_content_transition("content", record.status, "published")
    if not record.reviewer_id:
        from app.services.exceptions import ReviewRequiredError

        raise ReviewRequiredError("content has no recorded reviewer; cannot publish")
    return record.model_copy(
        update={
            "status": "published",
            "published_by": publisher_id,
            "published_at": iso_now(),
        }
    )


def submit_for_review(record: ApprovalRecord, *, author_id: str) -> ApprovalRecord:
    assert_content_transition("content", record.status, "review_required")
    return record.model_copy(
        update={
            "status": "review_required",
            "author_id": author_id,
            "reviewer_id": None,
            "reviewed_at": None,
        }
    )


def reject(record: ApprovalRecord, *, reviewer_id: str, note: str) -> ApprovalRecord:
    if not note.strip():
        raise ValidationFailedError("a rejection must carry a note")
    assert_content_transition("content", record.status, "draft")
    return record.model_copy(
        update={
            "status": "draft",
            "reviewer_id": reviewer_id,
            "reviewed_at": iso_now(),
            "review_note": note,
        }
    )


def archive(record: ApprovalRecord) -> ApprovalRecord:
    assert_content_transition("content", record.status, "archived")
    return record.model_copy(update={"status": "archived"})


def record_from_row(row: Any) -> ApprovalRecord:
    from app.services.repository import field

    return ApprovalRecord(
        status=str(field(row, "status", "draft") or "draft"),
        reviewer_id=field(row, "reviewer_id"),
        reviewed_at=_as_str(field(row, "reviewed_at")),
        review_note=field(row, "review_note"),
        published_by=field(row, "published_by"),
        published_at=_as_str(field(row, "published_at")),
        author_id=field(row, "author_id") or field(row, "created_by"),
    )


def _as_str(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def maker_checker_enabled(default: bool = False) -> bool:
    """Tenant switch for dual control (§38 高風險企業)."""
    try:
        from app.core.config import get_settings

        return bool(getattr(get_settings(), "maker_checker_required", default))
    except Exception:  # noqa: BLE001 - settings unavailable in unit tests
        return default


__all__ = [
    "CONTENT_TRANSITIONS",
    "PUBLISHABLE_FROM",
    "REQUIRES_REVIEW",
    "ApprovalRecord",
    "approve",
    "archive",
    "assert_content_transition",
    "maker_checker_enabled",
    "publish",
    "record_from_row",
    "reject",
    "submit_for_review",
]
