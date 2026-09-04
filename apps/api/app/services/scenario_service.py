"""`ScenarioService` — scenario CRUD, the 9-step wizard, versioning, approval (§17, §38).

A scenario is only runnable when it is *coherent*: it references a persona that is
itself published, the knowledge bases it names exist and permit RAG use, and the
9 wizard steps are complete. `validate_for_publish()` checks all of that and returns
the full list of problems, so the builder UI can show them at once rather than one
error per save.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import IntEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.services.approval import (
    ApprovalRecord,
    approve,
    archive,
    maker_checker_enabled,
    publish,
    record_from_row,
    reject,
    submit_for_review,
)
from app.services.base import AUTHORING_ROLES, REVIEW_ROLES, BaseService, iso_now, new_id
from app.services.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.services.repository import Repository, RepositoryPort, field

log = structlog.get_logger(__name__)


class WizardStep(IntEnum):
    """§17 Scenario Builder — 9 Step Wizard."""

    BASICS = 1
    PERSONA = 2
    KNOWLEDGE = 3
    OBJECTIVES = 4
    TALKING_POINTS = 5
    OBJECTIONS = 6
    CONSTRAINTS = 7
    EVALUATION = 8
    REVIEW = 9


#: Fields each wizard step is responsible for.
STEP_FIELDS: dict[WizardStep, tuple[str, ...]] = {
    WizardStep.BASICS: ("name", "description", "industry", "training_type", "mode"),
    WizardStep.PERSONA: ("persona_id",),
    WizardStep.KNOWLEDGE: ("knowledge_base_ids", "required_knowledge"),
    WizardStep.OBJECTIVES: ("learning_objectives", "opening_context"),
    WizardStep.TALKING_POINTS: ("required_talking_points",),
    WizardStep.OBJECTIONS: ("key_objections", "restricted_topics"),
    WizardStep.CONSTRAINTS: ("difficulty", "time_limit_seconds", "max_turns"),
    WizardStep.EVALUATION: (
        "success_condition",
        "failure_condition",
        "minimum_score",
        "rubric_id",
    ),
    WizardStep.REVIEW: (),
}

REQUIRED_FOR_PUBLISH: tuple[str, ...] = (
    "name",
    "persona_id",
    "opening_context",
    "learning_objectives",
    "success_condition",
    "difficulty",
    "mode",
)

DIFFICULTIES = ("easy", "medium", "hard", "expert")


class ValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    step: int
    field_name: str
    message: str


class ScenarioValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool = True
    issues: list[ValidationIssue] = Field(default_factory=list)
    completed_steps: list[int] = Field(default_factory=list)


class ScenarioService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    async def create(self, payload: dict[str, Any]) -> Any:
        self.require_role(*AUTHORING_ROLES, action="create a scenario")
        if not str(payload.get("name", "")).strip():
            raise ValidationFailedError("scenario name is required")
        row = await self.repo.add(
            "Scenario",
            {
                **self.owned_fields(),
                "id": new_id("scn"),
                "version": 1,
                "status": "draft",
                "author_id": self.user_id,
                "mode": payload.get("mode", "training"),
                "difficulty": payload.get("difficulty", "medium"),
                "created_at": iso_now(),
                "updated_at": iso_now(),
                **payload,
            },
        )
        await self.repo.commit()
        self.audit("scenario.create", f"scenario:{field(row, 'id')}")
        return row

    async def get(self, scenario_id: str) -> Any:
        return await self._require(scenario_id)

    async def list(
        self,
        *,
        status: str | None = None,
        mode: str | None = None,
        difficulty: str | None = None,
        limit: int = 100,
    ) -> list[Any]:
        filters: dict[str, Any] = {}
        if status:
            filters["status"] = status
        if mode:
            filters["mode"] = mode
        if difficulty:
            filters["difficulty"] = difficulty
        return await self.repo.list(
            "Scenario", filters=filters, order_by="-updated_at", limit=limit
        )

    async def save_step(
        self, scenario_id: str, step: WizardStep, payload: dict[str, Any]
    ) -> Any:
        """Persist one wizard step. Unknown keys for the step are rejected."""
        row = await self._require(scenario_id)
        self.require_role(*AUTHORING_ROLES, action="edit a scenario")
        allowed = set(STEP_FIELDS[step])
        unexpected = set(payload) - allowed
        if unexpected:
            raise ValidationFailedError(
                f"step {int(step)} does not own fields: {sorted(unexpected)}",
                detail={"allowed": sorted(allowed)},
            )
        self._validate_step(step, payload)
        values = dict(payload)
        if str(field(row, "status", "draft")) in ("approved", "published"):
            values["version"] = int(field(row, "version", 1) or 1) + 1
            values["status"] = "draft"
            values["reviewer_id"] = None
            values["reviewed_at"] = None
            values["author_id"] = self.user_id
        values["updated_at"] = iso_now()
        values["wizard_step"] = max(int(step), int(field(row, "wizard_step", 0) or 0))
        updated = await self.repo.update("Scenario", scenario_id, values)
        await self.repo.commit()
        return updated

    async def update(self, scenario_id: str, payload: dict[str, Any]) -> Any:
        row = await self._require(scenario_id)
        self.require_role(*AUTHORING_ROLES, action="edit a scenario")
        values = dict(payload)
        if str(field(row, "status", "draft")) in ("approved", "published"):
            values["version"] = int(field(row, "version", 1) or 1) + 1
            values["status"] = "draft"
            values["reviewer_id"] = None
            values["reviewed_at"] = None
            values["author_id"] = self.user_id
        values["updated_at"] = iso_now()
        updated = await self.repo.update("Scenario", scenario_id, values)
        await self.repo.commit()
        self.audit("scenario.update", f"scenario:{scenario_id}")
        return updated

    async def duplicate(self, scenario_id: str, *, name: str | None = None) -> Any:
        source = await self._require(scenario_id)
        payload = {
            key: field(source, key)
            for key in (
                "description", "industry", "training_type", "persona_id",
                "knowledge_base_ids", "difficulty", "mode", "opening_context",
                "learning_objectives", "required_knowledge", "required_talking_points",
                "key_objections", "restricted_topics", "success_condition",
                "failure_condition", "time_limit_seconds", "max_turns", "minimum_score",
                "rubric_id", "compliance_rules", "required_disclosures",
            )
            if field(source, key) is not None
        }
        payload["name"] = name or f"{field(source, 'name')} (copy)"
        return await self.create(payload)

    # ------------------------------------------------------------------
    # validation
    # ------------------------------------------------------------------
    async def validate_for_publish(self, scenario_id: str) -> ScenarioValidation:
        row = await self._require(scenario_id)
        issues: list[ValidationIssue] = []

        for name in REQUIRED_FOR_PUBLISH:
            value = field(row, name)
            if value in (None, "", [], {}):
                issues.append(
                    ValidationIssue(
                        step=int(self._step_for(name)),
                        field_name=name,
                        message=f"'{name}' is required before publishing",
                    )
                )
        difficulty = str(field(row, "difficulty", "") or "")
        if difficulty and difficulty not in DIFFICULTIES:
            issues.append(
                ValidationIssue(
                    step=int(WizardStep.CONSTRAINTS),
                    field_name="difficulty",
                    message=f"difficulty must be one of {DIFFICULTIES}",
                )
            )
        mode = str(field(row, "mode", "") or "")
        if mode and mode not in ("training", "assessment"):
            issues.append(
                ValidationIssue(
                    step=int(WizardStep.BASICS),
                    field_name="mode",
                    message="mode must be 'training' or 'assessment'",
                )
            )

        persona_id = field(row, "persona_id")
        if persona_id:
            persona = await self.repo.get("Persona", str(persona_id))
            if persona is None:
                issues.append(
                    ValidationIssue(
                        step=int(WizardStep.PERSONA),
                        field_name="persona_id",
                        message=f"persona {persona_id} does not exist",
                    )
                )
            elif str(field(persona, "status", "")) != "published":
                issues.append(
                    ValidationIssue(
                        step=int(WizardStep.PERSONA),
                        field_name="persona_id",
                        message=(
                            f"persona {persona_id} is "
                            f"'{field(persona, 'status')}'; publish it first (§38)"
                        ),
                    )
                )

        for kb_id in field(row, "knowledge_base_ids") or []:
            kb = await self.repo.get("KnowledgeBase", str(kb_id))
            if kb is None:
                issues.append(
                    ValidationIssue(
                        step=int(WizardStep.KNOWLEDGE),
                        field_name="knowledge_base_ids",
                        message=f"knowledge base {kb_id} does not exist",
                    )
                )
                continue
            from app.services.knowledge_service import AclPermission, KnowledgeService

            knowledge = KnowledgeService(self.db, self.ctx, repo=self.repo)
            if not knowledge._acl_allows(kb, AclPermission.USE_FOR_RAG):  # noqa: SLF001
                issues.append(
                    ValidationIssue(
                        step=int(WizardStep.KNOWLEDGE),
                        field_name="knowledge_base_ids",
                        message=(
                            f"knowledge base {kb_id} does not grant 'use_for_rag' "
                            "to this scenario's audience (§39)"
                        ),
                    )
                )

        if str(field(row, "mode", "")) == "assessment" and not field(row, "rubric_id"):
            issues.append(
                ValidationIssue(
                    step=int(WizardStep.EVALUATION),
                    field_name="rubric_id",
                    message="an assessment scenario must reference a rubric (§28)",
                )
            )
        max_turns = field(row, "max_turns")
        if max_turns is not None and int(max_turns) < 3:
            issues.append(
                ValidationIssue(
                    step=int(WizardStep.CONSTRAINTS),
                    field_name="max_turns",
                    message="max_turns must be at least 3 for a meaningful simulation",
                )
            )

        completed = [
            int(step)
            for step, names in STEP_FIELDS.items()
            if names and all(field(row, name) not in (None, "", [], {}) for name in names)
        ]
        return ScenarioValidation(ok=not issues, issues=issues, completed_steps=completed)

    # ------------------------------------------------------------------
    # approval (§38)
    # ------------------------------------------------------------------
    async def submit_for_review(self, scenario_id: str) -> Any:
        row = await self._require(scenario_id)
        validation = await self.validate_for_publish(scenario_id)
        if not validation.ok:
            raise ConflictError(
                "scenario is incomplete and cannot be submitted for review",
                detail=[issue.model_dump() for issue in validation.issues],
            )
        record = submit_for_review(record_from_row(row), author_id=self.user_id)
        return await self._apply(scenario_id, record, "scenario.submit_review")

    async def approve(self, scenario_id: str, *, note: str | None = None) -> Any:
        row = await self._require(scenario_id)
        record = approve(
            record_from_row(row),
            reviewer_id=self.user_id,
            reviewer_roles=self.roles,
            allowed_roles=REVIEW_ROLES,
            maker_checker=maker_checker_enabled(),
            note=note,
        )
        return await self._apply(scenario_id, record, "scenario.approve")

    async def reject(self, scenario_id: str, *, note: str) -> Any:
        row = await self._require(scenario_id)
        self.require_role(*REVIEW_ROLES, action="reject a scenario")
        record = reject(record_from_row(row), reviewer_id=self.user_id, note=note)
        return await self._apply(scenario_id, record, "scenario.reject")

    async def publish(self, scenario_id: str) -> Any:
        row = await self._require(scenario_id)
        self.require_role(*REVIEW_ROLES, action="publish a scenario")
        validation = await self.validate_for_publish(scenario_id)
        if not validation.ok:
            raise ConflictError(
                "scenario failed validation and cannot be published",
                detail=[issue.model_dump() for issue in validation.issues],
            )
        record = publish(record_from_row(row), publisher_id=self.user_id)
        return await self._apply(scenario_id, record, "scenario.publish")

    async def archive(self, scenario_id: str) -> Any:
        row = await self._require(scenario_id)
        self.require_role(*AUTHORING_ROLES, action="archive a scenario")
        record = archive(record_from_row(row))
        return await self._apply(scenario_id, record, "scenario.archive")

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def _require(self, scenario_id: str) -> Any:
        row = await self.repo.get("Scenario", scenario_id)
        if row is None:
            raise NotFoundError(f"scenario {scenario_id} not found")
        self.assert_same_tenant(row, resource="scenario")
        return row

    async def _apply(self, scenario_id: str, record: ApprovalRecord, action: str) -> Any:
        updated = await self.repo.update(
            "Scenario",
            scenario_id,
            {
                "status": record.status,
                "reviewer_id": record.reviewer_id,
                "reviewed_at": record.reviewed_at,
                "review_note": record.review_note,
                "author_id": record.author_id,
                "updated_at": iso_now(),
            },
        )
        await self.repo.commit()
        self.audit(action, f"scenario:{scenario_id}", status=record.status)
        return updated

    @staticmethod
    def _step_for(field_name: str) -> WizardStep:
        for step, names in STEP_FIELDS.items():
            if field_name in names:
                return step
        return WizardStep.BASICS

    @staticmethod
    def _validate_step(step: WizardStep, payload: dict[str, Any]) -> None:
        if step is WizardStep.CONSTRAINTS:
            difficulty = payload.get("difficulty")
            if difficulty is not None and difficulty not in DIFFICULTIES:
                raise ValidationFailedError(f"difficulty must be one of {DIFFICULTIES}")
            for name in ("time_limit_seconds", "max_turns"):
                value = payload.get(name)
                if value is not None and int(value) <= 0:
                    raise ValidationFailedError(f"{name} must be positive")
        if step is WizardStep.BASICS:
            mode = payload.get("mode")
            if mode is not None and mode not in ("training", "assessment"):
                raise ValidationFailedError("mode must be 'training' or 'assessment'")
        if step is WizardStep.EVALUATION:
            minimum = payload.get("minimum_score")
            if minimum is not None and not 0 <= int(minimum) <= 100:
                raise ValidationFailedError("minimum_score must be 0–100")
        for name in ("learning_objectives", "required_talking_points", "key_objections",
                     "restricted_topics", "required_knowledge", "knowledge_base_ids"):
            value = payload.get(name)
            if value is not None and not isinstance(value, (list, tuple)):
                raise ValidationFailedError(f"{name} must be a list")


__all__ = [
    "DIFFICULTIES",
    "REQUIRED_FOR_PUBLISH",
    "STEP_FIELDS",
    "ScenarioService",
    "ScenarioValidation",
    "ValidationIssue",
    "WizardStep",
]
