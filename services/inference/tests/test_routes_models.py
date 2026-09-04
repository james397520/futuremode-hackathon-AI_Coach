"""Model introspection: the audit surface."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import EMBED_MODEL, RERANK_MODEL
from tests.fakes import FAKE_DIMENSION, fake_tokenizer_factory, make_session_factory

if TYPE_CHECKING:
    from app.core.config import Settings


def test_listing_reports_resolved_provenance(client: TestClient) -> None:
    """"Which bytes served this request" has to be answerable from the process."""
    response = client.get("/v1/models")

    assert response.status_code == 200
    body = response.json()
    assert body["object"] == "list"
    assert body["allowlist_active"] is False
    entries = {entry["id"]: entry for entry in body["data"]}
    assert set(entries) == {EMBED_MODEL, RERANK_MODEL}

    embed = entries[EMBED_MODEL]
    assert embed["revision"] == "abc1234"
    assert embed["quantization"] == "int8"
    assert embed["dimension"] == FAKE_DIMENSION
    assert embed["task"] == "embedding"
    assert embed["state"] == "ready"
    assert embed["verified"] is True
    assert embed["device"] == "cpu"
    # Every file the process verified, with the digest it verified it against.
    digests = {file["name"]: file["sha256"] for file in embed["files"]}
    assert set(digests) == {"model.onnx", "tokenizer.json"}
    assert all(len(digest) == 64 for digest in digests.values())


def test_effective_max_length_reflects_the_deployment_ceiling(client: TestClient) -> None:
    """The manifest says 64; the deployment's ceiling of 32 wins."""
    entries = {entry["id"]: entry for entry in client.get("/v1/models").json()["data"]}

    assert entries[EMBED_MODEL]["max_sequence_length"] == 64
    assert entries[EMBED_MODEL]["effective_max_length"] == 32


def test_a_single_model_resolves_through_its_alias(client: TestClient) -> None:
    response = client.get("/v1/models/fake-embed-int8")

    assert response.status_code == 200
    body = response.json()
    # The alias resolves to the canonical entry, so the id differs from the path.
    assert body["id"] == EMBED_MODEL
    assert "fake-embed-int8" in body["aliases"]


def test_a_slashed_model_id_resolves(client: TestClient) -> None:
    """Canonical ids are HuggingFace-style and contain a slash."""
    response = client.get(f"/v1/models/{EMBED_MODEL}")

    assert response.status_code == 200
    assert response.json()["id"] == EMBED_MODEL


def test_unknown_model_is_a_typed_404(client: TestClient) -> None:
    response = client.get("/v1/models/nope/not-a-model")

    assert response.status_code == 404
    assert response.json()["code"] == "model_not_found"


def test_listing_is_also_mounted_at_the_root(client: TestClient) -> None:
    assert client.get("/models").status_code == 200


def test_allowlist_narrows_the_listing(settings: Settings) -> None:
    """An allowlist is reported so "not permitted" is distinguishable from "absent"."""
    narrowed = settings.model_copy(
        update={"model_allowlist": (EMBED_MODEL,), "preload_models": (EMBED_MODEL,)}
    )
    app = create_app(
        narrowed,
        session_factory=make_session_factory(),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as client_two:
        body = client_two.get("/v1/models").json()
        assert body["allowlist_active"] is True
        assert [entry["id"] for entry in body["data"]] == [EMBED_MODEL]

        refused = client_two.get(f"/v1/models/{RERANK_MODEL}")
        assert refused.status_code == 400
        assert refused.json()["code"] == "model_not_allowed"
