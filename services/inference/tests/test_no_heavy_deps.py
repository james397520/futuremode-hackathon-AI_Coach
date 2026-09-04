"""The service must import and serve ``/healthz`` with no model runtime installed.

This is a real deployment property, not a tidiness rule. ``onnxruntime`` comes in
three mutually exclusive flavours (CPU, CUDA, ROCm) that all use the same import
name, and the ROCm one is not on PyPI at all. A build that picked the wrong
variant, or a CI job that installed none of them, must still produce a process
that starts, opens its port, answers liveness and reports the problem through
``/readyz`` — rather than dying at import with ``ModuleNotFoundError`` inside a
container nobody can shell into.

The property is bought by two seams: :class:`app.models.session.SessionPort`
imports ``onnxruntime`` inside the session constructor, and
:class:`app.preprocessing.tokenizer.HuggingFaceTokenizer` imports ``tokenizers``
inside its own. Nothing above them may import either at module scope, and this
test is what keeps it that way.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING, Final

from fastapi.testclient import TestClient

from app.core.config import settings_from_env
from app.main import create_app

if TYPE_CHECKING:
    from pathlib import Path

#: Never imported at module scope, anywhere in this service.
HEAVY_MODULES: Final[tuple[str, ...]] = (
    "onnxruntime",
    "tokenizers",
    "torch",
    "sentence_transformers",
    "transformers",
)


def test_importing_the_app_pulls_in_no_model_runtime() -> None:
    import app.main  # noqa: F401 - the import is the assertion

    leaked = [name for name in HEAVY_MODULES if name in sys.modules]
    assert leaked == [], f"module-scope import of a heavy dependency: {leaked}"


def test_healthz_answers_with_no_runtime_and_no_weights(tmp_path: Path) -> None:
    """Empty model directory, no manifest, no ONNX wheel: still alive."""
    settings = settings_from_env(model_dir=tmp_path, preload_models=())
    app = create_app(settings)

    with TestClient(app) as client:
        live = client.get("/healthz")
        ready = client.get("/readyz")

    assert live.status_code == 200
    assert live.json()["status"] == "ok"
    # Honest, not optimistic: nothing can be served, and it says so.
    assert ready.status_code == 503
    assert ready.json()["manifest"]["ok"] is False

    leaked = [name for name in HEAVY_MODULES if name in sys.modules]
    assert leaked == [], f"serving a request imported a heavy dependency: {leaked}"


def test_asgi_entry_point_exists() -> None:
    """``uvicorn app.main:app`` has to find a callable application."""
    from app.main import app as asgi_app

    assert callable(asgi_app)
    paths = set(asgi_app.openapi()["paths"])
    assert {"/healthz", "/readyz", "/v1/embeddings", "/v1/embed", "/v1/rerank", "/v1/models"} <= (
        paths
    )
