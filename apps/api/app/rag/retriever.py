"""Retrieval controls — §12.3.

    Top-K / Similarity threshold / Metadata filter / Hybrid Search / Keyword Search /
    Reranker / Query Rewrite / Multi-query retrieval / Parent document expansion

Everything funnels through `VectorStore.search(..., scope=TenantScope)`, so no
retrieval path can skip tenant isolation (§39/§74) — including keyword search, which
uses the same store and the same filter rather than a separate text index.

Hybrid fusion uses **reciprocal rank fusion** rather than score addition, because the
vector score (cosine) and the keyword score (BM25-ish) are not on comparable scales;
RRF only needs the ranks, which makes the blend stable when a tenant switches
embedding model (§2.1 local vs API split changes score distributions).
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Sequence
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.rag.chunker import estimate_tokens
from app.rag.embedder import EmbedderPort, EmbeddingSpec
from app.rag.reranker import RerankCandidate, Reranker
from app.rag.vectorstore import TenantScope, VectorHit, VectorStore

log = structlog.get_logger(__name__)

RRF_K = 60


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    top_k: int = Field(default=8, ge=1, le=100)
    #: how many candidates to pull before reranking
    fetch_k: int = Field(default=24, ge=1, le=300)
    similarity_threshold: float = Field(default=0.35, ge=0.0, le=1.0)
    hybrid: bool = True
    keyword_weight: float = Field(default=0.4, ge=0.0, le=1.0)
    rerank: bool = True
    query_rewrite: bool = True
    multi_query: int = Field(default=1, ge=1, le=5)
    parent_expansion: bool = True
    metadata_filter: dict[str, Any] = Field(default_factory=dict)


class RetrievedChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hit: VectorHit
    vector_rank: int | None = None
    keyword_rank: int | None = None
    fused_score: float = 0.0
    rerank_score: float | None = None
    expanded_from_parent: bool = False

    @property
    def id(self) -> str:
        return self.hit.id

    @property
    def text(self) -> str:
        return self.hit.record.text


class RetrievalResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    rewritten_queries: list[str] = Field(default_factory=list)
    chunks: list[RetrievedChunk] = Field(default_factory=list)
    reranker: str = "none"
    latency_ms: int = 0
    #: for the retrieval playground: what actually happened (§12.4)
    trace: dict[str, Any] = Field(default_factory=dict)


_STOPWORDS = {
    "的", "了", "是", "在", "和", "與", "或", "請問", "我想", "一下", "這個", "那個",
    "什麼", "怎麼", "可以", "嗎", "呢", "吧", "the", "a", "an", "is", "are", "of",
    "to", "for", "and", "or", "what", "how", "can", "i", "we", "please",
}
_WORD = re.compile(r"[A-Za-z0-9_']+")
_CJK_RUN = re.compile("[぀-ヿ㐀-䶿一-鿿豈-﫿]{2,}")


class Retriever:
    """Owns query understanding + candidate generation + fusion + reranking."""

    def __init__(
        self,
        *,
        store: VectorStore,
        embedder: EmbedderPort,
        reranker: Reranker | None = None,
        config: RetrievalConfig | None = None,
    ) -> None:
        self.store = store
        self.embedder = embedder
        self.reranker = reranker or Reranker()
        self.config = config or RetrievalConfig()

    @property
    def spec(self) -> EmbeddingSpec:
        return self.embedder.spec

    # -- query understanding ----------------------------------------------
    @staticmethod
    def keywords(query: str) -> list[str]:
        lowered = (query or "").lower()
        words = [w for w in _WORD.findall(lowered) if w not in _STOPWORDS and len(w) > 1]
        runs = [r for r in _CJK_RUN.findall(query or "") if r not in _STOPWORDS]
        return [*words, *runs]

    def rewrite(self, query: str, *, context: Sequence[tuple[str, str]] = ()) -> list[str]:
        """Deterministic query rewriting (§12.3 Query Rewrite / Multi-query).

        Rule-based on purpose: a model rewrite on the live path costs a round trip on
        every turn, and for enterprise KB lookups the useful rewrites are mechanical —
        strip conversational filler, resolve a pronoun from the previous turn, and add
        a keyword-only variant that helps the lexical leg.
        """
        variants: list[str] = []
        base = re.sub(r"\s+", " ", (query or "").strip())
        if base:
            variants.append(base)
        stripped = base
        for filler in ("請問", "我想問一下", "我想知道", "可以跟我說", "那個", "就是說"):
            stripped = stripped.replace(filler, "")
        stripped = stripped.strip(" ，,。.?？")
        if stripped and stripped != base:
            variants.append(stripped)
        terms = self.keywords(base)
        if len(terms) >= 2:
            joined = " ".join(terms)
            if joined not in variants:
                variants.append(joined)
        if context and _has_pronoun(base):
            anchor = _last_noun_phrase(context)
            if anchor:
                resolved = f"{anchor} {stripped or base}".strip()
                if resolved not in variants:
                    variants.append(resolved)
        return variants

    # -- candidate generation ---------------------------------------------
    async def vector_search(
        self,
        query: str,
        *,
        scope: TenantScope,
        top_k: int,
        threshold: float | None,
    ) -> list[VectorHit]:
        vector = await self.embedder.embed_query(query)
        if not vector:
            return []
        return await self.store.search(
            vector,
            scope=scope,
            spec=self.spec,
            top_k=top_k,
            score_threshold=threshold,
        )

    async def keyword_search(
        self, query: str, *, scope: TenantScope, top_k: int
    ) -> list[VectorHit]:
        """Lexical leg (§12.3 Keyword Search).

        Implemented over the same store: we pull a wider vector candidate set with no
        threshold and re-score it lexically. This keeps *one* isolation path — a
        separate full-text index would be a second place tenant filtering could be
        forgotten — at the cost of recall on exact-term queries, which the
        `keyword_weight` fusion compensates for.
        """
        terms = self.keywords(query)
        if not terms:
            return []
        candidates = await self.vector_search(
            query, scope=scope, top_k=max(top_k * 4, 40), threshold=None
        )
        scored: list[tuple[float, VectorHit]] = []
        for hit in candidates:
            text = hit.record.text.lower()
            matches = sum(1 for term in terms if term in text)
            if not matches:
                continue
            density = matches / max(len(terms), 1)
            length_penalty = 1.0 / (1.0 + estimate_tokens(hit.record.text) / 500)
            scored.append((density * (0.7 + 0.3 * length_penalty), hit))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [hit for _score, hit in scored[:top_k]]

    # -- main entry point --------------------------------------------------
    async def retrieve(
        self,
        query: str,
        *,
        scope: TenantScope,
        config: RetrievalConfig | None = None,
        context: Sequence[tuple[str, str]] = (),
        client_rerank_order: Sequence[str] | None = None,
    ) -> RetrievalResult:
        import time

        cfg = config or self.config
        started = time.perf_counter()
        scoped = (
            TenantScope(
                tenant_id=scope.tenant_id,
                workspace_id=scope.workspace_id,
                knowledge_base_ids=scope.knowledge_base_ids,
                acl_subject_ids=scope.acl_subject_ids,
                metadata_filter={**dict(scope.metadata_filter), **cfg.metadata_filter},
            )
            if cfg.metadata_filter
            else scope
        )

        queries = (
            self.rewrite(query, context=context)[: cfg.multi_query]
            if cfg.query_rewrite
            else [query]
        )
        if not queries:
            queries = [query]

        vector_legs = [
            self.vector_search(
                variant, scope=scoped, top_k=cfg.fetch_k, threshold=cfg.similarity_threshold
            )
            for variant in queries
        ]
        keyword_legs = (
            [self.keyword_search(queries[0], scope=scoped, top_k=cfg.fetch_k)]
            if cfg.hybrid
            else []
        )
        results = await asyncio.gather(*vector_legs, *keyword_legs, return_exceptions=True)

        vector_hits: list[list[VectorHit]] = []
        keyword_hits: list[VectorHit] = []
        for index, item in enumerate(results):
            if isinstance(item, BaseException):
                log.warning("retriever.leg_failed", leg=index, error=repr(item))
                continue
            if index < len(vector_legs):
                vector_hits.append(item)
            else:
                keyword_hits = item

        fused = self._fuse(vector_hits, keyword_hits, cfg)
        candidates = fused[: cfg.fetch_k]

        reranker_name = "none"
        if cfg.rerank and candidates:
            rerank_result = await self.reranker.rerank(
                queries[0],
                [
                    RerankCandidate(
                        id=item.id,
                        text=item.text,
                        score=item.fused_score,
                        metadata={"chunk_id": item.hit.record.chunk_id},
                    )
                    for item in candidates
                ],
                top_n=cfg.top_k,
                client_order=client_rerank_order,
            )
            reranker_name = rerank_result.reranker
            by_id = {item.id: item for item in candidates}
            ordered: list[RetrievedChunk] = []
            for entry in rerank_result.items:
                chunk = by_id.get(entry.id)
                if chunk is None:
                    continue
                ordered.append(chunk.model_copy(update={"rerank_score": entry.rerank_score}))
            candidates = ordered
        else:
            candidates = candidates[: cfg.top_k]

        if cfg.parent_expansion:
            candidates = await self._expand_parents(candidates, scope=scoped)

        return RetrievalResult(
            query=query,
            rewritten_queries=queries,
            chunks=candidates,
            reranker=reranker_name,
            latency_ms=int((time.perf_counter() - started) * 1000),
            trace={
                "vector_legs": len(vector_hits),
                "vector_candidates": sum(len(leg) for leg in vector_hits),
                "keyword_candidates": len(keyword_hits),
                "fused": len(fused),
                "threshold": cfg.similarity_threshold,
                "hybrid": cfg.hybrid,
                "top_k": cfg.top_k,
            },
        )

    # -- fusion + expansion ------------------------------------------------
    def _fuse(
        self,
        vector_hits: Sequence[Sequence[VectorHit]],
        keyword_hits: Sequence[VectorHit],
        cfg: RetrievalConfig,
    ) -> list[RetrievedChunk]:
        """Reciprocal rank fusion across every vector leg plus the keyword leg."""
        accumulator: dict[str, RetrievedChunk] = {}
        scores: dict[str, float] = {}

        def add(hit: VectorHit, rank: int, weight: float, *, keyword: bool) -> None:
            entry = accumulator.get(hit.id)
            if entry is None:
                entry = RetrievedChunk(hit=hit)
                accumulator[hit.id] = entry
            if keyword:
                if entry.keyword_rank is None or rank < entry.keyword_rank:
                    entry.keyword_rank = rank
            elif entry.vector_rank is None or rank < entry.vector_rank:
                entry.vector_rank = rank
            scores[hit.id] = scores.get(hit.id, 0.0) + weight / (RRF_K + rank + 1)

        vector_weight = 1.0 - cfg.keyword_weight if cfg.hybrid else 1.0
        for leg in vector_hits:
            for rank, hit in enumerate(leg):
                add(hit, rank, vector_weight, keyword=False)
        if cfg.hybrid:
            for rank, hit in enumerate(keyword_hits):
                add(hit, rank, cfg.keyword_weight, keyword=True)

        for key, entry in accumulator.items():
            entry.fused_score = round(scores.get(key, 0.0), 8)
        ordered = sorted(
            accumulator.values(),
            key=lambda item: (item.fused_score, item.hit.score),
            reverse=True,
        )
        return ordered

    async def _expand_parents(
        self, chunks: Sequence[RetrievedChunk], *, scope: TenantScope
    ) -> list[RetrievedChunk]:
        """§12.3 parent document expansion.

        A child hit is replaced by its parent's text when the parent exists, so the
        LLM sees the surrounding clause instead of a fragment — while the citation
        still points at the child chunk the match came from.
        """
        parent_ids = {
            chunk.hit.record.parent_chunk_id
            for chunk in chunks
            if chunk.hit.record.parent_chunk_id
        }
        if not parent_ids:
            return list(chunks)
        parents: dict[str, VectorHit] = {}
        vector = [0.0] * self.spec.dimension
        try:
            found = await self.store.search(
                vector,
                scope=TenantScope(
                    tenant_id=scope.tenant_id,
                    workspace_id=scope.workspace_id,
                    knowledge_base_ids=scope.knowledge_base_ids,
                    acl_subject_ids=scope.acl_subject_ids,
                    metadata_filter={},
                ),
                spec=self.spec,
                top_k=max(len(parent_ids) * 4, 8),
                include_parents=True,
            )
            for hit in found:
                if hit.record.is_parent and hit.record.chunk_id in parent_ids:
                    parents[hit.record.chunk_id] = hit
        except Exception as exc:  # noqa: BLE001 - expansion is an enhancement
            log.warning("retriever.parent_expansion_failed", error=repr(exc))
            return list(chunks)

        out: list[RetrievedChunk] = []
        for chunk in chunks:
            parent = parents.get(chunk.hit.record.parent_chunk_id or "")
            if parent is None:
                out.append(chunk)
                continue
            enriched = chunk.hit.record.model_copy(update={"text": parent.record.text})
            out.append(
                chunk.model_copy(
                    update={
                        "hit": chunk.hit.model_copy(update={"record": enriched}),
                        "expanded_from_parent": True,
                    }
                )
            )
        return out


_PRONOUNS = ("它", "他", "這個", "那個", "此", "上述", "it", "this", "that", "these")


def _has_pronoun(query: str) -> bool:
    lowered = query.lower()
    return any(pronoun in lowered for pronoun in _PRONOUNS)


def _last_noun_phrase(context: Sequence[tuple[str, str]]) -> str:
    for _speaker, text in reversed(list(context)):
        runs = _CJK_RUN.findall(text or "")
        if runs:
            return max(runs, key=len)
        words = _WORD.findall(text or "")
        nouns = [w for w in words if w.lower() not in _STOPWORDS and len(w) > 3]
        if nouns:
            return nouns[-1]
    return ""


__all__ = [
    "RRF_K",
    "RetrievalConfig",
    "RetrievalResult",
    "RetrievedChunk",
    "Retriever",
]
