"""Audit log models (spec §42).

Mirrors ``AuditEvent`` in ``packages/shared-types/src/entities.ts``.
``AuditAction`` enumerates the §42 action list; ``record_audit`` in
``app.core.audit`` only accepts these values so the audit table stays queryable.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from app.domain.common import ID, DomainModel, ISODateTime
from app.domain.enums import AuditResult, ComplianceRisk


class AuditAction(StrEnum):
    """§42 recorded actions."""

    LOGIN = "login"
    LOGOUT = "logout"
    FILE_UPLOAD = "file_upload"
    FILE_DELETE = "file_delete"
    KNOWLEDGE_CHANGE = "knowledge_change"
    CHUNK_EDIT = "chunk_edit"
    PERSONA_CHANGE = "persona_change"
    SCENARIO_CHANGE = "scenario_change"
    PROMPT_CHANGE = "prompt_change"
    RUBRIC_CHANGE = "rubric_change"
    MODEL_CHANGE = "model_change"
    PERMISSION_CHANGE = "permission_change"
    REPORT_EXPORT = "report_export"
    API_ACCESS = "api_access"
    SECURITY_FINDING = "security_finding"
    # Session lifecycle is API access with a session ref, but calling it out keeps the
    # §41 Security & Audit table readable.
    SESSION_START = "session_start"
    SESSION_END = "session_end"
    QUESTION_CHANGE = "question_change"
    ASSIGNMENT_CHANGE = "assignment_change"
    INTEGRATION_CHANGE = "integration_change"
    RUNTIME_POLICY_CHANGE = "runtime_policy_change"
    EVALUATION_OVERRIDE = "evaluation_override"
    FINDING_REVIEW = "finding_review"
    RETENTION_PURGE = "retention_purge"


class AuditEvent(DomainModel):
    """§42 audit row: Time | User | Action | Resource | Workspace | IP/Session | Result | Risk."""

    id: ID
    tenant_id: ID
    workspace_id: ID | None = None
    at: ISODateTime
    user_id: ID | None = None
    action: str
    resource: str
    ip: str | None = None
    session_ref: str | None = None
    result: AuditResult
    risk: ComplianceRisk


class AuditQuery(DomainModel):
    """Filters for ``GET /api/v1/audit/events`` (admin / reviewer only)."""

    action: AuditAction | None = None
    user_id: ID | None = None
    resource: str | None = None
    result: AuditResult | None = None
    risk: ComplianceRisk | None = None
    since: ISODateTime | None = None
    until: ISODateTime | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
