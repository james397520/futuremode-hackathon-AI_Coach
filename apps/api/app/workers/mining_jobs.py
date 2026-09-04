"""Knowledge mining jobs (§13, §4.2).

Mining is batch work over long transcripts, so it never runs on a request. The job
produces a `MiningRun` whose every asset is `review_required`; **publishing is not a
job** — it is an explicit human action through `KnowledgeService`/the review UI, and
`MiningRun.publish()` refuses to run while anything is un-reviewed.

The publish job exists only to apply an already-recorded human decision.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import structlog

from app.rag.mining import (
    KnowledgeMiner,
    MinedAsset,
    MiningRequest,
    MiningRun,
    ReviewRequiredError,
    to_playbook_entries,
)
from app.services.base import iso_now
from app.services.repository import Repository, field
from app.workers.queue import JobContext, JobPayloadError, JobRetry, job

log = structlog.get_logger(__name__)


@job("mining.run", max_retries=2, timeout_s=1800.0, queue="mining")
async def run_mining(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Anonymise -> segment -> extract -> mine, then park everything for review."""
    raw_text = str(payload.get("raw_text") or "")
    turns = [
        (str(speaker), str(text))
        for speaker, text in (payload.get("turns") or [])
    ]
    if not raw_text.strip() and not turns:
        raise JobPayloadError("mining.run needs raw_text or turns")

    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    llm = None
    if payload.get("use_model", True):
        try:
            from app.services.factory import build_llm

            llm = build_llm(ctx)
        except Exception as exc:  # noqa: BLE001 - heuristics alone still produce value
            log.warning("mining.llm_unavailable", error=repr(exc))

    miner = KnowledgeMiner(llm=llm, locale=str(payload.get("locale") or "zh-TW"))
    try:
        run = await miner.mine(
            MiningRequest(
                source_label=str(payload.get("source_label") or ""),
                locale=str(payload.get("locale") or "zh-TW"),
                raw_text=raw_text,
                turns=turns,
                manager_notes=[str(n) for n in (payload.get("manager_notes") or [])],
                outcome=str(payload.get("outcome") or "unknown"),
                target_skills=[str(s) for s in (payload.get("target_skills") or [])],
            )
        )
    except Exception as exc:  # noqa: BLE001
        raise JobRetry(f"mining failed transiently: {exc}") from exc

    await repo.add(
        "MiningRun",
        {
            "id": run.id,
            "tenant_id": ctx.tenant_id,
            "workspace_id": ctx.workspace_id,
            "source_label": run.source_label,
            "status": "review_required",
            "pii_leak_suspected": run.pii_leak_suspected,
            "segments": [segment.model_dump() for segment in run.segments],
            "objections": run.objections,
            "assets": [asset.model_dump() for asset in run.assets],
            "created_by": ctx.user_id,
            "created_at": iso_now(),
        },
    )
    await repo.commit()
    log.info(
        "mining.completed",
        run_id=run.id,
        assets=len(run.assets),
        pii_suspected=run.pii_leak_suspected,
    )
    return {
        "run_id": run.id,
        "assets": len(run.assets),
        "pending_review": len(run.pending()),
        "pii_leak_suspected": run.pii_leak_suspected,
        "status": "review_required",
    }


@job("mining.mine_session", max_retries=2, timeout_s=1800.0, queue="mining")
async def mine_session(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Mine a high-scoring *training* session's transcript (§13 best-performing sessions)."""
    session_id = str(payload.get("session_id") or "")
    if not session_id:
        raise JobPayloadError("mining.mine_session needs session_id")
    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    turns = await repo.list(
        "TranscriptTurn", filters={"session_id": session_id}, order_by="timestamp_ms"
    )
    if not turns:
        raise JobPayloadError(f"session {session_id} has no transcript to mine")
    evaluations = await repo.list("Evaluation", filters={"session_id": session_id})
    minimum = int(payload.get("min_score") or 80)
    if evaluations and int(field(evaluations[0], "overall_score", 0) or 0) < minimum:
        return {
            "session_id": session_id,
            "skipped": True,
            "reason": f"score below the {minimum} mining threshold",
        }
    return await run_mining(
        ctx,
        {
            **dict(payload),
            "source_label": f"session:{session_id}",
            "turns": [
                (
                    "trainee" if str(field(turn, "speaker", "")) == "trainee" else "customer",
                    str(field(turn, "text", "")),
                )
                for turn in turns
            ],
            "outcome": "won" if evaluations and field(evaluations[0], "passed") else "unknown",
        },
    )


@job("mining.publish", max_retries=1, timeout_s=120.0, queue="mining")
async def publish_reviewed_assets(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Apply a **human** review decision. Refuses anything not fully reviewed (§13)."""
    run_id = str(payload.get("run_id") or "")
    reviewer_id = str(payload.get("reviewer_id") or "")
    if not run_id or not reviewer_id:
        raise JobPayloadError("mining.publish needs run_id and reviewer_id")
    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    row = await repo.get("MiningRun", run_id)
    if row is None:
        raise JobPayloadError(f"mining run {run_id} not found")

    run = MiningRun(
        id=run_id,
        source_label=str(field(row, "source_label", "")),
        assets=[MinedAsset.model_validate(a) for a in (field(row, "assets") or [])],
        pii_leak_suspected=bool(field(row, "pii_leak_suspected", False)),
    )
    reviewed = run.review(
        reviewer_id=reviewer_id,
        approved_asset_ids=[str(i) for i in (payload.get("approved_asset_ids") or [])],
        rejected_asset_ids=[str(i) for i in (payload.get("rejected_asset_ids") or [])],
        note=payload.get("note"),
    )
    try:
        published = reviewed.publish()
    except ReviewRequiredError as exc:
        # Not a retry: a human still has to decide.
        log.info("mining.publish_blocked", run_id=run_id, reason=str(exc))
        await repo.update(
            "MiningRun",
            run_id,
            {"assets": [a.model_dump() for a in reviewed.assets], "status": "review_required"},
        )
        await repo.commit()
        raise JobPayloadError(str(exc)) from exc

    entries = to_playbook_entries(published)
    for entry in entries:
        await repo.add(
            "PlaybookEntry" if _has_playbook() else "MiningRun",
            {
                **entry,
                "tenant_id": ctx.tenant_id,
                "workspace_id": ctx.workspace_id,
                "mining_run_id": run_id,
                "created_at": iso_now(),
            },
        )
    await repo.update(
        "MiningRun",
        run_id,
        {
            "assets": [a.model_dump() for a in reviewed.assets],
            "status": "published",
            "reviewer_id": reviewer_id,
            "reviewed_at": iso_now(),
        },
    )
    await repo.commit()
    log.info("mining.published", run_id=run_id, entries=len(entries))
    return {"run_id": run_id, "published": len(entries)}


def _has_playbook() -> bool:
    """ASSUMPTION: `app.db.models.PlaybookEntry` may not exist yet; if it does not,
    published assets stay on the mining run row instead of being lost."""
    from app.services.repository import ModelNotAvailableError, Models

    try:
        Models.get("PlaybookEntry")
    except (ModelNotAvailableError, ImportError, ModuleNotFoundError):
        return False
    return True


async def _db() -> Any:
    from app.db.session import get_sessionmaker  # assumed: app.db.session

    return get_sessionmaker()()


__all__ = ["mine_session", "publish_reviewed_assets", "run_mining"]
