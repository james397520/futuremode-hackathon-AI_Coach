"""§39 / §74 — a cross-tenant query must be structurally impossible.

    禁止跨 tenant / department 意外檢索。 (spec §39)
    Qdrant 必須帶 tenant_id / workspace_id / knowledge_base_id (spec §74)

Three layers are asserted:

1. `TenantScope` cannot be constructed without a tenant *and* a workspace.
2. `tenant_filter()` always emits both conditions, and `assert_scoped()` rejects any
   filter that lost them — the guard every backend routes through.
3. End to end: a store holding two tenants' vectors returns only the caller's rows,
   for search *and* delete, no matter how similar the foreign vector is.
"""

from __future__ import annotations

import pytest

from app.rag.embedder import EmbeddingSpec
from app.rag.vectorstore import (
    InMemoryVectorStore,
    QdrantStore,
    TenantIsolationError,
    TenantScope,
    VectorRecord,
    assert_scoped,
    record_matches,
    tenant_filter,
)
from conftest import make_record

SPEC = EmbeddingSpec(model_id="test-embed", dimension=4, deployment="deterministic")
#: The two tenants' documents are *identical*, so nothing but the filter can separate
#: them: if isolation regresses, the foreign row is the top hit.
SAME_TEXT = "本商品保證給付條件如下"
SAME_VECTOR = [1.0, 0.0, 0.0, 0.0]


@pytest.fixture
async def populated_store() -> InMemoryVectorStore:
    store = InMemoryVectorStore()
    await store.upsert(
        [
            make_record(
                tenant_id="t1",
                workspace_id="w1",
                text=SAME_TEXT,
                vector=SAME_VECTOR,
                document_id="doc_t1",
            ),
            make_record(
                tenant_id="t2",
                workspace_id="w2",
                text=SAME_TEXT,
                vector=SAME_VECTOR,
                document_id="doc_t2",
            ),
            make_record(
                tenant_id="t1",
                workspace_id="w_other",
                text=SAME_TEXT,
                vector=SAME_VECTOR,
                document_id="doc_t1_other_ws",
            ),
        ],
        spec=SPEC,
    )
    return store


# ---------------------------------------------------------------------------
# 1. the scope object itself
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("tenant_id", "workspace_id"),
    [("", "w1"), ("t1", ""), ("", ""), ("   ", "w1"), ("t1", "  ")],
)
def test_tenant_scope_refuses_to_exist_without_both_ids(tenant_id, workspace_id):
    with pytest.raises(TenantIsolationError):
        TenantScope(tenant_id=tenant_id, workspace_id=workspace_id)


def test_narrowing_to_a_forbidden_knowledge_base_raises():
    scope = TenantScope(tenant_id="t1", workspace_id="w1", knowledge_base_ids=("kb1",))
    with pytest.raises(TenantIsolationError):
        scope.narrowed_to(["kb_someone_else"])


def test_narrowing_intersects_rather_than_widens():
    scope = TenantScope(
        tenant_id="t1", workspace_id="w1", knowledge_base_ids=("kb1", "kb2")
    )
    narrowed = scope.narrowed_to(["kb2", "kb3"])
    assert narrowed.knowledge_base_ids == ("kb2",)
    assert narrowed.tenant_id == "t1"
    assert narrowed.workspace_id == "w1"


# ---------------------------------------------------------------------------
# 2. the filter builder + guard
# ---------------------------------------------------------------------------
def test_tenant_filter_always_contains_tenant_and_workspace():
    built = tenant_filter(TenantScope(tenant_id="t1", workspace_id="w1"))
    keys = {condition["key"] for condition in built["must"]}
    assert "tenant_id" in keys
    assert "workspace_id" in keys
    values = {
        condition["key"]: condition["match"].get("value") for condition in built["must"]
    }
    assert values["tenant_id"] == "t1"
    assert values["workspace_id"] == "w1"


def test_tenant_filter_excludes_excluded_chunks_and_parents_by_default():
    built = tenant_filter(TenantScope(tenant_id="t1", workspace_id="w1"))
    values = {
        condition["key"]: condition["match"].get("value") for condition in built["must"]
    }
    assert values["excluded_from_retrieval"] is False
    assert values["is_parent"] is False


def test_tenant_filter_adds_the_knowledge_base_allow_list():
    built = tenant_filter(
        TenantScope(tenant_id="t1", workspace_id="w1", knowledge_base_ids=("kb1", "kb2"))
    )
    kb = next(c for c in built["must"] if c["key"] == "knowledge_base_id")
    assert kb["match"]["any"] == ["kb1", "kb2"]


def test_tenant_filter_carries_the_acl_subjects():
    built = tenant_filter(
        TenantScope(tenant_id="t1", workspace_id="w1", acl_subject_ids=("team_a", "u1"))
    )
    assert built["should_acl"] == ["team_a", "u1"]


def test_assert_scoped_rejects_a_filter_that_lost_the_tenant():
    with pytest.raises(TenantIsolationError, match="tenant_id"):
        assert_scoped({"must": [{"key": "workspace_id", "match": {"value": "w1"}}]})
    with pytest.raises(TenantIsolationError, match="workspace_id"):
        assert_scoped({"must": [{"key": "tenant_id", "match": {"value": "t1"}}]})
    with pytest.raises(TenantIsolationError):
        assert_scoped({"must": []})
    with pytest.raises(TenantIsolationError):
        assert_scoped({})


def test_record_matches_rejects_a_foreign_tenant():
    built = tenant_filter(TenantScope(tenant_id="t1", workspace_id="w1"))
    mine = make_record(tenant_id="t1", workspace_id="w1", text="x", vector=[1, 0, 0, 0])
    theirs = make_record(tenant_id="t2", workspace_id="w1", text="x", vector=[1, 0, 0, 0])
    other_workspace = make_record(
        tenant_id="t1", workspace_id="w2", text="x", vector=[1, 0, 0, 0]
    )
    assert record_matches(mine, built) is True
    assert record_matches(theirs, built) is False
    assert record_matches(other_workspace, built) is False


# ---------------------------------------------------------------------------
# 3. end to end
# ---------------------------------------------------------------------------
async def test_search_never_returns_another_tenants_row(populated_store):
    hits = await populated_store.search(
        SAME_VECTOR,
        scope=TenantScope(tenant_id="t1", workspace_id="w1"),
        spec=SPEC,
        top_k=10,
    )
    assert hits, "the caller's own row must still be returned"
    assert {hit.record.tenant_id for hit in hits} == {"t1"}
    assert {hit.record.workspace_id for hit in hits} == {"w1"}
    assert all(hit.record.document_id == "doc_t1" for hit in hits)


async def test_search_never_returns_another_workspace_of_the_same_tenant(populated_store):
    hits = await populated_store.search(
        SAME_VECTOR,
        scope=TenantScope(tenant_id="t1", workspace_id="w_other"),
        spec=SPEC,
        top_k=10,
    )
    assert [hit.record.document_id for hit in hits] == ["doc_t1_other_ws"]


async def test_a_tenant_with_no_data_gets_nothing_not_someone_elses(populated_store):
    hits = await populated_store.search(
        SAME_VECTOR,
        scope=TenantScope(tenant_id="t_empty", workspace_id="w_empty"),
        spec=SPEC,
        top_k=10,
    )
    assert hits == []


async def test_every_search_applies_the_filter(populated_store):
    scope = TenantScope(tenant_id="t1", workspace_id="w1")
    await populated_store.search(SAME_VECTOR, scope=scope, spec=SPEC, top_k=5)
    await populated_store.search(SAME_VECTOR, scope=scope, spec=SPEC, top_k=5)
    assert len(populated_store.applied_filters) == 2
    for built in populated_store.applied_filters:
        assert_scoped(built)  # raises if a filter was ever unscoped


async def test_delete_cannot_reach_across_tenants(populated_store):
    removed = await populated_store.delete_document(
        "doc_t2", scope=TenantScope(tenant_id="t1", workspace_id="w1"), spec=SPEC
    )
    assert removed == 0
    # the other tenant's row is untouched
    assert any(record.document_id == "doc_t2" for record in populated_store.records.values())


async def test_delete_chunks_cannot_reach_across_tenants(populated_store):
    removed = await populated_store.delete_chunks(
        ["doc_t2:v1:0"], scope=TenantScope(tenant_id="t1", workspace_id="w1"), spec=SPEC
    )
    assert removed == 0


async def test_delete_within_the_tenant_works(populated_store):
    removed = await populated_store.delete_document(
        "doc_t1", scope=TenantScope(tenant_id="t1", workspace_id="w1"), spec=SPEC
    )
    assert removed == 1


async def test_upsert_refuses_an_unscoped_record():
    store = InMemoryVectorStore()
    with pytest.raises(TenantIsolationError):
        await store.upsert(
            [
                VectorRecord(
                    id="x",
                    vector=[1, 0, 0, 0],
                    tenant_id="",
                    workspace_id="w1",
                    knowledge_base_id="kb1",
                    document_id="doc",
                )
            ],
            spec=SPEC,
        )


# ---------------------------------------------------------------------------
# ACL narrowing (§39)
# ---------------------------------------------------------------------------
async def test_subject_scoped_chunk_is_hidden_from_a_caller_without_the_subject():
    store = InMemoryVectorStore()
    await store.upsert(
        [
            make_record(
                tenant_id="t1",
                workspace_id="w1",
                text="部門限閱內容",
                vector=SAME_VECTOR,
                document_id="doc_restricted",
                acl_subject_ids=["team_sales"],
            ),
            make_record(
                tenant_id="t1",
                workspace_id="w1",
                text="全公司可讀內容",
                vector=SAME_VECTOR,
                document_id="doc_open",
            ),
        ],
        spec=SPEC,
    )
    outsider = await store.search(
        SAME_VECTOR,
        scope=TenantScope(
            tenant_id="t1", workspace_id="w1", acl_subject_ids=("team_support",)
        ),
        spec=SPEC,
        top_k=10,
    )
    assert [hit.record.document_id for hit in outsider] == ["doc_open"]

    insider = await store.search(
        SAME_VECTOR,
        scope=TenantScope(
            tenant_id="t1", workspace_id="w1", acl_subject_ids=("team_sales",)
        ),
        spec=SPEC,
        top_k=10,
    )
    assert {hit.record.document_id for hit in insider} == {"doc_open", "doc_restricted"}


async def test_excluded_chunks_are_invisible_to_retrieval():
    store = InMemoryVectorStore()
    record = make_record(
        tenant_id="t1", workspace_id="w1", text="已排除", vector=SAME_VECTOR
    )
    record.excluded_from_retrieval = True
    await store.upsert([record], spec=SPEC)
    hits = await store.search(
        SAME_VECTOR, scope=TenantScope(tenant_id="t1", workspace_id="w1"), spec=SPEC
    )
    assert hits == []


async def test_parent_chunks_are_only_reachable_through_expansion():
    store = InMemoryVectorStore()
    await store.upsert(
        [
            make_record(
                tenant_id="t1",
                workspace_id="w1",
                text="父層內容",
                vector=SAME_VECTOR,
                document_id="doc_parent",
                is_parent=True,
            )
        ],
        spec=SPEC,
    )
    scope = TenantScope(tenant_id="t1", workspace_id="w1")
    assert await store.search(SAME_VECTOR, scope=scope, spec=SPEC) == []
    expanded = await store.search(
        SAME_VECTOR, scope=scope, spec=SPEC, include_parents=True
    )
    assert len(expanded) == 1


# ---------------------------------------------------------------------------
# the Qdrant translation keeps the guarantee
# ---------------------------------------------------------------------------
def test_qdrant_collection_name_is_namespaced_by_embedding_geometry():
    store = QdrantStore(client=object(), collection_prefix="kb")
    small = EmbeddingSpec(model_id="BAAI/bge-m3", dimension=1024, deployment="private")
    large = EmbeddingSpec(
        model_id="text-embedding-3-large", dimension=3072, deployment="external_api"
    )
    assert store.collection_name(small) != store.collection_name(large)
    assert "1024" in store.collection_name(small)
    assert "3072" in store.collection_name(large)


def test_qdrant_filter_translation_refuses_an_unscoped_filter():
    with pytest.raises(TenantIsolationError):
        QdrantStore._to_qdrant_filter({"must": []})
