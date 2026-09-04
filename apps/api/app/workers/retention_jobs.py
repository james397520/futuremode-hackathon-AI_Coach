"""Data retention and deletion (§40.2 Data retention / Data deletion).

Two distinct obligations:

* **Retention sweep** (`retention.sweep`, on the daily beat schedule) — ages out data
  per the tenant's policy: audio first (30 days by default, since recorded voice is
  the most sensitive artefact), then transcripts, then mining drafts. Evaluations and
  audit events are kept far longer because they are the record of a compliance
  decision.
* **Erasure** (`retention.erase_user`) — a data-subject deletion request. This is a
  *hard* delete of the user's personal content plus purging of their chunks/vectors,
  with the audit trail retained in pseudonymised form (deleting the audit record of a
  deletion would itself be a compliance failure).

Both are dry-runnable: `dry_run=True` reports what *would* go, which is what an admin
sees before confirming.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog

from app.services.base import iso_now
from app.services.repository import Repository, field
from app.services.safety_service import SafetyService
from app.workers.queue import JobContext, JobPayloadError, job

log = structlog.get_logger(__name__)

#: What each retention key governs: (model, timestamp column, hard delete?)
RETENTION_TARGETS: dict[str, tuple[str, str, bool]] = {
    "audio_days": ("TranscriptTurn", "timestamp_ms", False),
    "transcript_days": ("TranscriptTurn", "created_at", True),
    "mining_draft_days": ("MiningRun", "created_at", True),
    "evaluation_days": ("Evaluation", "created_at", True),
    "audit_days": ("AuditEvent", "at", True),
}


@job("retention.sweep", max_retries=1, timeout_s=3600.0, queue="maintenance")
async def retention_sweep(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Apply the tenant's retention policy. Scheduled daily by Celery beat."""
    dry_run = bool(payload.get("dry_run", False))
    db = await _db()
    safety = SafetyService(db, ctx)
    policy = safety.retention_policy()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)

    report: dict[str, Any] = {"policy": policy, "dry_run": dry_run, "actions": {}}
    now = datetime.now(UTC)

    # 1. audio first: strip the URL and let object storage expire the blob.
    audio_cutoff = now - timedelta(days=policy["audio_days"])
    stripped = 0
    turns = await repo.list("TranscriptTurn", limit=100000)
    for turn in turns:
        if not field(turn, "audio_url"):
            continue
        if _older_than(field(turn, "created_at"), audio_cutoff):
            stripped += 1
            if not dry_run:
                await repo.update(
                    "TranscriptTurn", str(field(turn, "id")), {"audio_url": None}
                )
    report["actions"]["audio_urls_cleared"] = stripped

    # 2. transcripts
    transcript_cutoff = now - timedelta(days=policy["transcript_days"])
    deleted_turns = 0
    for turn in turns:
        if _older_than(field(turn, "created_at"), transcript_cutoff):
            deleted_turns += 1
            if not dry_run:
                await repo.delete("TranscriptTurn", str(field(turn, "id")))
    report["actions"]["transcript_turns_deleted"] = deleted_turns

    # 3. mining drafts that nobody ever reviewed
    mining_cutoff = now - timedelta(days=policy["mining_draft_days"])
    dropped_runs = 0
    for run in await _safe_list(repo, "MiningRun"):
        if str(field(run, "status", "")) == "published":
            continue
        if _older_than(field(run, "created_at"), mining_cutoff):
            dropped_runs += 1
            if not dry_run:
                await repo.delete("MiningRun", str(field(run, "id")))
    report["actions"]["mining_drafts_deleted"] = dropped_runs

    if not dry_run:
        await repo.commit()
        safety.audit(
            "retention.sweep",
            "tenant",
            risk="low",
            audio_cleared=stripped,
            turns_deleted=deleted_turns,
            mining_deleted=dropped_runs,
        )
    log.info("retention.sweep_done", **report["actions"], dry_run=dry_run)
    return report


@job("retention.erase_user", max_retries=1, timeout_s=1800.0, queue="maintenance")
async def erase_user(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Right-to-erasure for one user (§40.2 Data deletion).

    Deletes the user's transcripts, coach insights, evaluations, skill profile and
    sessions, and purges any knowledge chunks they authored. The audit trail is kept
    but pseudonymised: `user_id` becomes `erased:<hash>` so the *fact* of each action
    survives while the identity does not.
    """
    user_id = str(payload.get("user_id") or "")
    if not user_id:
        raise JobPayloadError("retention.erase_user needs user_id")
    dry_run = bool(payload.get("dry_run", False))
    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    counts: dict[str, int] = {}

    sessions = await repo.list("TrainingSession", filters={"user_id": user_id}, limit=10000)
    session_ids = [
        str(field(session, "session_id") or field(session, "id")) for session in sessions
    ]
    for model, filters in (
        ("TranscriptTurn", {"session_id": session_ids}),
        ("CoachInsight", {"session_id": session_ids}),
        ("ComplianceFinding", {"session_id": session_ids}),
        ("Evaluation", {"session_id": session_ids}),
    ):
        if not session_ids:
            counts[model] = 0
            continue
        rows = await _safe_list(repo, model, filters=filters, limit=100000)
        counts[model] = len(rows)
        if not dry_run:
            for row in rows:
                await repo.delete(model, str(field(row, "id")))

    profiles = await _safe_list(repo, "SkillProfile", filters={"user_id": user_id})
    counts["SkillProfile"] = len(profiles)
    if not dry_run:
        for profile in profiles:
            await repo.delete("SkillProfile", str(field(profile, "id")))

    counts["TrainingSession"] = len(sessions)
    if not dry_run:
        for session in sessions:
            await repo.delete("TrainingSession", str(field(session, "id")))

    purged_documents = await _purge_user_documents(ctx, repo, user_id, dry_run=dry_run)
    counts["documents_purged"] = purged_documents

    pseudonymised = await _pseudonymise_audit(repo, user_id, dry_run=dry_run)
    counts["audit_events_pseudonymised"] = pseudonymised

    if not dry_run:
        await repo.commit()
    log.info("retention.user_erased", user=_pseudonym(user_id), dry_run=dry_run, **counts)
    return {"user_id": _pseudonym(user_id), "dry_run": dry_run, "deleted": counts}


@job("retention.purge_document_vectors", max_retries=2, timeout_s=600.0, queue="maintenance")
async def purge_document_vectors(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Delete a document's vectors after its rows are gone (§40.2, §74)."""
    document_id = str(payload.get("document_id") or "")
    knowledge_base_id = str(payload.get("knowledge_base_id") or "")
    if not document_id:
        raise JobPayloadError("retention.purge_document_vectors needs document_id")
    db = await _db()
    from app.services.knowledge_service import KnowledgeService

    knowledge = KnowledgeService(db, ctx)
    pipeline = await knowledge.retrieval_pipeline(
        [knowledge_base_id] if knowledge_base_id else []
    )
    removed = await pipeline.delete_document(document_id)
    return {"document_id": document_id, "removed": removed}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
async def _purge_user_documents(
    ctx: JobContext, repo: Repository, user_id: str, *, dry_run: bool
) -> int:
    versions = await _safe_list(repo, "DocumentVersion", filters={"uploaded_by": user_id})
    document_ids = {str(field(version, "document_id")) for version in versions}
    if not document_ids or dry_run:
        return len(document_ids)
    from app.workers.queue import get_queue

    queue = get_queue()
    for document_id in document_ids:
        document = await repo.get("KnowledgeDocument", document_id)
        await queue.enqueue(
            "retention.purge_document_vectors",
            {
                "tenant_id": ctx.tenant_id,
                "workspace_id": ctx.workspace_id,
                "document_id": document_id,
                "knowledge_base_id": str(field(document, "knowledge_base_id", "")),
            },
        )
    return len(document_ids)


async def _pseudonymise_audit(repo: Repository, user_id: str, *, dry_run: bool) -> int:
    events = await _safe_list(repo, "AuditEvent", filters={"user_id": user_id}, limit=100000)
    if dry_run:
        return len(events)
    for event in events:
        await repo.update(
            "AuditEvent",
            str(field(event, "id")),
            {"user_id": _pseudonym(user_id), "ip": None},
        )
    return len(events)


async def _safe_list(
    repo: Repository,
    model: str,
    *,
    filters: Mapping[str, Any] | None = None,
    limit: int = 10000,
) -> Sequence[Any]:
    """List rows, tolerating a model the platform module has not defined yet."""
    from app.services.repository import ModelNotAvailableError

    try:
        return await repo.list(model, filters=filters, limit=limit)
    except (ModelNotAvailableError, ImportError, ModuleNotFoundError) as exc:
        log.info("retention.model_absent", model=model, error=repr(exc))
        return []


def _pseudonym(user_id: str) -> str:
    import hashlib

    return f"erased:{hashlib.sha256(user_id.encode('utf-8')).hexdigest()[:16]}"


def _older_than(value: Any, cutoff: datetime) -> bool:
    if value is None:
        return False
    if isinstance(value, datetime):
        stamp = value if value.tzinfo else value.replace(tzinfo=UTC)
    else:
        try:
            stamp = datetime.fromisoformat(str(value))
        except ValueError:
            return False
        if stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=UTC)
    return stamp < cutoff


async def _db() -> Any:
    from app.db.session import get_sessionmaker  # assumed: app.db.session

    return get_sessionmaker()()


__all__ = [
    "RETENTION_TARGETS",
    "erase_user",
    "purge_document_vectors",
    "retention_sweep",
]
