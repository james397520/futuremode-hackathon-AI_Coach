"""Citation construction — §12.5.

    每個 AI 知識性 claim 盡量提供：source document / version / page / section /
    chunk id / retrieval score

`Citation` mirrors packages/shared/src/entities.ts exactly, because the web
client renders it directly (§17/§36 Part II "Knowledge Citation" message type). It is
produced as a plain dict so that whichever Pydantic mirror `app.domain` exposes can
validate it without this module importing a name it had to guess.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.rag.vectorstore import VectorHit

SNIPPET_CHARS = 320


class Citation(BaseModel):
    """Mirror of the `Citation` interface in shared."""

    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    document_id: str
    document_name: str
    document_version: int = 1
    page: int | None = None
    section: str | None = None
    similarity: float = 0.0
    rerank_score: float | None = None
    snippet: str = ""

    def as_dict(self) -> dict[str, Any]:
        return self.model_dump()


def build_citation(
    hit: VectorHit,
    *,
    document_name: str | None = None,
    rerank_score: float | None = None,
    query: str = "",
) -> Citation:
    record = hit.record
    return Citation(
        chunk_id=record.chunk_id or hit.id,
        document_id=record.document_id,
        document_name=document_name
        or str(record.metadata.get("document_name") or record.document_id),
        document_version=record.document_version,
        page=record.page,
        section=record.section,
        similarity=round(float(hit.score), 4),
        rerank_score=round(float(rerank_score), 4) if rerank_score is not None else None,
        snippet=make_snippet(record.text, query=query),
    )


def build_citations(
    hits: Sequence[VectorHit],
    *,
    document_names: dict[str, str] | None = None,
    rerank_scores: dict[str, float] | None = None,
    query: str = "",
    limit: int | None = None,
) -> list[Citation]:
    names = document_names or {}
    scores = rerank_scores or {}
    citations = [
        build_citation(
            hit,
            document_name=names.get(hit.record.document_id),
            rerank_score=scores.get(hit.id, scores.get(hit.record.chunk_id)),
            query=query,
        )
        for hit in hits
    ]
    return citations[:limit] if limit else citations


def make_snippet(text: str, *, query: str = "", max_chars: int = SNIPPET_CHARS) -> str:
    """Centre the snippet on the best-matching sentence so the UI shows the reason."""
    body = re.sub(r"\s+", " ", text or "").strip()
    if len(body) <= max_chars:
        return body
    if query:
        terms = [t for t in re.split(r"\W+", query.lower()) if len(t) >= 2]
        best_position = -1
        for term in terms:
            position = body.lower().find(term)
            if position >= 0 and (best_position < 0 or position < best_position):
                best_position = position
        if best_position >= 0:
            start = max(0, best_position - max_chars // 3)
            end = min(len(body), start + max_chars)
            prefix = "…" if start > 0 else ""
            suffix = "…" if end < len(body) else ""
            return f"{prefix}{body[start:end].strip()}{suffix}"
    return body[:max_chars].rstrip() + "…"


def dedupe_citations(citations: Iterable[Citation]) -> list[Citation]:
    """One citation per chunk, keeping the highest-scoring occurrence."""
    best: dict[str, Citation] = {}
    for citation in citations:
        current = best.get(citation.chunk_id)
        if current is None or _rank(citation) > _rank(current):
            best[citation.chunk_id] = citation
    return sorted(best.values(), key=_rank, reverse=True)


def _rank(citation: Citation) -> float:
    return citation.rerank_score if citation.rerank_score is not None else citation.similarity


def group_by_document(citations: Sequence[Citation]) -> dict[str, list[Citation]]:
    """For the §39 "Explainable Evidence" panel, which groups by source document."""
    grouped: dict[str, list[Citation]] = {}
    for citation in citations:
        grouped.setdefault(citation.document_id, []).append(citation)
    return grouped


def coverage(citations: Sequence[Citation]) -> dict[str, Any]:
    """Small summary used by the retrieval playground (§12.4)."""
    return {
        "citation_count": len(citations),
        "document_count": len({c.document_id for c in citations}),
        "max_similarity": max((c.similarity for c in citations), default=0.0),
        "reranked": any(c.rerank_score is not None for c in citations),
        "pages": sorted({c.page for c in citations if c.page is not None}),
    }


__all__ = [
    "SNIPPET_CHARS",
    "Citation",
    "build_citation",
    "build_citations",
    "coverage",
    "dedupe_citations",
    "group_by_document",
    "make_snippet",
]
