"""Liveness always answers; readiness only when the models really are up."""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import settings_from_env
from app.main import create_app
from tests.conftest import EMBED_MODEL, RERANK_MODEL
from tests.fakes import fake_tokenizer_factory, make_session_factory

if TYPE_CHECKING:
    from pathlib import Path

    from app.core.config import Settings


def test_liveness_answers_from_process_state(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "inference"
    assert body["app_env"] == "local"


def test_readiness_is_green_once_warm(client: TestClient) -> None:
    response = client.get("/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["warmup"]["complete"] is True
    assert body["warmup"]["failures"] == {}
    assert body["manifest"]["ok"] is True
    assert body["runtime"]["device"] == "cpu"
    assert body["runtime"]["execution_providers"] == ["CPUExecutionProvider"]
    states = {model["id"]: model for model in body["models"]}
    assert states[EMBED_MODEL]["state"] == "ready"
    assert states[EMBED_MODEL]["warm"] is True
    assert states[RERANK_MODEL]["state"] == "ready"


def test_readiness_is_false_before_warmup_and_true_after(
    settings: Settings,
    gate: threading.Event,
) -> None:
    """Held-open warmup must report `warming` and 503, never a premature green."""
    app = create_app(
        settings,
        session_factory=make_session_factory(gate=gate),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as client:
        before = client.get("/readyz")
        assert before.status_code == 503
        body = before.json()
        assert body["status"] == "warming"
        assert body["warmup"]["started"] is True
        assert body["warmup"]["complete"] is False
        # Liveness stays green while models load: a slow load is not a reason to
        # restart the container.
        assert client.get("/healthz").status_code == 200

        gate.set()
        deadline = time.monotonic() + 10.0
        while not app.state.service.warmup.complete and time.monotonic() < deadline:
            time.sleep(0.01)

        after = client.get("/readyz")
        assert after.status_code == 200
        assert after.json()["status"] == "ready"


def test_readiness_is_degraded_when_the_manifest_is_missing(tmp_path: Path) -> None:
    """No manifest: up, answering, and honest about why it cannot serve."""
    settings = settings_from_env(model_dir=tmp_path, preload_models=())
    app = create_app(settings, tokenizer_factory=fake_tokenizer_factory)
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        response = client.get("/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] in {"warming", "degraded"}
    assert body["manifest"]["ok"] is False
    assert body["manifest"]["model_count"] == 0


def test_readiness_names_the_model_that_failed(settings: Settings) -> None:
    """A preload target missing from the manifest is visible, not merely absent."""
    broken = settings.model_copy(
        update={"preload_models": (EMBED_MODEL, "ghost/model")},
    )
    app = create_app(
        broken,
        session_factory=make_session_factory(),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 10.0
        while not app.state.service.warmup.complete and time.monotonic() < deadline:
            time.sleep(0.01)
        response = client.get("/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert "ghost/model" in body["warmup"]["failures"]
    ghost = next(model for model in body["models"] if model["id"] == "ghost/model")
    assert ghost["state"] == "missing"


def test_health_aliases_resolve(client: TestClient) -> None:
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 200


def test_metrics_are_exposed(client: TestClient) -> None:
    client.post("/v1/embed", json={"texts": ["measure me"]})
    response = client.get("/metrics")

    assert response.status_code == 200
    assert "inference_requests_total" in response.text
    # Token counts are metrics; tokens are not.
    assert "measure me" not in response.text


def test_probes_are_open_while_the_work_endpoints_are_not(settings: Settings) -> None:
    """A kubelet has no service credential; an embedding caller must have one."""
    secured = settings.model_copy(update={"shared_secret": SecretStr("s3cret-value")})
    app = create_app(
        secured,
        session_factory=make_session_factory(),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code in {200, 503}

        unauthenticated = client.post("/v1/embed", json={"texts": ["a"]})
        assert unauthenticated.status_code == 401
        assert unauthenticated.json()["code"] == "unauthenticated"
        # The presented credential is never echoed back.
        assert "s3cret-value" not in unauthenticated.text

        for headers in (
            {"Authorization": "Bearer s3cret-value"},
            {"X-Inference-Secret": "s3cret-value"},
        ):
            assert client.get("/v1/models", headers=headers).status_code == 200


def test_security_headers_are_present(client: TestClient) -> None:
    response = client.get("/healthz")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cache-Control"] == "no-store"
    assert "default-src 'none'" in response.headers["Content-Security-Policy"]


def test_request_id_round_trips(client: TestClient) -> None:
    response = client.get("/healthz", headers={"X-Request-ID": "trace-me-123"})

    assert response.headers["X-Request-ID"] == "trace-me-123"


def test_no_cors_headers_by_default(client: TestClient) -> None:
    """No browser talks to this service, so there is no preflight to answer."""
    response = client.get("/healthz", headers={"Origin": "https://example.test"})

    assert "access-control-allow-origin" not in {k.lower() for k in response.headers}
