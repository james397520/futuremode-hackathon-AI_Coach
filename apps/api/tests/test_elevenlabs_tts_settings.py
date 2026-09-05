"""ElevenLabs TTS request body: the anti-drift defaults and the slider overrides.

Chinese from English-trained voices ends every sentence on a rising note when
stability is low and style is on. The defaults here are the fix; the tests pin
them and the overrides that sit on top.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.ws.voice import ElevenLabsTts, VoiceConfig


class _Stream:
    status_code = 200

    async def __aenter__(self) -> _Stream:
        return self

    async def __aexit__(self, *_: Any) -> None:
        return None

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        yield b"mp3"


class _Client:
    def __init__(self) -> None:
        self.sent: dict[str, Any] = {}

    def stream(self, method: str, path: str, *, json: dict[str, Any]) -> _Stream:
        self.sent = {"method": method, "path": path, "json": json}
        return _Stream()


async def _drain(it: AsyncIterator[Any]) -> None:
    async for _ in it:
        pass


@pytest.mark.asyncio
async def test_defaults_are_stable_and_styleless() -> None:
    client = _Client()
    tts = ElevenLabsTts(client=client, model_id="m")
    await _drain(tts.stream("你好", config=VoiceConfig(voice_id="v")))
    vs = client.sent["json"]["voice_settings"]
    assert vs["stability"] == 0.75
    assert vs["style"] == 0.0
    assert vs["use_speaker_boost"] is True
    assert client.sent["path"] == "/text-to-speech/v/stream"


@pytest.mark.asyncio
async def test_emotion_style_is_only_a_hint_of_style() -> None:
    client = _Client()
    cfg = VoiceConfig(voice_id="v", emotion_style="reserved_analytical")
    await _drain(ElevenLabsTts(client=client, model_id="m").stream("你好", config=cfg))
    assert client.sent["json"]["voice_settings"]["style"] == 0.15


@pytest.mark.asyncio
async def test_sliders_override_and_are_clamped() -> None:
    client = _Client()
    cfg = VoiceConfig(
        voice_id="v", stability=0.9, similarity=0.6, style=0.3, speed=1.9, model_id="x"
    )
    await _drain(ElevenLabsTts(client=client, model_id="m").stream("你好", config=cfg))
    body = client.sent["json"]
    assert body["model_id"] == "x"
    assert body["voice_settings"]["stability"] == 0.9
    assert body["voice_settings"]["similarity_boost"] == 0.6
    assert body["voice_settings"]["style"] == 0.3
    assert body["voice_settings"]["speed"] == 1.2  # clamped to the vendor range
