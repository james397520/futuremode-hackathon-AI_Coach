"""``/questions`` — Question Bank CRUD, AI generation and review (§14 / §15 / §38)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.enums import ContentStatus, Difficulty, QuestionType, SkillKey
from app.domain.question import Question
from app.domain.request_response import (
    ContentReviewRequest,
    QuestionCreateRequest,
    QuestionGenerateRequest,
    QuestionGenerateResponse,
    QuestionUpdateRequest,
)
from app.services.question_service import QuestionService

router = APIRouter(prefix="/questions", tags=["questions"])

QuestionDep = Annotated[QuestionService, Depends(provide_service(QuestionService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.QUESTION_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.QUESTION_WRITE))]
CanPublish = Annotated[Ctx, Depends(require_permission(Permission.CONTENT_PUBLISH))]


@router.get(
    "",
    response_model=Page[Question],
    summary="Browse the question bank",
    dependencies=[Depends(rate_limit("questions.read", per_minute=180))],
)
async def list_questions(
    service: QuestionDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
    question_type: Annotated[QuestionType | None, Query(alias="type")] = None,
    skill: Annotated[SkillKey | None, Query()] = None,
    difficulty: Annotated[Difficulty | None, Query()] = None,
    knowledge_base_id: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> Page[Question]:
    return await service.list_questions(
        params=params,
        status=status_filter,
        question_type=question_type,
        skill=skill,
        difficulty=difficulty,
        knowledge_base_id=knowledge_base_id,
        query=q,
    )


@router.get("/{question_id}", response_model=Question, summary="Read one question")
async def get_question(question_id: str, service: QuestionDep, ctx: CanRead) -> Question:
    return await service.get_question(question_id)


@router.post(
    "",
    response_model=Question,
    status_code=status.HTTP_201_CREATED,
    summary="Create a question",
    dependencies=[Depends(rate_limit("questions.write", per_minute=60))],
)
async def create_question(
    payload: QuestionCreateRequest, service: QuestionDep, ctx: CanWrite, audit: AuditDep
) -> Question:
    question = await service.create_question(payload)
    await audit(
        AuditAction.QUESTION_CHANGE,
        f"question:{question.id}",
        detail={"operation": "create", "type": question.type.value},
    )
    return question


@router.patch(
    "/{question_id}",
    response_model=Question,
    summary="Update a question (bumps its version)",
    dependencies=[Depends(rate_limit("questions.write", per_minute=60))],
)
async def update_question(
    question_id: str,
    payload: QuestionUpdateRequest,
    service: QuestionDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> Question:
    question = await service.update_question(question_id, payload)
    await audit(
        AuditAction.QUESTION_CHANGE,
        f"question:{question_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return question


@router.post(
    "/generate",
    response_model=QuestionGenerateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate questions from a knowledge base (§15)",
    dependencies=[Depends(rate_limit("questions.generate", per_minute=6, burst=3, cost=3))],
)
async def generate_questions(
    payload: QuestionGenerateRequest,
    service: QuestionDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> QuestionGenerateResponse:
    """Generated questions land in ``review_required`` with citations attached (§15/§38).

    Heavily rate limited: each call is an LLM fan-out over retrieved context (§70).
    """
    result = await service.generate_questions(payload)
    await audit(
        AuditAction.QUESTION_CHANGE,
        f"knowledge_base:{payload.knowledge_base_id}",
        detail={
            "operation": "generate",
            "model": result.model,
            "count": result.generated_count,
        },
    )
    return result


@router.post(
    "/{question_id}/review",
    response_model=Question,
    summary="Approve, publish or archive a question (§38)",
    dependencies=[Depends(rate_limit("questions.review", per_minute=60))],
)
async def review_question(
    question_id: str,
    payload: ContentReviewRequest,
    service: QuestionDep,
    ctx: CanPublish,
    audit: AuditDep,
) -> Question:
    question = await service.review_question(question_id, payload)
    await audit(
        AuditAction.QUESTION_CHANGE,
        f"question:{question_id}",
        detail={"operation": "review", "status": payload.status.value},
    )
    return question


@router.delete(
    "/{question_id}",
    response_model=Acknowledgement,
    summary="Archive a question (soft delete)",
    dependencies=[Depends(rate_limit("questions.write", per_minute=30))],
)
async def delete_question(
    question_id: str, service: QuestionDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_question(question_id)
    await audit(
        AuditAction.QUESTION_CHANGE, f"question:{question_id}", detail={"operation": "delete"}
    )
    return Acknowledgement(ok=True, id=question_id)
