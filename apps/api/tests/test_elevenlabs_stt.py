"""ElevenLabs Scribe adapter — request shape and failure behaviour.

Tested with a stub HTTP client: the point is that the multipart body, the
model id and the ISO-639-3 language code are what Scribe expects, and that a
vendor error surfaces as an exception the caller can turn into "didn't catch
that" rather than a silent empty transcript.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.ws.voice import ElevenLabsStt, build_stt


class _Response:
    def __init__(self, status: int, payload: dict[str, Any] | None = None, text: str = "") -> None:
        self.status_code = status
        self._payload = payload or {}
        self.text = text

    def json(self) -> dict[str, Any]:
        return self._payload


class _Client:
    def __init__(self, response: _Response) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def post(self, path: str, *, files: Any, data: Any) -> _Response:
        self.calls.append({"path": path, "files": files, "data": data})
        return self.response


async def _frames(*chunks: bytes) -> AsyncIterator[bytes]:
    for c in chunks:
        yield c


async def _collect(it: AsyncIterator[Any]) -> list[Any]:
    return [x async for x in it]


@pytest.mark.asyncio
async def test_sends_one_multipart_request_with_scribe_fields() -> None:
    client = _Client(_Response(200, {"text": " 您好，我已經有保險了 "}))
    stt = ElevenLabsStt(client=client)

    chunks = await _collect(
        stt.stream(_frames(b"ab", b"cd"), language="zh-TW", mime_type="audio/webm;codecs=opus")
    )

    assert [c.text for c in chunks] == ["您好，我已經有保險了"]
    assert chunks[0].is_final is True
    call = client.calls[0]
    assert call["path"] == "/speech-to-text"
    assert call["data"] == {"model_id": "scribe_v1", "language_code": "zho"}
    name, body, mime = call["files"]["file"]
    assert name == "utterance.webm" and body == b"abcd" and mime.startswith("audio/webm")


@pytest.mark.asyncio
async def test_unknown_locale_lets_scribe_auto_detect() -> None:
    client = _Client(_Response(200, {"text": "hola"}))
    await _collect(ElevenLabsStt(client=client).stream(_frames(b"x"), language="es-ES"))
    assert "language_code" not in client.calls[0]["data"]


@pytest.mark.asyncio
async def test_mp4_from_safari_keeps_its_extension() -> None:
    client = _Client(_Response(200, {"text": "ok"}))
    await _collect(ElevenLabsStt(client=client).stream(_frames(b"x"), mime_type="audio/mp4"))
    assert client.calls[0]["files"]["file"][0] == "utterance.mp4"


@pytest.mark.asyncio
async def test_empty_audio_makes_no_request() -> None:
    client = _Client(_Response(200, {"text": "should not be used"}))
    assert await _collect(ElevenLabsStt(client=client).stream(_frames())) == []
    assert client.calls == []


@pytest.mark.asyncio
async def test_vendor_error_raises_instead_of_returning_silence() -> None:
    client = _Client(_Response(401, text='{"detail":"unauthorized"}'))
    with pytest.raises(RuntimeError, match="stt 401"):
        await _collect(ElevenLabsStt(client=client).stream(_frames(b"x")))


def test_build_stt_without_a_key_is_the_null_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import config

    class _S:
        stt_provider = "elevenlabs"
        elevenlabs_api_key = None
        openai_api_key = None

    monkeypatch.setattr(config, "get_settings", lambda: _S())
    assert build_stt().provider == "none"


def test_zh_tw_transcripts_are_converted_to_traditional() -> None:
    from app.ws.voice import _to_traditional

    converted = _to_traditional("我已经有保险了，为什么还要多买？", "zh-TW")
    assert converted == "我已經有保險了，為什麼還要多買？"
    # zh-CN sessions keep what the vendor returned; other languages untouched.
    assert _to_traditional("我已经有保险了", "zh-CN") == "我已经有保险了"
    assert _to_traditional("hello", "en-US") == "hello"
