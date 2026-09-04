"""No request content may reach the log stream (spec §49.5).

This service sees every sentence of every customer knowledge base. Logs are
retained longer, replicated wider and access-controlled more loosely than the
database is, so a single ``log.info("embed", texts=texts)`` would turn the log
aggregator into an unaudited copy of the corpus, outside the §74 tenant boundary
and outside the §72 AUP boundary.

The tests below check the guarantee end to end — text goes in over HTTP, and the
bytes the process wrote to stdout are searched for it — rather than only checking
the redaction helper in isolation. A leak would most likely come from a *new*
call site or a third-party library, which is exactly what a unit test of the
processor would miss.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

from app.core.logging import REDACTED, redact_processor
from app.main import create_app
from tests.fakes import fake_tokenizer_factory, make_session_factory

if TYPE_CHECKING:
    import pytest

    from app.core.config import Settings

#: Distinctive enough that a substring search cannot produce a false negative.
SECRET_TEXT = "Quisquilious-Marmoreal-Zephyr-8842"
SECRET_QUERY = "Borborygmic-Fuliginous-Quotidian-7731"


def test_no_request_text_reaches_stdout(
    settings: Settings,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """Embed and rerank distinctive strings, then search everything the process wrote."""
    app = create_app(
        settings,
        session_factory=make_session_factory(),
        tokenizer_factory=fake_tokenizer_factory,
    )
    with TestClient(app) as client:
        client.post("/v1/embed", json={"texts": [SECRET_TEXT]})
        client.post("/v1/embeddings", json={"input": SECRET_TEXT})
        client.post(
            "/v1/rerank",
            json={"query": SECRET_QUERY, "texts": [SECRET_TEXT, "another candidate"]},
        )
        # Rejections are a log path too, and a validation error is the one place
        # where a framework would happily echo the input it did not like.
        client.post("/v1/embed", json={"texts": [SECRET_TEXT] * 99})
        client.post("/v1/embed", json={"texts": SECRET_TEXT})

    captured = capfd.readouterr()
    stream = captured.out + captured.err
    assert SECRET_TEXT not in stream
    assert SECRET_QUERY not in stream
    # The log is not empty — otherwise this test would pass by writing nothing.
    assert "embed.completed" in stream or "request" in stream


def test_the_processor_redacts_content_keys_by_name() -> None:
    event = redact_processor(
        None,
        "info",
        {
            "event": "embed.completed",
            "texts": ["secret sentence"],
            "query": "secret query",
            "embedding": [0.1, 0.2],
            "model": "BAAI/bge-m3",
            "item_count": 2,
        },
    )

    assert event["texts"] == REDACTED
    assert event["query"] == REDACTED
    assert event["embedding"] == REDACTED
    # Identifiers and counts survive: the log has to stay useful.
    assert event["model"] == "BAAI/bge-m3"
    assert event["item_count"] == 2
    assert event["redacted"] == ["embedding", "query", "texts"]


def test_the_processor_does_not_repr_unknown_objects() -> None:
    """A pydantic request model's repr contains the very text we are protecting."""

    class Carrier:
        def __repr__(self) -> str:  # pragma: no cover - must never be called
            return f"Carrier({SECRET_TEXT})"

    event = redact_processor(None, "info", {"event": "x", "payload": Carrier()})

    assert SECRET_TEXT not in str(event)
    assert event["payload"] == "[Carrier]"
