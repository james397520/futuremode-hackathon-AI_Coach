"""The embedding endpoints: batch shape, input order, and the limits."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.conftest import EMBED_MODEL, RERANK_MODEL
from tests.fakes import FAKE_DIMENSION, SessionSpy

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_batch_embedding_shape_and_dimension(client: TestClient) -> None:
    texts = ["alpha", "beta gamma", "delta", "epsilon zeta eta"]
    response = client.post("/v1/embed", json={"texts": texts})

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == EMBED_MODEL
    assert body["dimension"] == FAKE_DIMENSION
    assert len(body["vectors"]) == len(texts)
    assert all(len(vector) == FAKE_DIMENSION for vector in body["vectors"])
    assert len(body["token_counts"]) == len(texts)
    assert body["usage"]["total_tokens"] == sum(body["token_counts"])
    assert body["usage"]["batch_count"] >= 1


def test_batching_does_not_change_the_answer(client: TestClient) -> None:
    """The vector at index i is the embedding of the input at index i.

    The caller writes these against chunk ids by position, so a batching-induced
    reordering would mis-attribute every chunk.
    """
    texts = ["short", "a much longer piece of text here", "mid length text"]
    batched = client.post("/v1/embed", json={"texts": texts, "batch_size": 4}).json()
    one_by_one = [
        client.post("/v1/embed", json={"texts": [text]}).json()["vectors"][0] for text in texts
    ]

    for index, expected in enumerate(one_by_one):
        actual = batched["vectors"][index]
        assert actual == pytest.approx(expected, rel=1e-6, abs=1e-9)


def test_openai_compatible_shape(client: TestClient) -> None:
    """`apps/api`'s LocalEmbedder reads `data[].embedding` sorted by `index`."""
    response = client.post(
        "/v1/embeddings",
        json={"model": EMBED_MODEL, "input": ["one", "two", "three"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "list"
    assert [row["index"] for row in body["data"]] == [0, 1, 2]
    assert all(len(row["embedding"]) == FAKE_DIMENSION for row in body["data"])
    assert body["model"] == EMBED_MODEL
    assert body["dimension"] == FAKE_DIMENSION
    assert body["usage"]["total_tokens"] > 0


def test_openai_route_is_also_mounted_at_the_root(client: TestClient) -> None:
    """A caller configured with a bare base URL must resolve too."""
    response = client.post("/embeddings", json={"input": "single string"})

    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


def test_single_string_input_yields_one_vector(client: TestClient) -> None:
    body = client.post("/v1/embeddings", json={"input": "just one"}).json()

    assert len(body["data"]) == 1
    assert body["data"][0]["index"] == 0


def test_embed_query_uses_the_query_prefix(client: TestClient) -> None:
    """The native route owns the prefix; the OpenAI route deliberately does not."""
    as_query = client.post("/v1/embed/query", json={"text": "hello"}).json()
    as_raw = client.post("/v1/embed", json={"texts": ["hello"], "kind": "raw"}).json()

    assert len(as_query["vector"]) == FAKE_DIMENSION
    # `query: ` was prepended, so the vectors must differ.
    assert as_query["vector"] != as_raw["vectors"][0]


def test_too_many_texts_is_a_typed_413(client: TestClient) -> None:
    """`max_texts_per_request` is 6 in the fixture settings."""
    response = client.post("/v1/embed", json={"texts": [f"text {i}" for i in range(7)]})

    assert response.status_code == 413
    problem = response.json()
    assert problem["code"] == "payload_too_large"
    assert problem["errors"][0]["field"] == "body.texts"
    assert "6" in problem["detail"]


def test_input_longer_than_the_character_limit_is_a_typed_413(client: TestClient) -> None:
    """`max_input_chars` is 64 in the fixture settings; the guard runs pre-tokenisation."""
    response = client.post("/v1/embed", json={"texts": ["x" * 65]})

    assert response.status_code == 413
    problem = response.json()
    assert problem["code"] == "payload_too_large"
    assert problem["errors"][0]["field"] == "body.texts[0]"
    # The offending text is never echoed back.
    assert "x" * 65 not in response.text


def test_batch_size_above_the_ceiling_is_rejected(client: TestClient) -> None:
    """`max_batch_size` is 4; asking for 64 is a wrong sizing assumption, not a clamp."""
    response = client.post("/v1/embed", json={"texts": ["a"], "batch_size": 64})

    assert response.status_code == 422
    problem = response.json()
    assert problem["code"] == "validation_failed"
    assert problem["errors"][0]["field"] == "body.batch_size"


def test_empty_input_is_rejected(client: TestClient) -> None:
    response = client.post("/v1/embed", json={"texts": []})

    assert response.status_code == 422
    assert response.json()["code"] == "validation_failed"


def test_batch_size_respects_the_ceiling(client: TestClient, spy: SessionSpy) -> None:
    """Six texts with a ceiling of four means at least two ONNX executions."""
    body = client.post("/v1/embed", json={"texts": [f"t{i}" for i in range(6)]}).json()

    assert body["usage"]["batch_count"] >= 2
    assert spy.batch_sizes
    assert max(spy.batch_sizes) <= 4


def test_rerank_model_cannot_serve_embed(client: TestClient) -> None:
    response = client.post("/v1/embed", json={"texts": ["a"], "model": RERANK_MODEL})

    assert response.status_code == 400
    assert response.json()["code"] == "model_task_mismatch"


def test_unknown_model_is_a_typed_404(client: TestClient) -> None:
    response = client.post("/v1/embed", json={"texts": ["a"], "model": "nope/not-a-model"})

    assert response.status_code == 404
    assert response.json()["code"] == "model_not_found"


def test_dimension_truncation_is_refused(client: TestClient) -> None:
    """A narrowed vector indexed against a full-width collection is silent corruption."""
    response = client.post("/v1/embeddings", json={"input": "a", "dimensions": 4})

    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "body.dimensions"
