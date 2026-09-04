"""Fixtures: an on-disk model manifest made of tiny files, and an app over fakes.

No network, no weights, no heavy runtime. The manifest fixture writes a handful
of bytes per "model file" and records their real sha256, so the registry's
integrity check runs for real — it is one of the few places where using the
production code path in tests is both cheap and worth it.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings_from_env
from app.main import create_app
from tests.fakes import FAKE_DIMENSION, SessionSpy, fake_tokenizer_factory, make_session_factory

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path

EMBED_MODEL = "test/fake-embed"
RERANK_MODEL = "test/fake-rerank"


def _write_model(root: Path, name: str) -> dict[str, Any]:
    """Create a model directory with two tiny files and return their digests."""
    directory = root / name.replace("/", "__")
    directory.mkdir(parents=True, exist_ok=True)
    files: list[dict[str, Any]] = []
    for filename, payload in (
        ("model.onnx", f"graph::{name}".encode()),
        ("tokenizer.json", f"vocab::{name}".encode()),
    ):
        (directory / filename).write_bytes(payload)
        files.append(
            {
                "name": filename,
                "sha256": hashlib.sha256(payload).hexdigest(),
                "bytes": len(payload),
            }
        )
    return {"path": directory.name, "files": files}


@pytest.fixture
def model_root(tmp_path: Path) -> Path:
    """A model directory plus a valid ``manifest.json`` describing two models."""
    root = tmp_path / "models"
    root.mkdir()
    embed = _write_model(root, EMBED_MODEL)
    rerank = _write_model(root, RERANK_MODEL)
    manifest = {
        "schema_version": 1,
        "generated_by": "tests/conftest.py",
        "models": [
            {
                "id": EMBED_MODEL,
                "task": "embedding",
                "dimension": FAKE_DIMENSION,
                "max_sequence_length": 64,
                "pooling": "mean",
                "normalize": True,
                "query_prefix": "query: ",
                "passage_prefix": "passage: ",
                "revision": "abc1234",
                "quantization": "int8",
                "source": "local-fixture",
                "license": "apache-2.0",
                "aliases": ["fake-embed-int8"],
                **embed,
            },
            {
                "id": RERANK_MODEL,
                "task": "rerank",
                "max_sequence_length": 64,
                "score_activation": "sigmoid",
                "revision": "def5678",
                "aliases": ["fake-rerank-int8"],
                **rerank,
            },
        ],
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


@pytest.fixture
def settings(model_root: Path) -> Settings:
    """Settings pointed at the fixture manifest, with small, testable limits."""
    return settings_from_env(
        model_dir=model_root,
        preload_models=(EMBED_MODEL, RERANK_MODEL),
        default_embedding_model=EMBED_MODEL,
        default_rerank_model=RERANK_MODEL,
        max_batch_size=4,
        max_texts_per_request=6,
        max_input_chars=64,
        max_sequence_length=32,
        model_sweep_interval_s=3600.0,
        log_json=True,
    )


@pytest.fixture
def spy() -> SessionSpy:
    return SessionSpy()


@pytest.fixture
def client(settings: Settings, spy: SessionSpy) -> Iterator[TestClient]:
    """A warmed-up application over the fakes.

    ``TestClient`` as a context manager runs the lifespan, so the background
    warmup starts here; the fixture waits for it so tests that care about the
    happy path do not race it.
    """
    app = create_app(
        settings,
        session_factory=make_session_factory(spy=spy),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as test_client:
        # The warmup task runs on the client's own event loop, in its own thread.
        deadline = time.monotonic() + 10.0
        while not app.state.service.warmup.complete and time.monotonic() < deadline:
            time.sleep(0.01)
        yield test_client


@pytest.fixture
def gate() -> threading.Event:
    """A latch a test can hold closed to keep warmup running."""
    return threading.Event()
