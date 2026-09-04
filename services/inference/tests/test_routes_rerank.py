"""The rerank endpoint: ordering, index mapping, aliases and limits."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import EMBED_MODEL, RERANK_MODEL

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

_DOCUMENTS = [
    "a",
    "an unusually long candidate document with many tokens in it",
    "medium sized candidate",
    "bb",
]


def test_results_are_ordered_by_descending_score(client: TestClient) -> None:
    response = client.post(
        "/v1/rerank",
        json={"query": "relevant query", "texts": _DOCUMENTS},
    )

    assert response.status_code == 200
    body = response.json()
    scores = [row["score"] for row in body["results"]]
    assert scores == sorted(scores, reverse=True)
    assert len(body["results"]) == len(_DOCUMENTS)


def test_every_result_keeps_its_input_index(client: TestClient) -> None:
    """`results[].index` points into the caller's list; nothing is reordered in place."""
    body = client.post("/v1/rerank", json={"query": "q", "texts": _DOCUMENTS}).json()

    indices = [row["index"] for row in body["results"]]
    assert sorted(indices) == list(range(len(_DOCUMENTS)))
    # `scores` is in input order, so the ranking must agree with it point by point.
    for row in body["results"]:
        assert row["score"] == body["scores"][row["index"]]
    best = max(range(len(_DOCUMENTS)), key=lambda i: body["scores"][i])
    assert body["results"][0]["index"] == best


def test_scores_are_reported_for_every_document_even_with_top_k(client: TestClient) -> None:
    """A caller blending rerank with retrieval needs the scores it did not rank."""
    body = client.post(
        "/v1/rerank",
        json={"query": "q", "texts": _DOCUMENTS, "top_k": 2},
    ).json()

    assert len(body["results"]) == 2
    assert len(body["scores"]) == len(_DOCUMENTS)


def test_cohere_spellings_are_accepted(client: TestClient) -> None:
    body = client.post(
        "/v1/rerank",
        json={"query": "q", "documents": _DOCUMENTS, "top_n": 3},
    ).json()

    assert len(body["results"]) == 3


def test_tei_client_contract(client: TestClient) -> None:
    """`apps/api`'s CrossEncoderReranker posts to `/rerank` and reads index+score."""
    response = client.post(
        "/rerank",
        json={"model": RERANK_MODEL, "query": "q", "texts": _DOCUMENTS},
    )

    assert response.status_code == 200
    rows = response.json()["results"]
    for row in rows:
        assert isinstance(row["index"], int)
        assert isinstance(row["score"], float)
        assert row["relevance_score"] == row["score"]


def test_documents_are_not_echoed_by_default(client: TestClient) -> None:
    response = client.post("/v1/rerank", json={"query": "q", "texts": _DOCUMENTS})

    assert "unusually long candidate" not in response.text
    assert all("document" not in row for row in response.json()["results"])


def test_documents_are_echoed_on_request(client: TestClient) -> None:
    body = client.post(
        "/v1/rerank",
        json={"query": "q", "texts": _DOCUMENTS, "return_documents": True},
    ).json()

    for row in body["results"]:
        assert row["document"] == _DOCUMENTS[row["index"]]


def test_activation_is_reported(client: TestClient) -> None:
    """Scores are only comparable across requests reporting the same calibration."""
    body = client.post("/v1/rerank", json={"query": "q", "texts": ["a"]}).json()

    assert body["activation"] == "sigmoid"
    assert 0.0 <= body["scores"][0] <= 1.0


def test_too_many_documents_is_a_typed_413(client: TestClient) -> None:
    response = client.post(
        "/v1/rerank",
        json={"query": "q", "texts": [f"d{i}" for i in range(7)]},
    )

    assert response.status_code == 413
    assert response.json()["errors"][0]["field"] == "body.documents"


def test_overlong_query_is_a_typed_413(client: TestClient) -> None:
    response = client.post("/v1/rerank", json={"query": "q" * 65, "texts": ["a"]})

    assert response.status_code == 413
    assert response.json()["errors"][0]["field"] == "body.query[0]"


def test_batch_size_above_the_ceiling_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/v1/rerank",
        json={"query": "q", "texts": ["a"], "batch_size": 99},
    )

    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "body.batch_size"


def test_embedding_model_cannot_serve_rerank(client: TestClient) -> None:
    response = client.post(
        "/v1/rerank",
        json={"query": "q", "texts": ["a"], "model": EMBED_MODEL},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "model_task_mismatch"
