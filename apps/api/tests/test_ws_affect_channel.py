"""The webcam affect channel is a *transport* test, not a model test.

`trainee.affect` must be accepted by the gateway, clamped, and kept advisory —
the browser is untrusted, so a client can claim any label with any confidence.
No image data is accepted on this command and none is ever requested (§40.2/§73).
"""

from __future__ import annotations

import pytest

from app.ws.gateway import CLIENT_COMMANDS, _Connection


def _bare_connection() -> _Connection:
    """A connection object with only the state `_dispatch` touches."""
    conn = _Connection.__new__(_Connection)
    conn._pending_hint = None
    conn._trainee_affect = None
    return conn

def test_affect_is_a_known_client_command() -> None:
    assert "trainee.affect" in CLIENT_COMMANDS

@pytest.mark.asyncio
async def test_affect_is_stored_and_clamped() -> None:
    conn = _bare_connection()
    await conn._dispatch(
        {"type": "trainee.affect", "label": "happy", "confidence": 4.2, "at_ms": 1234}
    )
    assert conn._trainee_affect == {
        "label": "happy",
        "confidence": 1.0,
        "at_ms": 1234,
    }

@pytest.mark.asyncio
async def test_affect_without_a_label_is_ignored() -> None:
    conn = _bare_connection()
    await conn._dispatch({"type": "trainee.affect", "label": "", "confidence": 0.9})
    assert conn._trainee_affect is None

@pytest.mark.asyncio
async def test_affect_label_is_length_capped() -> None:
    conn = _bare_connection()
    await conn._dispatch(
        {"type": "trainee.affect", "label": "x" * 500, "confidence": 0.5, "at_ms": 1}
    )
    stored = conn._trainee_affect
    assert stored is not None
    assert len(stored["label"]) == 32
