"""Local TTS adapter (services/local-tts over HTTP), its probe and the fallback chain.

The model server is stubbed: what is pinned is the request the API sends
(gender mapping, speed clamp, no ElevenLabs id leaking into `voice`), that the
mime type follows the codec that actually came back, that a closed port turns
into ElevenLabs instead of silence, and that the capability probe never raises.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.ws.voice import (
    AudioChunk,
    FallbackTts,
    LocalHttpTts,
    VoiceConfig,
    probe_local_tts,
)


class _Response:
    def __init__(self, status: int = 200, content: bytes = b"", ctype: str = "audio/mpeg",
                 json_body: Any = None) -> None:
        self.status_code = status
        self.content = content
        self.headers = {"content-type": ctype}
        self._json = json_body

    def json(self) -> Any:
        return self._json


class _Client:
    """Records the last POST; answers with a canned response or raises."""

    def __init__(self, response: _Response | None = None, error: Exception | None = None) -> None:
        self.response = response or _Response(content=b"ID3mp3")
        self.error = error
        self.posts: list[tuple[str, dict[str, Any]]] = []

    async def post(self, path: str, *, json: dict[str, Any]) -> _Response:
        self.posts.append((path, json))
        if self.error:
            raise self.error
        return self.response

    async def get(self, path: str) -> _Response:
        if self.error:
            raise self.error
        return self.response


class _Cloud:
    provider = "elevenlabs"

    def __init__(self) -> None:
        self.calls = 0

    async def stream(self, text: str, *, config: VoiceConfig) -> AsyncIterator[AudioChunk]:
        self.calls += 1
        yield AudioChunk(data=b"cloud", mime_type="audio/mpeg")
        yield AudioChunk(data=b"", mime_type="audio/mpeg", is_final=True)


async def _collect(it: AsyncIterator[AudioChunk]) -> list[AudioChunk]:
    return [c async for c in it]


@pytest.mark.asyncio
async def test_request_maps_gender_and_clamps_speed() -> None:
    client = _Client()
    tts = LocalHttpTts(client=client, base_url="http://127.0.0.1:1")
    cfg = VoiceConfig(voice_id="kGjJqO6wdwRN9iJsoeIC", gender="male", speed=1.9)
    chunks = await _collect(tts.stream("你好", config=cfg))

    path, body = client.posts[0]
    assert path == "/speak"
    assert body["gender"] == "male"
    assert body["speed"] == 1.2
    assert body["format"] == "mp3"
    # An ElevenLabs id means nothing to the model server and must not be sent.
    assert "voice" not in body
    assert chunks[0].data == b"ID3mp3"
    assert chunks[0].mime_type == "audio/mpeg"
    assert chunks[-1].is_final


@pytest.mark.asyncio
async def test_local_voice_name_is_forwarded_and_other_gender_dropped() -> None:
    client = _Client()
    tts = LocalHttpTts(client=client, audio_format="wav")
    cfg = VoiceConfig(voice_id="zm_010", gender="other")
    await _collect(tts.stream("你好", config=cfg))
    _, body = client.posts[0]
    assert body["voice"] == "zm_010"
    assert "gender" not in body
    assert body["format"] == "wav"


@pytest.mark.asyncio
async def test_mime_type_follows_the_server_not_the_request() -> None:
    client = _Client(_Response(content=b"RIFF....", ctype="audio/wav; charset=binary"))
    tts = LocalHttpTts(client=client)  # asked for mp3, got wav
    chunks = await _collect(tts.stream("你好", config=VoiceConfig()))
    assert chunks[0].mime_type == "audio/wav"


@pytest.mark.asyncio
async def test_http_error_raises_instead_of_yielding_garbage() -> None:
    client = _Client(_Response(status=503, content=b'{"detail":"model loading"}'))
    tts = LocalHttpTts(client=client)
    with pytest.raises(RuntimeError):
        await _collect(tts.stream("你好", config=VoiceConfig()))


@pytest.mark.asyncio
async def test_fallback_uses_cloud_when_the_model_server_is_down() -> None:
    local = LocalHttpTts(client=_Client(error=ConnectionError("refused")))
    cloud = _Cloud()
    chain = FallbackTts(local, cloud)
    chunks = await _collect(chain.stream("你好", config=VoiceConfig()))
    assert [c.data for c in chunks if c.data] == [b"cloud"]
    assert chain.provider == "elevenlabs"
    assert cloud.calls == 1


@pytest.mark.asyncio
async def test_fallback_prefers_local_when_it_answers() -> None:
    local = LocalHttpTts(client=_Client())
    cloud = _Cloud()
    chain = FallbackTts(local, cloud)
    chunks = await _collect(chain.stream("你好", config=VoiceConfig()))
    assert chunks[0].data == b"ID3mp3"
    assert chain.provider == "local"
    assert cloud.calls == 0


@pytest.mark.asyncio
async def test_fallback_raises_when_everything_fails() -> None:
    chain = FallbackTts(LocalHttpTts(client=_Client(error=ConnectionError("refused"))))
    with pytest.raises(ConnectionError):
        await _collect(chain.stream("你好", config=VoiceConfig()))


@pytest.mark.asyncio
async def test_probe_summarises_a_healthy_server() -> None:
    body = {"status": "ok", "model": "hexgrad/Kokoro-82M-v1.1-zh",
            "voices": ["zf_001", "zm_010"], "device": "cpu/onnxruntime", "rtf_last": 0.21}
    client = _Client(_Response(content=b"{}", ctype="application/json", json_body=body))
    probe = await probe_local_tts(client=client)
    assert probe["available"] is True
    assert probe["model"] == "hexgrad/Kokoro-82M-v1.1-zh"
    assert probe["voices"] == ["zf_001", "zm_010"]


@pytest.mark.asyncio
async def test_probe_reports_loading_as_unavailable() -> None:
    body = {"status": "loading", "model": "m", "voices": []}
    client = _Client(_Response(status=503, content=b"{}", ctype="application/json", json_body=body))
    probe = await probe_local_tts(client=client)
    assert probe == {"available": False, "reason": "loading"}


@pytest.mark.asyncio
async def test_probe_never_raises_on_a_closed_port() -> None:
    probe = await probe_local_tts(client=_Client(error=OSError("refused")))
    assert probe["available"] is False
    assert probe["reason"] == "OSError"
