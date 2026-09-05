"""Document processing job — parse -> chunk -> embed -> index (§11.3, §29, §65).

    uploaded -> validating -> parsing -> chunking -> embedding -> indexing -> ready
                                                                          \\-> failed

Each transition is written back to the document row (state + progress), so the §29
"Document Processing Visual" animates from real data rather than a guess. The heavy
work happens in `RagPipeline.ingest`, which is what emits those transitions; this
module is the job wrapper: it fetches the object from storage, builds the payload,
persists the resulting chunks, updates the KB counters and decides what is worth a
retry.

Retry policy (§49.4): storage/network/model failures raise `JobRetry` and come back
with exponential backoff. A *content* failure — an unreadable scan, a password-
protected PDF, every chunk failing quality — is terminal: the document lands in
`failed` with a `failure_reason` the uploader can act on, and we do not burn three
retries on a file that will never parse.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import structlog

from app.rag.chunker import ChunkConfig, TextChunk
from app.rag.parser import DocumentPayload, SourceKind
from app.rag.pipeline import DocumentState, IngestRequest, IngestResult, RagPipeline
from app.services.base import iso_now, new_id
from app.services.knowledge_service import KnowledgeService
from app.services.repository import Repository, field
from app.workers.queue import JobContext, JobPayloadError, JobRetry, job

log = structlog.get_logger(__name__)

#: Failures that are the *file's* fault. Retrying cannot help.
TERMINAL_MESSAGES = (
    "no extractable text",
    "quality check",
    "empty",
    "does not match source kind",
    "exceeds",
    "password",
    "encrypted",
)


@job("document.process", max_retries=3, timeout_s=1800.0, queue="documents")
async def process_document(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """The §65 pipeline for one document version."""
    document_id = str(payload.get("document_id") or "")
    knowledge_base_id = str(payload.get("knowledge_base_id") or "")
    version = int(payload.get("document_version") or 1)
    if not document_id or not knowledge_base_id:
        raise JobPayloadError("document.process needs document_id and knowledge_base_id")

    db = await _db()
    knowledge = KnowledgeService(db, ctx)
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)

    try:
        content = await _load_content(payload)
    except JobRetry:
        raise
    except Exception as exc:  # noqa: BLE001
        await knowledge.update_document_state(
            document_id,
            str(DocumentState.FAILED),
            progress=100,
            failure_reason=f"could not read the uploaded object: {exc}"[:400],
        )
        raise JobPayloadError(f"storage read failed for {document_id}: {exc}") from exc

    source_kind = SourceKind(str(payload.get("source_kind") or "txt"))
    document_payload = DocumentPayload(
        filename=str(payload.get("filename") or document_id),
        source_kind=source_kind,
        content=content,
        text=str(payload.get("manual_text") or ""),
        url=str(payload.get("url") or ""),
        mime_type=payload.get("mime_type"),
        language=str(payload.get("language") or "zh-TW"),
    )
    chunk_config = ChunkConfig.model_validate(payload.get("chunk_config") or {})
    known = await _known_fingerprints(repo, knowledge_base_id, exclude=document_id)

    pipeline = await knowledge.retrieval_pipeline([knowledge_base_id])

    async def on_state(state: DocumentState, progress: int, reason: str | None) -> None:
        await knowledge.update_document_state(
            document_id, str(state), progress=progress, failure_reason=reason
        )

    request = IngestRequest(
        document_id=document_id,
        knowledge_base_id=knowledge_base_id,
        document_version=version,
        document_name=document_payload.filename,
        payload=document_payload,
        chunk_config=chunk_config,
        acl_subject_ids=[str(s) for s in (payload.get("acl_subject_ids") or [])],
        known_fingerprints=known,
    )
    result: IngestResult = await pipeline.ingest(request, on_state=on_state)

    if result.state is DocumentState.FAILED:
        reason = result.failure_reason or "unknown ingestion failure"
        if _is_terminal(reason):
            log.warning("document.terminal_failure", document_id=document_id, reason=reason)
            return _summary(result, retried=False)
        raise JobRetry(f"ingest failed transiently: {reason}")

    await _persist_chunks(repo, pipeline, request, result.chunks)
    await _refresh_counters(repo, knowledge_base_id)
    await knowledge.update_document_state(
        document_id,
        str(DocumentState.READY),
        progress=100,
        chunk_count=result.chunk_count,
    )
    log.info(
        "document.indexed",
        document_id=document_id,
        chunks=result.chunk_count,
        indexed=result.indexed_count,
        rejected=result.rejected_count,
        quality=result.quality_score,
        ms=result.duration_ms,
    )
    return _summary(result, retried=False)


@job("document.reindex", max_retries=3, timeout_s=1800.0, queue="documents")
async def reindex_document(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Re-run the pipeline after a rollback or an embedding-model change (§11.6)."""
    document_id = str(payload.get("document_id") or "")
    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    document = await repo.get("KnowledgeDocument", document_id)
    if document is None:
        raise JobPayloadError(f"document {document_id} not found")
    enriched = {
        **dict(payload),
        "filename": str(field(document, "filename", "")),
        "source_kind": str(field(document, "source_kind", "txt")),
        "storage_key": str(field(document, "storage_key", "")),
        "knowledge_base_id": str(field(document, "knowledge_base_id", "")),
    }
    knowledge = KnowledgeService(db, ctx)
    pipeline = await knowledge.retrieval_pipeline([enriched["knowledge_base_id"]])
    await pipeline.delete_document(document_id)
    return await process_document(ctx, enriched)


@job("document.reembed_kb", max_retries=2, timeout_s=3600.0, queue="documents")
async def reembed_knowledge_base(ctx: JobContext, payload: Mapping[str, Any]) -> dict[str, Any]:
    """Re-embed every ready document in a KB (embedding-model switch, §12.1).

    Enqueues one `document.reindex` per document rather than doing it inline, so a
    large KB cannot monopolise a worker slot or blow the job timeout.
    """
    knowledge_base_id = str(payload.get("knowledge_base_id") or "")
    if not knowledge_base_id:
        raise JobPayloadError("document.reembed_kb needs knowledge_base_id")
    db = await _db()
    repo = Repository(db, tenant_id=ctx.tenant_id, workspace_id=ctx.workspace_id)
    documents = await repo.list(
        "KnowledgeDocument",
        filters={"knowledge_base_id": knowledge_base_id, "state": "ready"},
    )
    from app.workers.queue import get_queue

    queue = get_queue()
    enqueued = 0
    for document in documents:
        await queue.enqueue(
            "document.reindex",
            {
                "tenant_id": ctx.tenant_id,
                "workspace_id": ctx.workspace_id,
                "document_id": str(field(document, "id")),
                "document_version": int(field(document, "active_version", 1) or 1),
                "knowledge_base_id": knowledge_base_id,
            },
        )
        enqueued += 1
    return {"knowledge_base_id": knowledge_base_id, "enqueued": enqueued}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
async def _load_content(payload: Mapping[str, Any]) -> bytes:
    """Fetch the uploaded object. Manual/URL sources carry their own content."""
    source_kind = str(payload.get("source_kind") or "txt")
    if source_kind in ("manual", "url"):
        return b""
    inline = payload.get("content")
    if isinstance(inline, bytes):
        return inline
    if isinstance(inline, str) and inline:
        import base64

        return base64.b64decode(inline)
    storage_key = str(payload.get("storage_key") or "")
    if not storage_key:
        raise JobPayloadError("no storage_key and no inline content")
    return await _read_object(storage_key)


async def _read_object(storage_key: str) -> bytes:
    """Read from S3/MinIO.

    ASSUMPTION: the API-platform module exposes an object-storage helper at
    `app.core.storage` with `get_object(key) -> bytes` (sync or async). If it lands
    under a different name, this is the single place to change.
    """
    import asyncio

    try:
        from app.core import storage  # assumed: app.core.storage
    except ImportError as exc:
        raise JobRetry(f"object storage client unavailable: {exc}") from exc
    getter = getattr(storage, "get_object", None) or getattr(storage, "read", None)
    if getter is None:
        raise JobRetry("app.core.storage exposes no get_object()")
    try:
        result = getter(storage_key)
        if asyncio.iscoroutine(result):
            return bytes(await result)
        return bytes(result)
    except Exception as exc:  # noqa: BLE001 - network/S3 hiccups are retryable
        raise JobRetry(f"object read failed for {storage_key}: {exc}") from exc


async def _db() -> Any:
    """Open a worker-scoped DB session.

    ASSUMPTION: `app.db.session.get_sessionmaker()` returns an async sessionmaker.
    """
    from app.db.session import get_sessionmaker  # assumed: app.db.session

    return get_sessionmaker()()


async def _known_fingerprints(
    repo: Repository, knowledge_base_id: str, *, exclude: str
) -> list[str]:
    rows = await repo.list(
        "Chunk", filters={"knowledge_base_id": knowledge_base_id}, limit=5000
    )
    return [
        str(field(row, "fingerprint"))
        for row in rows
        if field(row, "fingerprint") and str(field(row, "document_id")) != exclude
    ]


async def _persist_chunks(
    repo: Repository,
    pipeline: RagPipeline,
    request: IngestRequest,
    chunks: Sequence[TextChunk],
) -> int:
    """Write the `Chunk` rows the Chunk Viewer (§30) and the editor (§11.5) read."""
    existing = await repo.list("Chunk", filters={"document_id": request.document_id})
    for row in existing:
        if int(field(row, "document_version", 1) or 1) != request.document_version:
            continue
        await repo.delete("Chunk", str(field(row, "id")))
    written = 0
    for chunk in chunks:
        chunk_id = pipeline.chunk_id(
            request.document_id, request.document_version, chunk.index
        )
        parent_chunk_id = (
            pipeline.chunk_id(
                request.document_id, request.document_version, chunk.parent_index
            )
            if chunk.parent_index is not None
            else None
        )
        await repo.add(
            "Chunk",
            {
                "id": new_id("chk"),
                "chunk_id": chunk_id,
                "document_id": request.document_id,
                "knowledge_base_id": request.knowledge_base_id,
                "document_version": request.document_version,
                "index": chunk.index,
                "text": chunk.text,
                "token_count": chunk.token_count,
                "page": chunk.page,
                "section": chunk.section,
                "parent_chunk_id": parent_chunk_id,
                "is_parent": chunk.is_parent,
                "fingerprint": chunk.fingerprint,
                "metadata": chunk.metadata,
                "tags": chunk.tags,
                "excluded_from_retrieval": False,
                "created_at": iso_now(),
            },
        )
        written += 1
    await repo.commit()
    return written


async def _refresh_counters(repo: Repository, knowledge_base_id: str) -> None:
    documents = await repo.list(
        "KnowledgeDocument", filters={"knowledge_base_id": knowledge_base_id}
    )
    chunks = await repo.list(
        "Chunk", filters={"knowledge_base_id": knowledge_base_id}, limit=100000
    )
    await repo.update(
        "KnowledgeBase",
        knowledge_base_id,
        {
            "document_count": len(documents),
            "chunk_count": len(chunks),
            "updated_at": iso_now(),
        },
    )
    await repo.commit()


def _is_terminal(reason: str) -> bool:
    """A content problem (unreadable file, all chunks rejected) is not worth retrying.

    `ParserUnavailableError` is also terminal for *this* worker: the format's backend
    is not installed in this image, so a retry lands in the same place.
    """
    lowered = reason.lower()
    if "parserunavailableerror" in lowered or "is not installed" in lowered:
        return True
    return any(marker in lowered for marker in TERMINAL_MESSAGES)


def _summary(result: IngestResult, *, retried: bool) -> dict[str, Any]:
    return {
        "document_id": result.document_id,
        "state": str(result.state),
        "chunk_count": result.chunk_count,
        "indexed_count": result.indexed_count,
        "rejected_count": result.rejected_count,
        "quality_score": result.quality_score,
        "quality_summary": result.quality_summary,
        "ocr_applied": result.ocr_applied,
        "failure_reason": result.failure_reason,
        "duration_ms": result.duration_ms,
        "retried": retried,
    }


__all__ = [
    "TERMINAL_MESSAGES",
    "process_document",
    "reembed_knowledge_base",
    "reindex_document",
]
