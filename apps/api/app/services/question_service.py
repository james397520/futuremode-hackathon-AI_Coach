"""`QuestionService` — question bank + AI generation + the review gate (§14, §15).

    禁止 AI 題目未審核直接進正式合規考試。 (spec §15)

That prohibition is enforced in two independent places:

1. `publish()` routes through `app.services.approval.publish()`, which refuses any
   status in `REQUIRES_REVIEW` and requires a recorded `reviewer_id`.
2. `assert_exam_ready()` is a second, narrower gate for compliance exams: it demands
   `status == published`, a reviewer, and — for AI-generated items — at least one
   verified citation. Assignment/exam assembly calls it, so even a mis-set status row
   cannot slip an unreviewed generated question into a compliance exam.

Generation itself always produces `status='generated'` with `generated_by_model` and
citations attached, and every generated question whose answer cannot be traced to a
retrieved chunk is dropped before it is ever written (§15 Source Verification).
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import LlmPort, ModelPurpose
from app.agents.patterns import fold
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.mining import question_gen_system_prompt
from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.rag.pipeline import RagPipeline
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
from app.services.base import (
    AUTHORING_ROLES,
    REVIEW_ROLES,
    BaseService,
    iso_now,
    new_id,
)
from app.services.exceptions import (
    NotFoundError,
    ReviewRequiredError,
    ValidationFailedError,
)
from app.services.repository import Repository, RepositoryPort, field

log = structlog.get_logger(__name__)


class QuestionType(StrEnum):
    """Mirrors `QuestionType` in packages/shared-types/src/entities.ts (§14)."""

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


#: Types that constitute a formal compliance exam item (§15's prohibition target).
COMPLIANCE_EXAM_TYPES = frozenset({QuestionType.COMPLIANCE, QuestionType.KNOWLEDGE_CHECK})


class QuestionDraft(BaseModel):
    """One generated question. Structured output (spec §66)."""

    model_config = ConfigDict(extra="forbid")

    title: str
    type: QuestionType = QuestionType.MULTIPLE_CHOICE
    prompt: str
    options: list[str] = Field(default_factory=list)
    correct_answer: str | None = None
    rubric: str | None = None
    required_keywords: list[str] = Field(default_factory=list)
    forbidden_claims: list[str] = Field(default_factory=list)
    compliance_rules: list[str] = Field(default_factory=list)
    explanation: str | None = None
    difficulty: str = "medium"
    skill: str | None = None
    tags: list[str] = Field(default_factory=list)
    #: indexes into the supplied source chunks — a question with none is discarded
    citation_indexes: list[int] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class GenerationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    questions: list[QuestionDraft] = Field(default_factory=list)
    note: str = ""


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_base_id: str
    topic: str
    count: int = Field(default=5, ge=1, le=25)
    question_type: QuestionType = QuestionType.MULTIPLE_CHOICE
    difficulty: str = "medium"
    skill: str | None = None
    locale: str = "zh-TW"


class GenerationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    created_ids: list[str] = Field(default_factory=list)
    discarded: int = 0
    citations_used: int = 0
    model: str = ""
    note: str = ""


class QuestionGenerationAgent(Agent[dict, GenerationOutput]):
    """Source-verified question generation (§15)."""

    name = "knowledge"
    purpose = ModelPurpose.QUESTION_GEN
    output_model = GenerationOutput
    optional = True
    default_temperature = 0.4
    default_max_tokens = 3000

    def system_prompt(self) -> str:
        return question_gen_system_prompt(self.locale)

    def build_user_prompt(self, request: dict) -> str:
        return "\n\n".join(
            [
                data_block(
                    "request",
                    {
                        "topic": request.get("topic"),
                        "count": request.get("count"),
                        "question_type": request.get("question_type"),
                        "difficulty": request.get("difficulty"),
                        "skill": request.get("skill"),
                    },
                ),
                data_block("source_chunks", request.get("source_chunks") or []),
                untrusted_block("topic_text", str(request.get("topic") or "")),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: dict) -> GenerationOutput:
        return await self._invoke_structured(self._messages(request))


class QuestionService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
        rag: RagPipeline | None = None,
        llm: LlmPort | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        self._rag = rag
        self._llm = llm

    # ------------------------------------------------------------------
    # CRUD (§14)
    # ------------------------------------------------------------------
    async def create(self, payload: dict[str, Any]) -> Any:
        self.require_role(*AUTHORING_ROLES, action="create a question")
        self._validate(payload)
        row = await self.repo.add(
            "Question",
            {
                **self.owned_fields(),
                "id": new_id("q"),
                "version": 1,
                "status": "draft",
                "author_id": self.user_id,
                "created_at": iso_now(),
                "updated_at": iso_now(),
                **payload,
            },
        )
        await self.repo.commit()
        self.audit("question.create", f"question:{field(row, 'id')}")
        return row

    async def get(self, question_id: str) -> Any:
        row = await self.repo.get("Question", question_id)
        if row is None:
            raise NotFoundError(f"question {question_id} not found")
        self.assert_same_tenant(row, resource="question")
        return row

    async def list(
        self,
        *,
        status: str | None = None,
        question_type: QuestionType | None = None,
        skill: str | None = None,
        knowledge_base_id: str | None = None,
        limit: int = 100,
    ) -> list[Any]:
        filters: dict[str, Any] = {}
        if status:
            filters["status"] = status
        if question_type:
            filters["type"] = str(question_type)
        if skill:
            filters["skill"] = skill
        if knowledge_base_id:
            filters["knowledge_base_id"] = knowledge_base_id
        return await self.repo.list(
            "Question", filters=filters, order_by="-updated_at", limit=limit
        )

    async def update(self, question_id: str, payload: dict[str, Any]) -> Any:
        row = await self.get(question_id)
        self.require_role(*AUTHORING_ROLES, action="edit a question")
        status = str(field(row, "status", "draft"))
        values = dict(payload)
        if status in ("approved", "published"):
            # Editing published content starts a new version that must be re-reviewed.
            values["version"] = int(field(row, "version", 1) or 1) + 1
            values["status"] = "draft"
            values["reviewer_id"] = None
            values["reviewed_at"] = None
            values["author_id"] = self.user_id
        values["updated_at"] = iso_now()
        updated = await self.repo.update("Question", question_id, values)
        await self.repo.commit()
        self.audit("question.update", f"question:{question_id}")
        return updated

    async def delete(self, question_id: str) -> bool:
        await self.get(question_id)
        self.require_role(*AUTHORING_ROLES, action="delete a question")
        deleted = await self.repo.delete("Question", question_id)
        await self.repo.commit()
        self.audit("question.delete", f"question:{question_id}")
        return deleted

    # ------------------------------------------------------------------
    # review gate (§15, §38)
    # ------------------------------------------------------------------
    async def submit_for_review(self, question_id: str) -> Any:
        row = await self.get(question_id)
        record = submit_for_review(record_from_row(row), author_id=self.user_id)
        return await self._apply(question_id, record, "question.submit_review")

    async def approve(self, question_id: str, *, note: str | None = None) -> Any:
        row = await self.get(question_id)
        record = approve(
            record_from_row(row),
            reviewer_id=self.user_id,
            reviewer_roles=self.roles,
            allowed_roles=REVIEW_ROLES,
            maker_checker=maker_checker_enabled(),
            note=note,
        )
        return await self._apply(question_id, record, "question.approve")

    async def reject(self, question_id: str, *, note: str) -> Any:
        row = await self.get(question_id)
        self.require_role(*REVIEW_ROLES, action="reject a question")
        record = reject(record_from_row(row), reviewer_id=self.user_id, note=note)
        return await self._apply(question_id, record, "question.reject")

    async def publish(self, question_id: str) -> Any:
        row = await self.get(question_id)
        self.require_role(*REVIEW_ROLES, action="publish a question")
        record = publish(record_from_row(row), publisher_id=self.user_id)
        return await self._apply(question_id, record, "question.publish")

    async def archive(self, question_id: str) -> Any:
        row = await self.get(question_id)
        self.require_role(*AUTHORING_ROLES, action="archive a question")
        record = archive(record_from_row(row))
        return await self._apply(question_id, record, "question.archive")

    async def assert_exam_ready(self, question_ids: Sequence[str]) -> list[Any]:
        """Second gate: what a compliance exam is allowed to contain (§15).

        Raises `ReviewRequiredError` naming every offending question rather than
        silently dropping it — an exam that quietly lost an item is worse than an
        error at assembly time.
        """
        problems: list[str] = []
        rows: list[Any] = []
        for question_id in question_ids:
            row = await self.get(question_id)
            rows.append(row)
            status = str(field(row, "status", "draft"))
            reviewer = field(row, "reviewer_id")
            generated_by = field(row, "generated_by_model")
            citations = field(row, "citations") or []
            if status != "published":
                problems.append(f"{question_id}: status is '{status}', not 'published'")
                continue
            if not reviewer:
                problems.append(f"{question_id}: no human reviewer recorded")
            if generated_by and not citations:
                problems.append(
                    f"{question_id}: AI-generated with no verified source citation"
                )
        if problems:
            raise ReviewRequiredError(
                "these questions may not be used in a compliance exam: "
                + "; ".join(problems),
                detail={"problems": problems},
            )
        return rows

    # ------------------------------------------------------------------
    # AI generation (§15)
    # ------------------------------------------------------------------
    async def generate(self, request: GenerateRequest) -> GenerationResult:
        self.require_role(*AUTHORING_ROLES, action="generate questions")
        rag = await self._pipeline([request.knowledge_base_id])
        retrieved = await rag.query(
            request.topic,
            knowledge_base_ids=[request.knowledge_base_id],
            top_k=max(request.count * 2, 8),
        )
        if not retrieved.citations:
            raise ValidationFailedError(
                "no source material found for this topic; a question without a "
                "verifiable source cannot be generated (§15)"
            )
        source_chunks = [
            {
                "index": index,
                "document": citation.document_name,
                "page": citation.page,
                "section": citation.section,
                "text": citation.snippet,
            }
            for index, citation in enumerate(retrieved.citations)
        ]
        agent = QuestionGenerationAgent(
            self._llm if self._llm is not None else self._default_llm(),
            locale=request.locale,
        )
        output = await agent.run(
            {
                "topic": request.topic,
                "count": request.count,
                "question_type": str(request.question_type),
                "difficulty": request.difficulty,
                "skill": request.skill,
                "source_chunks": source_chunks,
            }
        )

        created: list[str] = []
        discarded = 0
        used_citations = 0
        for draft in output.questions[: request.count]:
            citations = self._verify_sources(draft, retrieved.citations)
            if not citations:
                discarded += 1
                log.warning("question.discarded_unsourced", title=draft.title[:40])
                continue
            used_citations += len(citations)
            row = await self.repo.add(
                "Question",
                {
                    **self.owned_fields(),
                    "id": new_id("q"),
                    "title": draft.title,
                    "type": str(draft.type),
                    "prompt": draft.prompt,
                    "options": draft.options,
                    "knowledge_base_id": request.knowledge_base_id,
                    "skill": draft.skill or request.skill,
                    "difficulty": draft.difficulty or request.difficulty,
                    "correct_answer": draft.correct_answer,
                    "rubric": draft.rubric,
                    "required_keywords": draft.required_keywords,
                    "forbidden_claims": draft.forbidden_claims,
                    "compliance_rules": draft.compliance_rules,
                    "explanation": draft.explanation,
                    "tags": [*draft.tags, "ai_generated"],
                    "version": 1,
                    # never 'draft': a generated item is visibly unreviewed (§15)
                    "status": "generated",
                    "generated_by_model": _model_name(agent),
                    "citations": [c.as_dict() for c in citations],
                    "confidence": draft.confidence,
                    "author_id": self.user_id,
                    "reviewer_id": None,
                    "reviewed_at": None,
                    "created_at": iso_now(),
                    "updated_at": iso_now(),
                },
            )
            created.append(str(field(row, "id")))
        await self.repo.commit()
        self.audit(
            "question.generate",
            f"kb:{request.knowledge_base_id}",
            created=len(created),
            discarded=discarded,
        )
        return GenerationResult(
            created_ids=created,
            discarded=discarded,
            citations_used=used_citations,
            model=_model_name(agent),
            note=output.note,
        )

    @staticmethod
    def _verify_sources(draft: QuestionDraft, citations: Sequence[Any]) -> list[Any]:
        """§15 Source Verification.

        A citation index must exist, and the correct answer must actually appear in the
        cited snippet (token overlap) — otherwise the model invented the answer and the
        question is discarded rather than stored for a reviewer to rubber-stamp.
        """
        chosen = [
            citations[index]
            for index in draft.citation_indexes
            if 0 <= index < len(citations)
        ]
        if not chosen:
            return []
        answer = fold(draft.correct_answer or "")
        if not answer or draft.type in (
            QuestionType.OPEN_ENDED,
            QuestionType.ROLE_PLAY,
            QuestionType.SCENARIO,
            QuestionType.VOICE_RESPONSE,
        ):
            return chosen
        haystack = fold(" ".join(getattr(c, "snippet", "") for c in chosen))
        if answer in haystack:
            return chosen
        tokens = [token for token in _tokens(answer) if len(token) >= 2]
        if tokens and sum(1 for token in tokens if token in haystack) / len(tokens) >= 0.6:
            return chosen
        return []

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def _apply(self, question_id: str, record: ApprovalRecord, action: str) -> Any:
        updated = await self.repo.update(
            "Question",
            question_id,
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
        self.audit(action, f"question:{question_id}", status=record.status)
        return updated

    @staticmethod
    def _validate(payload: dict[str, Any]) -> None:
        if not str(payload.get("title", "")).strip():
            raise ValidationFailedError("question title is required")
        if not str(payload.get("prompt", "")).strip():
            raise ValidationFailedError("question prompt is required")
        question_type = str(payload.get("type", "multiple_choice"))
        if question_type == QuestionType.MULTIPLE_CHOICE:
            options = payload.get("options") or []
            if len(options) < 2:
                raise ValidationFailedError("multiple choice needs at least two options")
            if not payload.get("correct_answer"):
                raise ValidationFailedError("multiple choice needs a correct answer")
        if question_type == QuestionType.COMPLIANCE and not payload.get("compliance_rules"):
            raise ValidationFailedError(
                "a compliance question must reference at least one compliance rule"
            )

    async def _pipeline(self, knowledge_base_ids: Sequence[str]) -> RagPipeline:
        if self._rag is not None:
            return self._rag
        from app.services.knowledge_service import AclPermission, KnowledgeService

        knowledge = KnowledgeService(self.db, self.ctx, repo=self.repo)
        for kb_id in knowledge_base_ids:
            await knowledge.get_kb(kb_id, permission=AclPermission.USE_FOR_RAG)
        return await knowledge.retrieval_pipeline(knowledge_base_ids)

    def _default_llm(self) -> LlmPort:
        from app.services.factory import build_llm

        return build_llm(self.ctx)


def _model_name(agent: Agent[Any, Any]) -> str:
    client = getattr(agent, "llm", None)
    return str(getattr(client, "provider", "unknown"))


def _tokens(text: str) -> list[str]:
    import re

    return [t for t in re.split(r"[\s,，。;；:：]+", text) if t]


__all__ = [
    "COMPLIANCE_EXAM_TYPES",
    "GenerateRequest",
    "GenerationOutput",
    "GenerationResult",
    "QuestionDraft",
    "QuestionGenerationAgent",
    "QuestionService",
    "QuestionType",
]
