"""`EvaluationService` — final scoring, calibration, recommendations (§26–§28, §33).

* **final evaluation** — runs `EvaluatorAgent` over the pinned transcript, so the
  score is reproducible from the session's pinned scenario/persona versions (§54).
* **evidence assembly** — the §27 requirement: every dimension expands into a real
  quote with a timestamp. The agent verifies quotes; this service additionally refuses
  to persist an evaluation where a *scored* dimension has no evidence and yet claims
  high confidence.
* **rubric weighting + pass/fail** — weights come from the pinned rubric, and a
  high/critical compliance finding fails the session regardless of score.
* **human override + calibration diff** (§28) — the AI score is never overwritten;
  the human score is stored alongside it with the difference and a calibration note,
  which is what the rubric-calibration screen consumes.
* **skill profile + recommendations** (§33) — next scenario / retry / material /
  question set / weak skills / suggested difficulty.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.evaluator_agent import (
    LOW_CONFIDENCE,
    SKILL_KEYS,
    EvaluationDraft,
    EvaluationRequest,
    EvaluatorAgent,
    TranscriptRef,
    TurnObservation,
)
from app.agents.llm_client import LlmPort
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.services.base import (
    MANAGEMENT_ROLES,
    REVIEW_ROLES,
    ROLE_COACH,
    BaseService,
    iso_now,
    new_id,
)
from app.services.exceptions import (
    ConflictError,
    NotFoundError,
    ValidationFailedError,
)
from app.services.repository import Repository, RepositoryPort, field

log = structlog.get_logger(__name__)

DEFAULT_PASS_THRESHOLD = 60
#: §26.1 default weights — every dimension equal until a tenant calibrates (§28).
DEFAULT_WEIGHTS: dict[str, float] = {key: 1.0 for key in SKILL_KEYS}
DIFFICULTY_LADDER = ("easy", "medium", "hard", "expert")


class CalibrationDiff(BaseModel):
    """§28 AI Score / Human Score / Difference / Calibration Note."""

    model_config = ConfigDict(extra="forbid")

    ai_score: int
    human_score: int
    difference: int
    per_skill: dict[str, int] = Field(default_factory=dict)
    calibration_note: str | None = None
    reviewer_id: str = ""
    at: str = Field(default_factory=iso_now)


class Recommendation(BaseModel):
    """Mirrors the `Recommendation` interface in shared (§33)."""

    model_config = ConfigDict(extra="forbid")

    next_scenario_id: str | None = None
    retry_scenario_id: str | None = None
    knowledge_material: list[dict[str, str]] = Field(default_factory=list)
    question_set_ids: list[str] = Field(default_factory=list)
    weak_skills: list[str] = Field(default_factory=list)
    suggested_difficulty: str = "medium"


class EvaluationView(BaseModel):
    """Mirrors the `Evaluation` entity (§26/§27)."""

    model_config = ConfigDict(extra="forbid")

    id: str
    session_id: str
    rubric_id: str | None = None
    overall_score: int = 0
    goal_achieved: bool = False
    passed: bool = False
    skills: list[dict[str, Any]] = Field(default_factory=list)
    key_strength: str = ""
    main_improvement: str = ""
    compliance_status: str = "safe"
    human_override: dict[str, Any] | None = None
    created_at: str = Field(default_factory=iso_now)
    dimensions_without_evidence: list[str] = Field(default_factory=list)
    rejected_quotes: int = 0


class EvaluationService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
        llm: LlmPort | None = None,
        evaluator: EvaluatorAgent | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        self._llm = llm
        self._evaluator = evaluator

    # ------------------------------------------------------------------
    # final evaluation
    # ------------------------------------------------------------------
    async def evaluate_session(
        self, session_id: str, *, observations: Sequence[TurnObservation] = ()
    ) -> EvaluationView:
        session = await self._require_session(session_id)
        if str(field(session, "status", "")) != "completed":
            raise ConflictError("a session must be completed before it is evaluated")
        existing = await self.repo.list("Evaluation", filters={"session_id": session_id})
        if existing:
            return self._to_view(existing[0])

        pinned = dict(field(session, "pinned_snapshot") or {})
        scenario = dict(pinned.get("scenario") or {})
        rubric = await self._rubric(pinned.get("rubric_id") or scenario.get("rubric_id"))
        transcript = await self._transcript(session_id)
        findings = await self.repo.list("ComplianceFinding", filters={"session_id": session_id})

        agent = self._evaluator or EvaluatorAgent(
            self._llm if self._llm is not None else self._default_llm(),
            locale=str((pinned.get("persona") or {}).get("locale") or "zh-TW"),
        )
        request = EvaluationRequest(
            transcript=transcript,
            observations=list(observations),
            locale=str((pinned.get("persona") or {}).get("locale") or "zh-TW"),
            mode=str(field(session, "mode", "training")),
            rubric_weights=rubric["weights"],
            pass_threshold=rubric["pass_threshold"],
            required_evidence=rubric["required_evidence"],
            forbidden_behaviors=rubric["forbidden_behaviors"],
            learning_objectives=list(scenario.get("learning_objectives") or []),
            success_condition=str(scenario.get("success_condition") or ""),
            compliance_findings=[_row(f) for f in findings],
            custom_skills=rubric["custom_skills"],
        )
        draft = await agent.run(request)
        self._assert_evidence_discipline(draft)

        goal_achieved = self._goal_achieved(draft, scenario)
        passed = (
            draft.overall_score >= rubric["pass_threshold"]
            and draft.compliance_status not in ("high", "critical")
            and (goal_achieved or draft.overall_score >= rubric["pass_threshold"] + 10)
        )
        evaluation_id = new_id("ev")
        row = await self.repo.add(
            "Evaluation",
            {
                **self.owned_fields(),
                "id": evaluation_id,
                "session_id": session_id,
                "user_id": str(field(session, "user_id", "")),
                "rubric_id": rubric["id"],
                "rubric_version": rubric["version"],
                "overall_score": draft.overall_score,
                "goal_achieved": goal_achieved,
                "passed": passed,
                "skills": [skill.model_dump() for skill in draft.skills],
                "key_strength": draft.key_strength,
                "main_improvement": draft.main_improvement,
                "compliance_status": draft.compliance_status,
                "dimensions_without_evidence": draft.dimensions_without_evidence,
                "rejected_quotes": draft.rejected_quotes,
                "created_at": iso_now(),
            },
        )
        await self.repo.update(
            "TrainingSession", session_id, {"evaluation_id": evaluation_id}
        )
        await self.repo.commit()
        await self.update_skill_profile(str(field(session, "user_id", "")), draft)
        self.audit(
            "evaluation.create",
            f"session:{session_id}",
            score=draft.overall_score,
            passed=passed,
        )
        return self._to_view(row)

    @staticmethod
    def _assert_evidence_discipline(draft: EvaluationDraft) -> None:
        """§27: a confident score must be backed by evidence.

        The agent already neutralises unsupported dimensions; this is the belt-and-
        braces check that stops a mis-wired agent from persisting a confident,
        evidence-free score.
        """
        offenders = [
            skill.skill
            for skill in draft.skills
            if not skill.evidence and skill.confidence > LOW_CONFIDENCE
        ]
        if offenders:
            raise ValidationFailedError(
                "evaluation rejected: these dimensions claim confidence without "
                f"evidence: {offenders} (§27)"
            )

    @staticmethod
    def _goal_achieved(draft: EvaluationDraft, scenario: dict[str, Any]) -> bool:
        goal = next(
            (skill for skill in draft.skills if str(skill.skill) == "goal_achievement"),
            None,
        )
        if goal is None:
            return draft.goal_achieved
        minimum = int(scenario.get("minimum_score") or DEFAULT_PASS_THRESHOLD)
        return bool(goal.evidence) and goal.score >= minimum

    # ------------------------------------------------------------------
    # human override + calibration (§28)
    # ------------------------------------------------------------------
    async def human_override(
        self,
        evaluation_id: str,
        *,
        score: int,
        note: str | None = None,
        per_skill: dict[str, int] | None = None,
    ) -> tuple[EvaluationView, CalibrationDiff]:
        """Record a reviewer's score **alongside** the AI score, never over it."""
        self.require_role(*REVIEW_ROLES, action="override an evaluation score")
        row = await self._require_evaluation(evaluation_id)
        if not 0 <= score <= 100:
            raise ValidationFailedError("override score must be 0–100")
        ai_score = int(field(row, "overall_score", 0) or 0)
        ai_skills = {
            str(skill.get("skill")): int(skill.get("score", 0) or 0)
            for skill in (field(row, "skills") or [])
        }
        diff = CalibrationDiff(
            ai_score=ai_score,
            human_score=score,
            difference=score - ai_score,
            per_skill={
                key: int(value) - ai_skills.get(key, 0)
                for key, value in (per_skill or {}).items()
            },
            calibration_note=note,
            reviewer_id=self.user_id,
        )
        override = {
            "reviewer_id": self.user_id,
            "score": score,
            "note": note,
            "at": iso_now(),
        }
        updated = await self.repo.update(
            "Evaluation",
            evaluation_id,
            {"human_override": override, "calibration_diff": diff.model_dump()},
        )
        await self.repo.commit()
        self.audit(
            "evaluation.human_override",
            f"evaluation:{evaluation_id}",
            difference=diff.difference,
        )
        return self._to_view(updated), diff

    async def calibration_report(
        self, *, rubric_id: str | None = None, limit: int = 200
    ) -> dict[str, Any]:
        """Aggregate AI-vs-human differences so a manager can tune weights (§28)."""
        self.require_role(*MANAGEMENT_ROLES, ROLE_COACH, action="view calibration")
        filters = {"rubric_id": rubric_id} if rubric_id else {}
        rows = await self.repo.list(
            "Evaluation", filters=filters, order_by="-created_at", limit=limit
        )
        diffs = [
            field(row, "calibration_diff")
            for row in rows
            if field(row, "calibration_diff")
        ]
        if not diffs:
            return {"sample_size": 0, "mean_difference": 0.0, "per_skill": {}}
        mean = sum(int(d.get("difference", 0)) for d in diffs) / len(diffs)
        per_skill: dict[str, list[int]] = {}
        for entry in diffs:
            for key, value in (entry.get("per_skill") or {}).items():
                per_skill.setdefault(key, []).append(int(value))
        return {
            "sample_size": len(diffs),
            "mean_difference": round(mean, 2),
            "bias": "ai_too_generous" if mean < 0 else ("ai_too_harsh" if mean > 0 else "aligned"),
            "per_skill": {
                key: round(sum(values) / len(values), 2) for key, values in per_skill.items()
            },
        }

    # ------------------------------------------------------------------
    # skill profile + recommendations (§33, §34)
    # ------------------------------------------------------------------
    async def update_skill_profile(self, user_id: str, draft: EvaluationDraft) -> Any:
        if not user_id:
            return None
        rows = await self.repo.list("SkillProfile", filters={"user_id": user_id})
        current = rows[0] if rows else None
        previous = dict(field(current, "skills") or {}) if current else {}
        scores = {
            str(skill.skill): int(skill.score)
            for skill in draft.skills
            if str(skill.skill) in SKILL_KEYS
        }
        # Exponential moving average: one session should nudge, not redefine, a profile.
        blended = {
            key: int(round(0.7 * previous.get(key, value) + 0.3 * value))
            for key, value in scores.items()
        }
        completed = int(field(current, "completed_sessions", 0) or 0) + 1
        overall = int(round(sum(blended.values()) / max(len(blended), 1)))
        trend = list(field(current, "compliance_trend") or [])
        trend.append(
            {"safe": 100, "low": 85, "medium": 60, "high": 30, "critical": 0}.get(
                draft.compliance_status, 100
            )
        )
        values = {
            "user_id": user_id,
            "overall_score": overall,
            "skills": blended,
            "weakest_skill": min(blended, key=lambda k: blended[k]) if blended else None,
            "strongest_skill": max(blended, key=lambda k: blended[k]) if blended else None,
            "completed_sessions": completed,
            "monthly_improvement": overall - int(field(current, "overall_score", overall) or overall),
            "compliance_trend": trend[-12:],
            "updated_at": iso_now(),
        }
        if current is None:
            row = await self.repo.add(
                "SkillProfile", {**self.owned_fields(), "id": new_id("sp"), **values}
            )
        else:
            row = await self.repo.update("SkillProfile", str(field(current, "id")), values)
        await self.repo.commit()
        return row

    async def recommend(self, session_id: str) -> Recommendation:
        """§33 recommendation engine."""
        session = await self._require_session(session_id)
        evaluations = await self.repo.list("Evaluation", filters={"session_id": session_id})
        if not evaluations:
            raise NotFoundError(f"session {session_id} has no evaluation yet")
        evaluation = evaluations[0]
        skills = field(evaluation, "skills") or []
        weak = sorted(
            (
                (str(skill.get("skill")), int(skill.get("score", 0) or 0))
                for skill in skills
                if str(skill.get("skill")) in SKILL_KEYS
                and float(skill.get("confidence", 0) or 0) > LOW_CONFIDENCE
            ),
            key=lambda pair: pair[1],
        )
        weak_skills = [name for name, score in weak[:3] if score < 70]

        pinned = dict(field(session, "pinned_snapshot") or {})
        scenario = dict(pinned.get("scenario") or {})
        difficulty = str(scenario.get("difficulty") or "medium")
        passed = bool(field(evaluation, "passed", False))
        suggested = self._suggest_difficulty(difficulty, passed=passed)

        retry_id = None if passed else str(field(session, "scenario_id", ""))
        next_id = await self._next_scenario(
            difficulty=suggested, weak_skills=weak_skills, exclude=str(field(session, "scenario_id", ""))
        )
        material = await self._material_for(weak_skills, pinned.get("knowledge_base_ids") or [])
        question_sets = await self._question_sets_for(weak_skills)
        return Recommendation(
            next_scenario_id=next_id if passed else None,
            retry_scenario_id=retry_id,
            knowledge_material=material,
            question_set_ids=question_sets,
            weak_skills=weak_skills,
            suggested_difficulty=suggested,
        )

    @staticmethod
    def _suggest_difficulty(current: str, *, passed: bool) -> str:
        """Escalate on success; hold on failure. Never drop below the entry level."""
        if current not in DIFFICULTY_LADDER:
            return "medium"
        index = DIFFICULTY_LADDER.index(current)
        if passed and index < len(DIFFICULTY_LADDER) - 1:
            return DIFFICULTY_LADDER[index + 1]
        return current

    async def _next_scenario(
        self, *, difficulty: str, weak_skills: Sequence[str], exclude: str
    ) -> str | None:
        candidates = await self.repo.list(
            "Scenario", filters={"status": "published", "difficulty": difficulty}, limit=50
        )
        for row in candidates:
            if str(field(row, "id")) == exclude:
                continue
            objectives = " ".join(str(o) for o in (field(row, "learning_objectives") or []))
            if not weak_skills or any(skill.split("_")[0] in objectives for skill in weak_skills):
                return str(field(row, "id"))
        return next(
            (str(field(row, "id")) for row in candidates if str(field(row, "id")) != exclude),
            None,
        )

    async def _material_for(
        self, weak_skills: Sequence[str], knowledge_base_ids: Sequence[str]
    ) -> list[dict[str, str]]:
        if not knowledge_base_ids:
            return []
        documents = await self.repo.list(
            "KnowledgeDocument",
            filters={"knowledge_base_id": list(knowledge_base_ids), "state": "ready"},
            limit=10,
        )
        reason = (
            f"補強 {', '.join(weak_skills[:2])}" if weak_skills else "複習本次情境的核心知識"
        )
        return [
            {"document_id": str(field(document, "id")), "reason": reason}
            for document in documents[:3]
        ]

    async def _question_sets_for(self, weak_skills: Sequence[str]) -> list[str]:
        if not weak_skills:
            return []
        rows = await self.repo.list(
            "Question",
            filters={"status": "published", "skill": list(weak_skills)},
            limit=20,
        )
        return [str(field(row, "id")) for row in rows]

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def get(self, evaluation_id: str) -> EvaluationView:
        return self._to_view(await self._require_evaluation(evaluation_id))

    async def for_session(self, session_id: str) -> EvaluationView | None:
        await self._require_session(session_id)
        rows = await self.repo.list("Evaluation", filters={"session_id": session_id})
        return self._to_view(rows[0]) if rows else None

    async def _require_session(self, session_id: str) -> Any:
        row = await self.repo.get("TrainingSession", session_id)
        if row is None:
            raise NotFoundError(f"session {session_id} not found")
        self.assert_same_tenant(row, resource="session")
        self.require_self_or_role(
            str(field(row, "user_id", "")),
            ROLE_COACH,
            *MANAGEMENT_ROLES,
            *REVIEW_ROLES,
            action="access this session's evaluation",
        )
        return row

    async def _require_evaluation(self, evaluation_id: str) -> Any:
        row = await self.repo.get("Evaluation", evaluation_id)
        if row is None:
            raise NotFoundError(f"evaluation {evaluation_id} not found")
        self.assert_same_tenant(row, resource="evaluation")
        return row

    async def _transcript(self, session_id: str) -> list[TranscriptRef]:
        turns = await self.repo.list(
            "TranscriptTurn", filters={"session_id": session_id}, order_by="timestamp_ms"
        )
        return [
            TranscriptRef(
                id=str(field(turn, "id")),
                speaker=str(field(turn, "speaker", "")),
                text=str(field(turn, "text", "")),
                timestamp_ms=int(field(turn, "timestamp_ms", 0) or 0),
            )
            for turn in turns
        ]

    async def _rubric(self, rubric_id: Any) -> dict[str, Any]:
        if rubric_id:
            row = await self.repo.get("Rubric", str(rubric_id))
            if row is not None:
                self.assert_same_tenant(row, resource="rubric")
                weights = dict(field(row, "weights") or {}) or DEFAULT_WEIGHTS
                return {
                    "id": str(field(row, "id")),
                    "version": int(field(row, "version", 1) or 1),
                    "weights": weights,
                    "pass_threshold": int(
                        field(row, "pass_threshold", DEFAULT_PASS_THRESHOLD)
                        or DEFAULT_PASS_THRESHOLD
                    ),
                    "required_evidence": list(field(row, "required_evidence") or []),
                    "forbidden_behaviors": list(field(row, "forbidden_behaviors") or []),
                    "custom_skills": list(field(row, "custom_skills") or []),
                }
        return {
            "id": None,
            "version": None,
            "weights": dict(DEFAULT_WEIGHTS),
            "pass_threshold": DEFAULT_PASS_THRESHOLD,
            "required_evidence": [],
            "forbidden_behaviors": [],
            "custom_skills": [],
        }

    @staticmethod
    def _to_view(row: Any) -> EvaluationView:
        return EvaluationView(
            id=str(field(row, "id", "")),
            session_id=str(field(row, "session_id", "")),
            rubric_id=field(row, "rubric_id"),
            overall_score=int(field(row, "overall_score", 0) or 0),
            goal_achieved=bool(field(row, "goal_achieved", False)),
            passed=bool(field(row, "passed", False)),
            skills=list(field(row, "skills") or []),
            key_strength=str(field(row, "key_strength", "") or ""),
            main_improvement=str(field(row, "main_improvement", "") or ""),
            compliance_status=str(field(row, "compliance_status", "safe") or "safe"),
            human_override=field(row, "human_override"),
            created_at=str(field(row, "created_at") or iso_now()),
            dimensions_without_evidence=list(field(row, "dimensions_without_evidence") or []),
            rejected_quotes=int(field(row, "rejected_quotes", 0) or 0),
        )

    def _default_llm(self) -> LlmPort:
        from app.services.factory import build_llm

        return build_llm(self.ctx)


def _row(entity: Any) -> dict[str, Any]:
    if isinstance(entity, dict):
        return dict(entity)
    if hasattr(entity, "__table__"):
        return {c.name: getattr(entity, c.name) for c in entity.__table__.columns}
    return {
        key: getattr(entity, key)
        for key in dir(entity)
        if not key.startswith("_") and not callable(getattr(entity, key))
    }


__all__ = [
    "DEFAULT_PASS_THRESHOLD",
    "DEFAULT_WEIGHTS",
    "CalibrationDiff",
    "EvaluationService",
    "EvaluationView",
    "Recommendation",
]
