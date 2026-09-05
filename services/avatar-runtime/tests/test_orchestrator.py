"""Session behaviour: barge-in (§15) and the §53 guarantee.

The §53 test is the one that matters most. "Avatar failure must never end a
training session" is only true if it is checked, so the fallback path is
exercised with the portrait deliberately made unreadable.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.core.config import Settings
from app.orchestrator import AvatarOrchestrator, RuntimeState

pytestmark = pytest.mark.asyncio


def settings_for(avatars_dir: Path) -> Settings:
    return Settings(avatars_dir=avatars_dir, require_consent=True, max_sessions=4)


def make(avatars_dir: Path, avatar_id: str = "synthetic_ok"):
    orch = AvatarOrchestrator(settings_for(avatars_dir))
    session = orch.create_session(
        avatar_id=avatar_id, width=192, height=256, fps=20, mode="state_bank"
    )
    return orch, session


async def test_a_session_renders_frames(avatars_dir):
    _, session = make(avatars_dir)
    payload, fmt, meta = session.render_frame()
    assert payload and fmt in {"jpeg", "webp", "png"}
    assert meta["state"] == str(RuntimeState.IDLE)


async def test_missing_portrait_still_renders(avatars_dir):
    """§53: no portrait file is a degrade, never an outage."""
    _, session = make(avatars_dir)          # fixture avatars have no portrait.png
    assert session.degraded_reason is not None
    payload, _, _ = session.render_frame()
    assert payload


async def test_unreadable_portrait_still_renders(avatars_dir):
    """A corrupt image must degrade, not raise."""
    (avatars_dir / "synthetic_ok" / "source" / "portrait.png").write_bytes(b"not a png")
    _, session = make(avatars_dir)
    assert session.degraded_reason and "unreadable" in session.degraded_reason
    assert session.render_frame()[0]


async def test_persona_state_drives_expression(avatars_dir):
    _, session = make(avatars_dir)
    out = await session.set_persona_state(
        {"resistance": 82, "trust": 28, "interest": 25}
    )
    assert out["expression"] == "frustrated"       # §13: resistance >= 68
    assert session.state is RuntimeState.LISTENING


async def test_barge_in_closes_the_mouth_and_returns_to_listening(avatars_dir):
    """§15. A figure that keeps mouthing words after the trainee cuts in is a bug."""
    _, session = make(avatars_dir)
    loud = (0.5 * np.sin(np.linspace(0, 80, 16_000))).astype(np.float32)
    await session.push_audio(loud)
    assert session.state is RuntimeState.SPEAKING
    for _ in range(4):
        session.render_frame()

    await session.interrupt()

    assert session.state is RuntimeState.LISTENING
    _, _, meta = session.render_frame()
    assert meta["mouth_open"] < 0.05, "mouth kept moving after barge-in"


async def test_interrupt_discards_pending_audio(avatars_dir):
    _, session = make(avatars_dir)
    await session.push_audio(np.full(16_000, 0.4, dtype=np.float32))
    await session.interrupt()
    assert session.snapshot()["audio_buffered_ms"] == 0.0


async def test_session_limit_is_enforced(avatars_dir):
    from app.core.errors import SessionLimitReachedError

    orch = AvatarOrchestrator(Settings(avatars_dir=avatars_dir, max_sessions=1))
    orch.create_session(avatar_id="synthetic_ok", width=64, height=64, fps=10, mode="state_bank")
    with pytest.raises(SessionLimitReachedError):
        orch.create_session(avatar_id="synthetic_ok", width=64, height=64, fps=10, mode="state_bank")


async def test_a_session_cannot_be_opened_without_consent(avatars_dir):
    from app.core.errors import AvatarConsentMissingError

    orch = AvatarOrchestrator(settings_for(avatars_dir))
    with pytest.raises(AvatarConsentMissingError):
        orch.create_session(avatar_id="real_no_owner", width=64, height=64, fps=10, mode="state_bank")


async def test_speaking_ends_once_the_audio_drains(avatars_dir):
    """Speech ends when the buffer is empty *and* its wall-clock duration has passed.

    Both halves matter. Buffer-empty alone would flip the figure back to
    listening in the gap between two TTS chunks, closing its mouth mid-sentence;
    the elapsed-time guard is what rides through that. The test therefore has to
    let real time pass rather than just spinning the render loop.
    """
    import asyncio

    _, session = make(avatars_dir)
    await session.push_audio(np.full(1600, 0.3, dtype=np.float32))   # 100ms at 16k
    assert session.state is RuntimeState.SPEAKING

    session.render_frame()
    session.render_frame()                       # 2 x 800 samples drains the buffer
    assert session.snapshot()["audio_buffered_ms"] == 0.0
    assert not session.maybe_end_speaking(), "ended before the audio had played out"

    await asyncio.sleep(0.12)                    # let the 100ms actually elapse
    assert session.maybe_end_speaking()
    assert session.state is RuntimeState.LISTENING
