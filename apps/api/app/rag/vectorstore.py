"""Vector storage — Qdrant primary, with **structural** tenant isolation (§39, §74).

    禁止跨 tenant / department 意外檢索。 (spec §39)
    Qdrant 必須帶 tenant_id / workspace_id / knowledge_base_id (spec §74)

The isolation rule is enforced by making an unfiltered query *unrepresentable*:

* `search()` and `delete()` take a required `TenantScope`; there is no default and no
  overload without it.
* `TenantScope.__post_init__` rejects a missing/blank `tenant_id` or `workspace_id`,
  so a caller cannot smuggle an empty filter through.
* `tenant_filter(scope)` — a pure function every backend must route through — always
  emits `tenant_id` AND `workspace_id` conditions, plus `knowledge_base_id ∈ …` when
  the ACL narrowed the bases, plus the `acl_subject_ids` term when the knowledge ACL
  is subject-scoped (§39 scope: organization/workspace/department/team/role/user).
* Backends assert on the built filter before issuing the call, so a future backend
  cannot forget.

`tests/test_vectorstore_isolation.py` pins all of this.

Backends
--------
`QdrantStore`  — production B2B primary (§12.2 "Qdrant：建議正式 B2B 主選").
`ChromaStore`  — POC / smaller deployment **only**; not for production tenancy.
`FaissStore`   — local/embedded experiment **only**; no server-side filtering, so it
                 filters in-process and must never hold more than one tenant.
`InMemoryVectorStore` — deterministic test double that records every filter it saw.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.rag.embedder import EmbeddingSpec, cosine

log = structlog.get_logger(__name__)


class TenantIsolationError(RuntimeError):
    """Raised when a query would not be tenant-scoped. Never caught — it is a bug."""


@dataclass(frozen=True)
class TenantScope:
    """The mandatory scope of every vector operation (§10, §39, §74)."""

    tenant_id: str
    workspace_id: str
    #: empty means "every KB the caller may use" — still tenant+workspace scoped
    knowledge_base_ids: tuple[str, ...] = ()
    #: user/team/department/role ids the caller holds, for subject-scoped ACLs (§39)
    acl_subject_ids: tuple[str, ...] = ()
    #: extra metadata equality filters from the retrieval playground (§12.4)
    metadata_filter: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not str(self.tenant_id).strip():
            raise TenantIsolationError("tenant_id is required for every vector operation")
        if not str(self.workspace_id).strip():
            raise TenantIsolationError("workspace_id is required for every vector operation")

    def narrowed_to(self, knowledge_base_ids: Sequence[str]) -> TenantScope:
        """Intersect with an allow-list (what the ACL check produced)."""
        allowed = tuple(knowledge_base_ids)
        if self.knowledge_base_ids:
            allowed = tuple(kb for kb in self.knowledge_base_ids if kb in set(allowed))
            if not allowed:
                raise TenantIsolationError(
                    "requested knowledge bases are not permitted for this caller"
                )
        return TenantScope(
            tenant_id=self.tenant_id,
            workspace_id=self.workspace_id,
            knowledge_base_ids=allowed,
            acl_subject_ids=self.acl_subject_ids,
            metadata_filter=dict(self.metadata_filter),
        )


class VectorRecord(BaseModel):
    """One indexed chunk. Every payload carries the tenancy triple (§74)."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    vector: list[float] = Field(default_factory=list)
    tenant_id: str
    workspace_id: str
    knowledge_base_id: str
    document_id: str
    document_version: int = 1
    chunk_id: str = ""
    chunk_index: int = 0
    text: str = ""
    page: int | None = None
    section: str | None = None
    parent_chunk_id: str | None = None
    #: parent chunks are indexed but excluded from ordinary search; retrieval reaches
    #: them only through parent-document expansion (§12.3)
    is_parent: bool = False
    tags: list[str] = Field(default_factory=list)
    excluded_from_retrieval: bool = False
    #: ACL subjects allowed to retrieve this record (empty = workspace-wide)
    acl_subject_ids: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def payload(self) -> dict[str, Any]:
        data = self.model_dump(exclude={"vector", "id"})
        return data


class VectorHit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    score: float
    record: VectorRecord


@runtime_checkable
class VectorStore(Protocol):
    """Every method that touches data requires a `TenantScope`."""

    name: str

    async def ensure_collection(self, spec: EmbeddingSpec) -> str: ...

    async def upsert(self, records: Sequence[VectorRecord], *, spec: EmbeddingSpec) -> int: ...

    async def search(
        self,
        vector: Sequence[float],
        *,
        scope: TenantScope,
        spec: EmbeddingSpec,
        top_k: int = 8,
        score_threshold: float | None = None,
        include_parents: bool = False,
    ) -> list[VectorHit]: ...

    async def delete_document(
        self, document_id: str, *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int: ...

    async def delete_chunks(
        self, chunk_ids: Sequence[str], *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int: ...


# ---------------------------------------------------------------------------
# the one filter builder every backend must use
# ---------------------------------------------------------------------------
def tenant_filter(scope: TenantScope, *, include_parents: bool = False) -> dict[str, Any]:
    """Build the canonical filter. Always contains tenant_id AND workspace_id.

    Returned in a backend-neutral shape:
        {"must": [{"key": ..., "match": {"value": ...}}, ...]}
    which `QdrantStore` converts to `qdrant_client.models.Filter` and the POC stores
    evaluate in-process.
    """
    must: list[dict[str, Any]] = [
        {"key": "tenant_id", "match": {"value": scope.tenant_id}},
        {"key": "workspace_id", "match": {"value": scope.workspace_id}},
        {"key": "excluded_from_retrieval", "match": {"value": False}},
    ]
    if not include_parents:
        must.append({"key": "is_parent", "match": {"value": False}})
    if scope.knowledge_base_ids:
        must.append(
            {"key": "knowledge_base_id", "match": {"any": list(scope.knowledge_base_ids)}}
        )
    for key, value in sorted(scope.metadata_filter.items()):
        if isinstance(value, (list, tuple, set)):
            must.append({"key": f"metadata.{key}", "match": {"any": list(value)}})
        else:
            must.append({"key": f"metadata.{key}", "match": {"value": value}})
    built: dict[str, Any] = {"must": must}
    if scope.acl_subject_ids:
        # A record is visible when it is workspace-wide (no subjects) or when it names
        # one of the caller's subjects (§39 Knowledge Access Control).
        built["should_acl"] = list(scope.acl_subject_ids)
    return built


def assert_scoped(built: Mapping[str, Any]) -> None:
    """Backend guard: refuse to issue a query that is not tenant-scoped."""
    keys = {
        condition.get("key")
        for condition in built.get("must", [])
        if isinstance(condition, Mapping)
    }
    missing = {"tenant_id", "workspace_id"} - keys
    if missing:
        raise TenantIsolationError(
            f"refusing to run an unscoped vector query; missing filter keys: {sorted(missing)}"
        )


def record_matches(record: VectorRecord, built: Mapping[str, Any]) -> bool:
    """In-process evaluation of a built filter (POC backends + the test double)."""
    assert_scoped(built)
    payload = {
        "tenant_id": record.tenant_id,
        "workspace_id": record.workspace_id,
        "knowledge_base_id": record.knowledge_base_id,
        "document_id": record.document_id,
        "excluded_from_retrieval": record.excluded_from_retrieval,
        "is_parent": bool(record.is_parent),
        **{f"metadata.{k}": v for k, v in record.metadata.items()},
    }
    for condition in built.get("must", []):
        key = condition["key"]
        match = condition["match"]
        value = payload.get(key)
        if "value" in match:
            if value != match["value"]:
                return False
        elif "any" in match and value not in match["any"]:
            return False
    subjects = built.get("should_acl")
    if subjects is not None and record.acl_subject_ids:
        if not set(record.acl_subject_ids) & set(subjects):
            return False
    return True


# ---------------------------------------------------------------------------
# Qdrant (production)
# ---------------------------------------------------------------------------
class QdrantStore:
    """Primary store for production B2B (§12.2, §74).

    Collection naming: `{prefix}_{embedding index_key}`. Vectors of different models
    or dimensions therefore live in different collections and can never be compared.
    Tenancy is *payload*-based with indexed keys — the recommended Qdrant multitenancy
    model — and every search goes through `tenant_filter`.
    """

    name = "qdrant"

    def __init__(
        self,
        client: Any | None = None,
        *,
        url: str | None = None,
        api_key: str | None = None,
        collection_prefix: str = "aicoach_kb",
    ) -> None:
        self._client = client
        self._url = url
        self._api_key = api_key
        self.collection_prefix = collection_prefix
        self._ensured: set[str] = set()

    @classmethod
    def from_settings(cls, client: Any | None = None) -> QdrantStore:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        api_key = getattr(settings, "qdrant_api_key", None)
        getter = getattr(api_key, "get_secret_value", None)
        return cls(
            client=client,
            url=getattr(settings, "qdrant_url", "http://qdrant:6333"),
            api_key=str(getter()) if callable(getter) else (str(api_key) if api_key else None),
            collection_prefix=getattr(settings, "qdrant_collection_prefix", "aicoach_kb"),
        )

    def collection_name(self, spec: EmbeddingSpec) -> str:
        return f"{self.collection_prefix}_{spec.index_key()}"

    def _qdrant(self) -> Any:
        if self._client is None:
            from qdrant_client import AsyncQdrantClient

            self._client = AsyncQdrantClient(url=self._url, api_key=self._api_key)
        return self._client

    async def ensure_collection(self, spec: EmbeddingSpec) -> str:
        from qdrant_client import models as qm

        collection = self.collection_name(spec)
        if collection in self._ensured:
            return collection
        client = self._qdrant()
        if not await client.collection_exists(collection):
            await client.create_collection(
                collection_name=collection,
                vectors_config=qm.VectorParams(
                    size=spec.dimension, distance=qm.Distance.COSINE
                ),
            )
        # Payload indexes on the tenancy keys: without these, multitenant filtering
        # degrades to a full scan (§49.1 performance).
        for key in ("tenant_id", "workspace_id", "knowledge_base_id", "document_id"):
            try:
                await client.create_payload_index(
                    collection_name=collection,
                    field_name=key,
                    field_schema=qm.PayloadSchemaType.KEYWORD,
                )
            except Exception as exc:  # noqa: BLE001 - already-exists is the common case
                log.debug("qdrant.index_exists", key=key, error=repr(exc))
        self._ensured.add(collection)
        return collection

    @staticmethod
    def _to_qdrant_filter(built: Mapping[str, Any]) -> Any:
        from qdrant_client import models as qm

        assert_scoped(built)
        must: list[Any] = []
        for condition in built.get("must", []):
            key = condition["key"]
            match = condition["match"]
            if "any" in match:
                must.append(qm.FieldCondition(key=key, match=qm.MatchAny(any=match["any"])))
            else:
                must.append(
                    qm.FieldCondition(key=key, match=qm.MatchValue(value=match["value"]))
                )
        subjects = built.get("should_acl")
        if subjects:
            must.append(
                qm.Filter(
                    should=[
                        qm.IsEmptyCondition(is_empty=qm.PayloadField(key="acl_subject_ids")),
                        qm.FieldCondition(
                            key="acl_subject_ids", match=qm.MatchAny(any=list(subjects))
                        ),
                    ]
                )
            )
        return qm.Filter(must=must)

    async def upsert(self, records: Sequence[VectorRecord], *, spec: EmbeddingSpec) -> int:
        from qdrant_client import models as qm

        if not records:
            return 0
        for record in records:
            if not record.tenant_id or not record.workspace_id:
                raise TenantIsolationError(
                    f"record {record.id} is missing tenant_id/workspace_id; refusing to index"
                )
            if len(record.vector) != spec.dimension:
                raise ValueError(
                    f"record {record.id} vector dimension {len(record.vector)} "
                    f"!= collection dimension {spec.dimension}"
                )
        collection = await self.ensure_collection(spec)
        points = [
            qm.PointStruct(id=record.id, vector=record.vector, payload=record.payload())
            for record in records
        ]
        await self._qdrant().upsert(collection_name=collection, points=points, wait=True)
        return len(points)

    async def search(
        self,
        vector: Sequence[float],
        *,
        scope: TenantScope,
        spec: EmbeddingSpec,
        top_k: int = 8,
        score_threshold: float | None = None,
        include_parents: bool = False,
    ) -> list[VectorHit]:
        built = tenant_filter(scope, include_parents=include_parents)
        query_filter = self._to_qdrant_filter(built)
        collection = await self.ensure_collection(spec)
        response = await self._qdrant().search(
            collection_name=collection,
            query_vector=list(vector),
            query_filter=query_filter,
            limit=top_k,
            score_threshold=score_threshold,
            with_payload=True,
        )
        hits: list[VectorHit] = []
        for point in response:
            payload = dict(point.payload or {})
            hits.append(
                VectorHit(
                    id=str(point.id),
                    score=float(point.score),
                    record=VectorRecord(id=str(point.id), vector=[], **payload),
                )
            )
        return hits

    async def delete_document(
        self, document_id: str, *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        from qdrant_client import models as qm

        built = tenant_filter(scope, include_parents=True)
        built["must"].append({"key": "document_id", "match": {"value": document_id}})
        collection = await self.ensure_collection(spec)
        await self._qdrant().delete(
            collection_name=collection,
            points_selector=qm.FilterSelector(filter=self._to_qdrant_filter(built)),
            wait=True,
        )
        return 1

    async def delete_chunks(
        self, chunk_ids: Sequence[str], *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        from qdrant_client import models as qm

        if not chunk_ids:
            return 0
        built = tenant_filter(scope, include_parents=True)
        built["must"].append({"key": "chunk_id", "match": {"any": list(chunk_ids)}})
        collection = await self.ensure_collection(spec)
        await self._qdrant().delete(
            collection_name=collection,
            points_selector=qm.FilterSelector(filter=self._to_qdrant_filter(built)),
            wait=True,
        )
        return len(chunk_ids)


# ---------------------------------------------------------------------------
# POC / local-only backends
# ---------------------------------------------------------------------------
class InMemoryVectorStore:
    """Deterministic test double. Records every filter it was asked to apply."""

    name = "memory"

    def __init__(self) -> None:
        self.records: dict[str, VectorRecord] = {}
        self.applied_filters: list[dict[str, Any]] = []

    async def ensure_collection(self, spec: EmbeddingSpec) -> str:
        return f"memory_{spec.index_key()}"

    async def upsert(self, records: Sequence[VectorRecord], *, spec: EmbeddingSpec) -> int:
        for record in records:
            if not record.tenant_id or not record.workspace_id:
                raise TenantIsolationError("record is missing tenant_id/workspace_id")
            self.records[record.id] = record
        return len(records)

    async def search(
        self,
        vector: Sequence[float],
        *,
        scope: TenantScope,
        spec: EmbeddingSpec,
        top_k: int = 8,
        score_threshold: float | None = None,
        include_parents: bool = False,
    ) -> list[VectorHit]:
        built = tenant_filter(scope, include_parents=include_parents)
        assert_scoped(built)
        self.applied_filters.append(built)
        await asyncio.sleep(0)
        scored: list[VectorHit] = []
        for record in self.records.values():
            if not record_matches(record, built):
                continue
            score = cosine(vector, record.vector)
            if score_threshold is not None and score < score_threshold:
                continue
            scored.append(VectorHit(id=record.id, score=score, record=record))
        scored.sort(key=lambda hit: hit.score, reverse=True)
        return scored[:top_k]

    async def delete_document(
        self, document_id: str, *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        built = tenant_filter(scope, include_parents=True)
        assert_scoped(built)
        self.applied_filters.append(built)
        victims = [
            key
            for key, record in self.records.items()
            if record.document_id == document_id and record_matches(record, built)
        ]
        for key in victims:
            del self.records[key]
        return len(victims)

    async def delete_chunks(
        self, chunk_ids: Sequence[str], *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        built = tenant_filter(scope, include_parents=True)
        assert_scoped(built)
        self.applied_filters.append(built)
        wanted = set(chunk_ids)
        victims = [
            key
            for key, record in self.records.items()
            if record.chunk_id in wanted and record_matches(record, built)
        ]
        for key in victims:
            del self.records[key]
        return len(victims)


class ChromaStore:
    """ChromaDB — **POC / smaller deployment only** (§12.2).

    Kept behind the same protocol so a POC can graduate to Qdrant without touching
    the pipeline. Not recommended for production multitenancy: metadata filtering is
    the only isolation mechanism available and there are no payload indexes, so the
    §49.1 latency targets are not achievable at B2B scale.
    """

    name = "chroma"

    def __init__(self, client: Any | None = None, *, collection_prefix: str = "aicoach_kb") -> None:
        self._client = client
        self.collection_prefix = collection_prefix

    def _chroma(self) -> Any:
        if self._client is None:
            try:
                import chromadb  # type: ignore[import-not-found]
            except ImportError as exc:  # pragma: no cover - optional POC dependency
                raise RuntimeError(
                    "chromadb is not installed; ChromaStore is a POC-only backend"
                ) from exc
            self._client = chromadb.Client()
        return self._client

    def _collection(self, spec: EmbeddingSpec) -> Any:
        return self._chroma().get_or_create_collection(
            f"{self.collection_prefix}_{spec.index_key()}"
        )

    async def ensure_collection(self, spec: EmbeddingSpec) -> str:
        return str(self._collection(spec).name)

    async def upsert(self, records: Sequence[VectorRecord], *, spec: EmbeddingSpec) -> int:
        if not records:
            return 0
        for record in records:
            if not record.tenant_id or not record.workspace_id:
                raise TenantIsolationError("record is missing tenant_id/workspace_id")
        collection = self._collection(spec)
        await asyncio.to_thread(
            collection.upsert,
            ids=[r.id for r in records],
            embeddings=[list(r.vector) for r in records],
            documents=[r.text for r in records],
            metadatas=[_flatten(r.payload()) for r in records],
        )
        return len(records)

    async def search(
        self,
        vector: Sequence[float],
        *,
        scope: TenantScope,
        spec: EmbeddingSpec,
        top_k: int = 8,
        score_threshold: float | None = None,
        include_parents: bool = False,
    ) -> list[VectorHit]:
        built = tenant_filter(scope, include_parents=include_parents)
        assert_scoped(built)
        where: dict[str, Any] = {
            "$and": [
                {condition["key"]: {"$in": condition["match"]["any"]}}
                if "any" in condition["match"]
                else {condition["key"]: condition["match"]["value"]}
                for condition in built["must"]
            ]
        }
        collection = self._collection(spec)
        response = await asyncio.to_thread(
            collection.query,
            query_embeddings=[list(vector)],
            n_results=top_k,
            where=where,
        )
        hits: list[VectorHit] = []
        ids = (response.get("ids") or [[]])[0]
        distances = (response.get("distances") or [[]])[0]
        metadatas = (response.get("metadatas") or [[]])[0]
        documents = (response.get("documents") or [[]])[0]
        for index, record_id in enumerate(ids):
            score = 1.0 - float(distances[index]) if index < len(distances) else 0.0
            if score_threshold is not None and score < score_threshold:
                continue
            metadata = dict(metadatas[index] or {}) if index < len(metadatas) else {}
            metadata.setdefault("text", documents[index] if index < len(documents) else "")
            hits.append(
                VectorHit(
                    id=str(record_id),
                    score=score,
                    record=_record_from_flat(str(record_id), metadata),
                )
            )
        return hits

    async def delete_document(
        self, document_id: str, *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        assert_scoped(tenant_filter(scope, include_parents=True))
        collection = self._collection(spec)
        await asyncio.to_thread(
            collection.delete,
            where={
                "$and": [
                    {"tenant_id": scope.tenant_id},
                    {"workspace_id": scope.workspace_id},
                    {"document_id": document_id},
                ]
            },
        )
        return 1

    async def delete_chunks(
        self, chunk_ids: Sequence[str], *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        assert_scoped(tenant_filter(scope, include_parents=True))
        collection = self._collection(spec)
        await asyncio.to_thread(
            collection.delete,
            where={
                "$and": [
                    {"tenant_id": scope.tenant_id},
                    {"workspace_id": scope.workspace_id},
                    {"chunk_id": {"$in": list(chunk_ids)}},
                ]
            },
        )
        return len(chunk_ids)


class FaissStore:
    """FAISS — **local / embedded experiment only** (§12.2).

    FAISS has no payload store and no server-side filtering, so isolation has to be
    done in-process after the ANN search. That is acceptable for a single-tenant
    developer sandbox and unacceptable for production: an index shared by two tenants
    could return a foreign neighbour before filtering. `upsert` therefore refuses to
    mix tenants in one index.
    """

    name = "faiss"

    def __init__(self) -> None:
        self._store = InMemoryVectorStore()
        self._tenant: tuple[str, str] | None = None

    async def ensure_collection(self, spec: EmbeddingSpec) -> str:
        return f"faiss_{spec.index_key()}"

    async def upsert(self, records: Sequence[VectorRecord], *, spec: EmbeddingSpec) -> int:
        for record in records:
            key = (record.tenant_id, record.workspace_id)
            if self._tenant is None:
                self._tenant = key
            elif self._tenant != key:
                raise TenantIsolationError(
                    "FaissStore is single-tenant by design; use QdrantStore for multitenancy"
                )
        return await self._store.upsert(records, spec=spec)

    async def search(
        self,
        vector: Sequence[float],
        *,
        scope: TenantScope,
        spec: EmbeddingSpec,
        top_k: int = 8,
        score_threshold: float | None = None,
        include_parents: bool = False,
    ) -> list[VectorHit]:
        return await self._store.search(
            vector,
            scope=scope,
            spec=spec,
            top_k=top_k,
            score_threshold=score_threshold,
            include_parents=include_parents,
        )

    async def delete_document(
        self, document_id: str, *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        return await self._store.delete_document(document_id, scope=scope, spec=spec)

    async def delete_chunks(
        self, chunk_ids: Sequence[str], *, scope: TenantScope, spec: EmbeddingSpec
    ) -> int:
        return await self._store.delete_chunks(chunk_ids, scope=scope, spec=spec)


def _flatten(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Chroma metadata must be scalar-valued."""
    out: dict[str, Any] = {}
    for key, value in payload.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            out[key] = value
        elif isinstance(value, (list, tuple)):
            out[key] = ",".join(str(item) for item in value)
        elif isinstance(value, Mapping):
            for sub_key, sub_value in value.items():
                if isinstance(sub_value, (str, int, float, bool)):
                    out[f"metadata.{sub_key}"] = sub_value
    return out


def _record_from_flat(record_id: str, metadata: Mapping[str, Any]) -> VectorRecord:
    tags = metadata.get("tags")
    acl = metadata.get("acl_subject_ids")
    return VectorRecord(
        id=record_id,
        vector=[],
        tenant_id=str(metadata.get("tenant_id", "")),
        workspace_id=str(metadata.get("workspace_id", "")),
        knowledge_base_id=str(metadata.get("knowledge_base_id", "")),
        document_id=str(metadata.get("document_id", "")),
        document_version=int(metadata.get("document_version", 1) or 1),
        chunk_id=str(metadata.get("chunk_id", "")),
        chunk_index=int(metadata.get("chunk_index", 0) or 0),
        text=str(metadata.get("text", "")),
        page=metadata.get("page"),
        section=metadata.get("section"),
        parent_chunk_id=metadata.get("parent_chunk_id"),
        is_parent=bool(metadata.get("is_parent", False)),
        tags=str(tags).split(",") if isinstance(tags, str) and tags else [],
        excluded_from_retrieval=bool(metadata.get("excluded_from_retrieval", False)),
        acl_subject_ids=str(acl).split(",") if isinstance(acl, str) and acl else [],
        metadata={
            key.removeprefix("metadata."): value
            for key, value in metadata.items()
            if key.startswith("metadata.")
        },
    )


__all__ = [
    "ChromaStore",
    "FaissStore",
    "InMemoryVectorStore",
    "QdrantStore",
    "TenantIsolationError",
    "TenantScope",
    "VectorHit",
    "VectorRecord",
    "VectorStore",
    "assert_scoped",
    "record_matches",
    "tenant_filter",
]
