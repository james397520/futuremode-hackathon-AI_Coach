"""Reranking — cross-encoder port; the server is always authoritative (§12.3, §54 PII).

Part II §54 lets the browser run a small cross-encoder over the top-20 to pick a
top-5 on the client. That is a *latency* optimisation only:

> 正式金融/保險環境仍建議 server authoritative scoring.

So `Reranker.rerank()` always recomputes the order server-side and the client's
ordering is accepted only as a hint recorded for telemetry (`client_agreement`).
`CrossEncoderReranker` calls the model hosted inside the private AMD AUP environment
(§72 lists the reranker as an AUP service); `LexicalReranker` is the deterministic,
dependency-free fallback so retrieval quality degrades rather than disappears when
the reranker service is down.
"""

from __future__ import annotations

import asyncio
import math
import re
from collections.abc import Sequence
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict, Field

log = structlog.get_logger(__name__)

_WORD = re.compile(r"[A-Za-z0-9_']+")
_CJK = re.compile("[぀-ヿ㐀-䶿一-鿿豈-﫿]")


class RerankCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    text: str
    #: retrieval score before reranking
    score: float = 0.0
    metadata: dict[str, Any] = Field(default_factory=dict)


class RerankedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    text: str
    retrieval_score: float = 0.0
    rerank_score: float = 0.0
    rank: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class RerankResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RerankedItem] = Field(default_factory=list)
    reranker: str = "none"
    #: Kendall-tau-ish agreement with a client-supplied order, for telemetry (§54)
    client_agreement: float | None = None


@runtime_checkable
class RerankerPort(Protocol):
    name: str

    async def score(self, query: str, candidates: Sequence[RerankCandidate]) -> list[float]: ...


class LexicalReranker:
    """Deterministic BM25-flavoured scorer. No model, no network.

    Used as the default in tests and as the fallback when the cross-encoder service is
    unavailable — a *worse* order is acceptable, an unranked order is not.
    """

    name = "lexical"
    k1 = 1.5
    b = 0.75

    async def score(self, query: str, candidates: Sequence[RerankCandidate]) -> list[float]:
        await asyncio.sleep(0)
        if not candidates:
            return []
        query_terms = _terms(query)
        docs = [_terms(c.text) for c in candidates]
        avg_len = sum(len(d) for d in docs) / len(docs) or 1.0
        doc_freq: dict[str, int] = {}
        for doc in docs:
            for term in set(doc):
                doc_freq[term] = doc_freq.get(term, 0) + 1
        scores: list[float] = []
        for doc in docs:
            length = len(doc) or 1
            score = 0.0
            counts: dict[str, int] = {}
            for term in doc:
                counts[term] = counts.get(term, 0) + 1
            for term in query_terms:
                freq = counts.get(term, 0)
                if not freq:
                    continue
                idf = math.log(
                    1 + (len(docs) - doc_freq.get(term, 0) + 0.5) / (doc_freq.get(term, 0) + 0.5)
                )
                denom = freq + self.k1 * (1 - self.b + self.b * length / avg_len)
                score += idf * (freq * (self.k1 + 1)) / denom
            scores.append(score)
        top = max(scores) or 1.0
        return [round(score / top, 6) for score in scores]


class CrossEncoderReranker:
    """Cross-encoder served from the private AMD AUP environment (§72).

    Wire shape is the common TEI/Infinity `/rerank` contract:
    `{"query": ..., "texts": [...]}` -> `[{"index": i, "score": s}, ...]`.
    """

    name = "cross-encoder"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str = "",
        model_id: str = "BAAI/bge-reranker-v2-m3",
        timeout_s: float = 15.0,
        client: Any | None = None,
        fallback: RerankerPort | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.model_id = model_id
        self._timeout = timeout_s
        self._client = client
        self._fallback: RerankerPort = fallback or LexicalReranker()

    @classmethod
    def from_settings(cls, client: Any | None = None) -> CrossEncoderReranker:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        key = getattr(settings, "reranker_api_key", "")
        getter = getattr(key, "get_secret_value", None)
        return cls(
            base_url=getattr(settings, "reranker_base_url", "http://rerank.aup.internal"),
            api_key=str(getter()) if callable(getter) else str(key or ""),
            model_id=getattr(settings, "reranker_model", "BAAI/bge-reranker-v2-m3"),
            client=client,
        )

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            self._client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout)
        return self._client

    async def score(self, query: str, candidates: Sequence[RerankCandidate]) -> list[float]:
        if not candidates:
            return []
        try:
            response = await self._http().post(
                "/rerank",
                json={
                    "model": self.model_id,
                    "query": query,
                    "texts": [c.text for c in candidates],
                },
                headers=(
                    {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
                ),
                timeout=self._timeout,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"reranker {response.status_code}: {response.text[:160]}")
            payload = response.json()
        except Exception as exc:  # noqa: BLE001 - degrade, never fail retrieval (§49.4)
            log.warning("reranker.unavailable", error=repr(exc), model=self.model_id)
            return await self._fallback.score(query, candidates)
        rows = payload.get("results") if isinstance(payload, dict) else payload
        scores = [0.0] * len(candidates)
        for row in rows or []:
            index = int(row.get("index", -1))
            if 0 <= index < len(scores):
                scores[index] = float(row.get("score", row.get("relevance_score", 0.0)))
        return scores


class Reranker:
    """Applies a `RerankerPort` and produces the authoritative ordering."""

    def __init__(self, port: RerankerPort | None = None) -> None:
        self.port: RerankerPort = port or LexicalReranker()

    async def rerank(
        self,
        query: str,
        candidates: Sequence[RerankCandidate],
        *,
        top_n: int | None = None,
        client_order: Sequence[str] | None = None,
        blend_retrieval: float = 0.25,
    ) -> RerankResult:
        """Recompute the order server-side.

        `client_order` (from the browser's local reranker, Part II §54) is used only to
        report agreement — it never changes the result. `blend_retrieval` mixes a
        little of the original vector score back in, which stabilises ties without
        letting the ANN score override the cross-encoder.
        """
        if not candidates:
            return RerankResult(items=[], reranker=self.port.name)
        scores = await self.port.score(query, candidates)
        if len(scores) != len(candidates):
            log.warning(
                "reranker.score_length_mismatch",
                expected=len(candidates),
                got=len(scores),
            )
            scores = [*scores, *([0.0] * (len(candidates) - len(scores)))][: len(candidates)]

        blended = [
            (1 - blend_retrieval) * score + blend_retrieval * candidate.score
            for score, candidate in zip(scores, candidates, strict=True)
        ]
        order = sorted(range(len(candidates)), key=lambda i: blended[i], reverse=True)
        items = [
            RerankedItem(
                id=candidates[position].id,
                text=candidates[position].text,
                retrieval_score=candidates[position].score,
                rerank_score=round(blended[position], 6),
                rank=rank,
                metadata=candidates[position].metadata,
            )
            for rank, position in enumerate(order)
        ]
        if top_n is not None:
            items = items[:top_n]
        agreement = (
            rank_agreement([item.id for item in items], client_order)
            if client_order
            else None
        )
        if agreement is not None and agreement < 0.5:
            log.info("reranker.client_disagreed", agreement=agreement)
        return RerankResult(items=items, reranker=self.port.name, client_agreement=agreement)


def rank_agreement(server_order: Sequence[str], client_order: Sequence[str]) -> float:
    """Fraction of concordant pairs between two orderings (1.0 = identical)."""
    shared = [item for item in client_order if item in set(server_order)]
    if len(shared) < 2:
        return 1.0 if shared else 0.0
    positions = {item: index for index, item in enumerate(server_order)}
    concordant = 0
    total = 0
    for i in range(len(shared)):
        for j in range(i + 1, len(shared)):
            total += 1
            if positions[shared[i]] < positions[shared[j]]:
                concordant += 1
    return round(concordant / total, 4) if total else 1.0


def _terms(text: str) -> list[str]:
    lowered = (text or "").lower()
    return [*_WORD.findall(lowered), *_CJK.findall(lowered)]


__all__ = [
    "CrossEncoderReranker",
    "LexicalReranker",
    "RerankCandidate",
    "RerankResult",
    "RerankedItem",
    "Reranker",
    "RerankerPort",
    "rank_agreement",
]
