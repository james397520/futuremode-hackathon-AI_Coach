"""Embedding providers — Local/Private vs External API, kept strictly separate.

> **技術修正（spec §2.1）：** `text-embedding-3-*` 為 OpenAI API embedding model，
> 不是可直接在 AMD AUP 內部署的開源模型。正式文件需將「Local / Private Embedding」
> 與「External API Embedding」分開描述。

That correction is the reason this module has **two** implementations rather than one
configurable client:

* `LocalEmbedder` — BGE (`BAAI/bge-m3`, `bge-large-zh-v1.5`) / multilingual-e5 style
  open weights served from the private AMD AUP environment (§72: local embedding,
  reranker, private LLM, parser, evaluation model, vector DB all live there). These
  models need **instruction prefixes** to score correctly — e5 wants `query: ` /
  `passage: `, BGE-zh wants an instruction on the query side only — so the asymmetry
  between `embed_query` and `embed_documents` is a correctness requirement, not a
  stylistic choice.
* `ApiEmbedder` — OpenAI `text-embedding-3-small` / `-large`. **API-only.** It CANNOT
  be deployed inside AMD AUP: there are no open weights to host, every call leaves the
  private environment, and using it therefore requires the enterprise policy switch
  described in §2.1 ("Approved Enterprise Policy → OpenAI text-embedding-3-* → Vector
  Database") plus a data-residency review. Never select it as a silent default.

A knowledge base records `embedding_model` (see `KnowledgeBase` in shared-types) and a
`DocumentVersion` records `embedding_version`, because switching provider or dimension
invalidates the index: `EmbeddingSpec.index_key()` is what the vector store namespaces
collections by, so a model change can never mix vectors of different geometry.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import struct
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict

log = structlog.get_logger(__name__)


class EmbeddingDeployment(StrEnum):
    """Where the weights physically run — drives the §2.1 / §72 policy split."""

    PRIVATE = "private"    # AMD AUP / self-hosted; data never leaves the boundary
    EXTERNAL_API = "external_api"  # OpenAI et al.; requires approved enterprise policy
    DETERMINISTIC = "deterministic"  # tests / offline POC only


class EmbeddingSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str
    dimension: int
    deployment: EmbeddingDeployment
    #: e5-family models require "query: " / "passage: " prefixes
    query_prefix: str = ""
    passage_prefix: str = ""
    max_input_tokens: int = 512
    normalise: bool = True

    def index_key(self) -> str:
        """Namespace for the vector collection: geometry must never be mixed."""
        return f"{self.model_id.replace('/', '_')}__{self.dimension}"


#: Curated catalogue. `LocalEmbedder` accepts any of the private entries; picking a
#: model is an admin decision on the §44 Model Settings page.
LOCAL_MODELS: dict[str, EmbeddingSpec] = {
    "BAAI/bge-m3": EmbeddingSpec(
        model_id="BAAI/bge-m3",
        dimension=1024,
        deployment=EmbeddingDeployment.PRIVATE,
        max_input_tokens=8192,
    ),
    "BAAI/bge-large-zh-v1.5": EmbeddingSpec(
        model_id="BAAI/bge-large-zh-v1.5",
        dimension=1024,
        deployment=EmbeddingDeployment.PRIVATE,
        # BGE-zh scores best with an instruction on the query side only.
        query_prefix="為這個句子生成表示以用於檢索相關文章：",
        max_input_tokens=512,
    ),
    "intfloat/multilingual-e5-large": EmbeddingSpec(
        model_id="intfloat/multilingual-e5-large",
        dimension=1024,
        deployment=EmbeddingDeployment.PRIVATE,
        query_prefix="query: ",
        passage_prefix="passage: ",
        max_input_tokens=512,
    ),
}

#: External API models. NOT deployable inside AMD AUP — see the module docstring.
API_MODELS: dict[str, EmbeddingSpec] = {
    "text-embedding-3-small": EmbeddingSpec(
        model_id="text-embedding-3-small",
        dimension=1536,
        deployment=EmbeddingDeployment.EXTERNAL_API,
        max_input_tokens=8191,
    ),
    "text-embedding-3-large": EmbeddingSpec(
        model_id="text-embedding-3-large",
        dimension=3072,
        deployment=EmbeddingDeployment.EXTERNAL_API,
        max_input_tokens=8191,
    ),
}


class EmbeddingError(RuntimeError):
    pass


@runtime_checkable
class EmbedderPort(Protocol):
    spec: EmbeddingSpec

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


def _normalise(vector: Sequence[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return list(vector)
    return [value / norm for value in vector]


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right, strict=True))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if norm_left == 0 or norm_right == 0:
        return 0.0
    return dot / (norm_left * norm_right)


class _HttpEmbedder:
    """Shared HTTP plumbing for the OpenAI-compatible `/embeddings` shape."""

    def __init__(
        self,
        *,
        spec: EmbeddingSpec,
        base_url: str,
        api_key: str,
        batch_size: int = 64,
        timeout_s: float = 60.0,
        client: Any | None = None,
    ) -> None:
        self.spec = spec
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._batch_size = batch_size
        self._timeout = timeout_s
        self._client = client

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            self._client = httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _post(self, inputs: Sequence[str]) -> list[list[float]]:
        import httpx

        body: dict[str, Any] = {"model": self.spec.model_id, "input": list(inputs)}
        try:
            response = await self._http().post(
                "/embeddings",
                json=body,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"{self.spec.model_id}: transport error: {exc}") from exc
        if response.status_code >= 400:
            raise EmbeddingError(
                f"{self.spec.model_id}: embedding endpoint {response.status_code}: "
                f"{response.text[:200]}"
            )
        payload = response.json()
        rows = sorted(payload.get("data") or [], key=lambda row: int(row.get("index", 0)))
        vectors = [[float(v) for v in row.get("embedding") or []] for row in rows]
        for vector in vectors:
            if len(vector) != self.spec.dimension:
                raise EmbeddingError(
                    f"{self.spec.model_id}: expected dimension {self.spec.dimension}, "
                    f"got {len(vector)} — the knowledge base index would be corrupted"
                )
        return [_normalise(v) for v in vectors] if self.spec.normalise else vectors

    async def _embed(self, texts: Sequence[str], prefix: str) -> list[list[float]]:
        prepared = [f"{prefix}{self._truncate(text)}" for text in texts]
        out: list[list[float]] = []
        for start in range(0, len(prepared), self._batch_size):
            batch = prepared[start : start + self._batch_size]
            out.extend(await self._post(batch))
        return out

    def _truncate(self, text: str) -> str:
        """Defensive character-level cap; the chunker already targets token budgets."""
        limit = self.spec.max_input_tokens * 4
        body = text.strip()
        return body if len(body) <= limit else body[:limit]


class LocalEmbedder(_HttpEmbedder):
    """Private/AMD AUP embedding service (BGE / multilingual-e5 / approved open model).

    Talks the OpenAI-compatible `/embeddings` shape, which vLLM, Infinity and
    HuggingFace TEI all expose, so the same client covers every realistic private
    deployment. Data never leaves the private environment (§72, §73).
    """

    @classmethod
    def from_settings(cls, *, client: Any | None = None) -> LocalEmbedder:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        model_id = getattr(settings, "local_embedding_model", "BAAI/bge-m3")
        spec = LOCAL_MODELS.get(model_id)
        if spec is None:
            spec = EmbeddingSpec(
                model_id=model_id,
                dimension=int(getattr(settings, "local_embedding_dimension", 1024)),
                deployment=EmbeddingDeployment.PRIVATE,
            )
        return cls(
            spec=spec,
            base_url=getattr(settings, "local_embedding_base_url", "http://embed.aup.internal/v1"),
            api_key=_secret(getattr(settings, "local_embedding_api_key", "")),
            batch_size=int(getattr(settings, "local_embedding_batch_size", 64)),
            client=client,
        )

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return await self._embed(texts, self.spec.passage_prefix)

    async def embed_query(self, text: str) -> list[float]:
        vectors = await self._embed([text], self.spec.query_prefix)
        return vectors[0] if vectors else []


class ApiEmbedder(_HttpEmbedder):
    """OpenAI `text-embedding-3-*`.

    **API model — NOT deployable inside AMD AUP.** There are no open weights to host;
    every request leaves the private compute boundary. Selecting this provider is an
    explicit enterprise-policy decision (§2.1 "External API 模式 → Approved Enterprise
    Policy"), and the tenant's data-residency setting must allow it. `LocalEmbedder`
    is the default for B2B deployments.
    """

    @classmethod
    def from_settings(cls, *, client: Any | None = None) -> ApiEmbedder:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        if not bool(getattr(settings, "allow_external_embedding", False)):
            raise EmbeddingError(
                "external embedding API is disabled for this deployment "
                "(settings.allow_external_embedding is false; see spec §2.1/§72)"
            )
        model_id = getattr(settings, "api_embedding_model", "text-embedding-3-small")
        spec = API_MODELS.get(model_id)
        if spec is None:
            raise EmbeddingError(f"unknown external embedding model: {model_id}")
        return cls(
            spec=spec,
            base_url=getattr(settings, "openai_base_url", "https://api.openai.com/v1"),
            api_key=_secret(getattr(settings, "openai_api_key", "")),
            batch_size=int(getattr(settings, "api_embedding_batch_size", 128)),
            client=client,
        )

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        # No instruction prefixes: text-embedding-3-* is symmetric.
        return await self._embed(texts, "")

    async def embed_query(self, text: str) -> list[float]:
        vectors = await self._embed([text], "")
        return vectors[0] if vectors else []


class DeterministicEmbedder:
    """Hash-based embedder for tests, offline demos and CI.

    Same text -> same vector, similar texts -> similar vectors (character trigram
    hashing), no network. Never select this in production: it has no semantics.
    """

    def __init__(self, *, dimension: int = 64, model_id: str = "deterministic-hash") -> None:
        self.spec = EmbeddingSpec(
            model_id=model_id,
            dimension=dimension,
            deployment=EmbeddingDeployment.DETERMINISTIC,
            max_input_tokens=10_000,
        )

    def _vector(self, text: str) -> list[float]:
        dimension = self.spec.dimension
        vector = [0.0] * dimension
        body = text.strip().lower()
        grams = [body[i : i + 3] for i in range(max(len(body) - 2, 1))] or [body]
        for gram in grams:
            digest = hashlib.blake2b(gram.encode("utf-8"), digest_size=8).digest()
            bucket = struct.unpack("<Q", digest)[0] % dimension
            sign = 1.0 if digest[0] % 2 == 0 else -1.0
            vector[bucket] += sign
        return _normalise(vector)

    async def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        await asyncio.sleep(0)
        return [self._vector(text) for text in texts]

    async def embed_query(self, text: str) -> list[float]:
        await asyncio.sleep(0)
        return self._vector(text)


def _secret(value: Any) -> str:
    getter = getattr(value, "get_secret_value", None)
    return str(getter()) if callable(getter) else str(value or "")


def spec_for(model_id: str) -> EmbeddingSpec:
    if model_id in LOCAL_MODELS:
        return LOCAL_MODELS[model_id]
    if model_id in API_MODELS:
        return API_MODELS[model_id]
    raise EmbeddingError(f"unknown embedding model: {model_id}")


def requires_external_policy(spec: EmbeddingSpec) -> bool:
    """True when using this model sends knowledge-base content outside AMD AUP."""
    return spec.deployment is EmbeddingDeployment.EXTERNAL_API


__all__ = [
    "API_MODELS",
    "LOCAL_MODELS",
    "ApiEmbedder",
    "DeterministicEmbedder",
    "EmbedderPort",
    "EmbeddingDeployment",
    "EmbeddingError",
    "EmbeddingSpec",
    "LocalEmbedder",
    "cosine",
    "requires_external_policy",
    "spec_for",
]
