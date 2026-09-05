"""Post-session scoring jobs (§26–§28, §29 Session Completion, §33).

A session ends, the socket closes, and the trainee lands on the completion screen —
scoring happens here rather than on the request path, because a ten-dimension
evidence-based evaluation over a full transcript is a multi-second model call (§49.1
budgets would be blown by doing it inline).

Chain per finished session:

    evaluation.score  ->  evaluation.recommend  ->  (profile already updated)

`evaluation.score` is idempotent: if an `Evaluation` row already exists for the
session it returns it untouched, so an at-least-once queue cannot double-score.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import structlog

from app.services.evaluation_service import EvaluationService
from app.services.repository import Repository, field
from app.workers.queue import JobContext, JobPayloadError, JobRetry, get_queue, job

log = structlog.get_logger(__name__)


@job("evaluation.score", max_retries=3, timeout_s=600.0, queue="evaluation")
async def score_session(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    session_id = str(payload.get("session_id") or "")
    if not session_id:
        raise JobPayloadError("evaluation.score needs session_id")
    db = await _db()
    service = EvaluationService(db, ctx)
    try:
        existing = await service.for_session(session_id)
    except Exception as exc:  # noqa: BLE001 - a missing session is terminal
        raise JobPayloadError(f"session {session_id} is not evaluable: {exc}") from exc
    if existing is not None:
        log.info("evaluation.already_scored", session=session_id, evaluation=existing.id)
        return {"session_id": session_id, "evaluation_id": existing.id, "skipped": True}

    try:
        evaluation = await service.evaluate_session(session_id)
    except JobRetry:
        raise
    except Exception as exc:  # noqa: BLE001
        message = str(exc)
        if "must be completed" in message or "not found" in message:
            raise JobPayloadError(message) from exc
        # Model/transport failures are retryable: the transcript is not going anywhere.
        raise JobRetry(f"scoring failed transiently: {message}") from exc

    await get_queue().enqueue(
        "evaluation.recommend",
        {
            "tenant_id": ctx.tenant_id,
            "workspace_id": ctx.workspace_id,
            "session_id": session_id,
        },
    )
    log.info(
        "evaluation.scored",
        session=session_id,
        evaluation=evaluation.id,
        score=evaluation.overall_score,
        passed=evaluation.passed,
    )
    return {
        "session_id": session_id,
        "evaluation_id": evaluation.id,
        "overall_score": evaluation.overall_score,
        "passed": evaluation.passed,
        "compliance_status": evaluation.compliance_status,
        "dimensions_without_evidence": evaluation.dimensions_without_evidence,
    }


@job("evaluation.recommend", max_retries=2, timeout_s=120.0, queue="evaluation")
async def build_recommendation(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """§33 closed loop: next scenario / retry / material / question set / difficulty."""
    session_id = str(payload.get("session_id") or "")
    if not session_id:
        raise JobPayloadError("evaluation.recommend needs session_id")
    db = await _db()
    service = EvaluationService(db, ctx)
    recommendation = await service.recommend(session_id)
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    sessions = await repo.list("TrainingSession", filters={"session_id": session_id})
    user_id = str(field(sessions[0], "user_id", "")) if sessions else ""
    await repo.update(
        "TrainingSession", session_id, {"recommendation": recommendation.model_dump()}
    )
    await repo.commit()
    log.info(
        "evaluation.recommended",
        session=session_id,
        user=user_id,
        weak=recommendation.weak_skills,
        difficulty=recommendation.suggested_difficulty,
    )
    return recommendation.model_dump()


@job("evaluation.post_session_coaching", max_retries=2, timeout_s=300.0, queue="evaluation")
async def post_session_coaching(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """§19.4 post-session coaching — allowed in both modes, unlike live hints (§8.4)."""
    session_id = str(payload.get("session_id") or "")
    if not session_id:
        raise JobPayloadError("evaluation.post_session_coaching needs session_id")
    db = await _db()
    from app.services.session_service import SessionService

    sessions = SessionService(db, ctx)
    replay = await sessions.replay(session_id)
    from app.agents.coach_agent import CoachAgent, CoachRequest
    from app.services.factory import build_llm

    agent = CoachAgent(build_llm(ctx), locale=str(replay.pinned.persona.get("locale") or "zh-TW"))
    output = await agent.safe_run(
        CoachRequest(
            mode=replay.session.mode,
            locale=str(replay.pinned.persona.get("locale") or "zh-TW"),
            session_id=session_id,
            recent_turns=[
                (str(turn.get("speaker")), str(turn.get("text")))
                for turn in replay.transcript
            ][-30:],
            learning_objectives=list(
                replay.pinned.scenario.get("learning_objectives") or []
            ),
            post_session=True,
        )
    )
    if output is None:
        return {"session_id": session_id, "insights": 0}
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    from app.agents.coach_agent import to_domain_insight

    written = 0
    for insight in output.insights:
        await repo.add(
            "CoachInsight",
            {
                **to_domain_insight(insight, session_id=session_id, timestamp_ms=0),
                "tenant_id": ctx.tenant_id,
                "workspace_id": ctx.workspace_id,
            },
        )
        written += 1
    await repo.commit()
    return {"session_id": session_id, "insights": written}


async def _db() -> Any:
    from app.db.session import get_sessionmaker  # assumed: app.db.session

    return get_sessionmaker()()


__all__ = ["build_recommendation", "post_session_coaching", "score_session"]
