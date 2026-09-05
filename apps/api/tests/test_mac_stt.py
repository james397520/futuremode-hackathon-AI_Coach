"""macOS-native STT adapter and the mac → cloud fallback chain.

The helper binary is exercised through a stubbed runner so the tests run on
any machine; what is pinned here is the contract around it — transcoding is
requested only for WebM/Opus, failures raise instead of returning silence, and
the fallback reports which provider actually answered.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from app.ws.voice import FallbackStt, MacSpeechStt, TranscriptChunk


async def _frames(*chunks: bytes) -> AsyncIterator[bytes]:
    for c in chunks:
        yield c


async def _collect(it: AsyncIterator[Any]) -> list[Any]:
    return [x async for x in it]


class _Runner:
    """Records argv; answers ffmpeg with success and mac-stt with `reply`."""

    def __init__(self, reply: dict[str, Any] | None = None, code: int = 0) -> None:
        self.reply = reply if reply is not None else {"text": "您好"}
        self.code = code
        self.calls: list[list[str]] = []

    async def __call__(self, argv: list[str]) -> tuple[int, str, str]:
        self.calls.append(argv)
        if argv[0].endswith("ffmpeg"):
            # Stand in for the transcode: a tiny file at the requested output path.
            # Off the event loop, as the lint rule (ASYNC240) rightly wants.
            await asyncio.to_thread(Path(argv[-1]).write_bytes, b"RIFF....WAVE")
            return 0, "", ""
        return self.code, json.dumps(self.reply), ""


def _mac(tmp_path: Path, runner: _Runner, **kw: Any) -> MacSpeechStt:
    binary = tmp_path / "mac-stt"
    binary.write_text("#!/bin/sh\n")
    binary.chmod(0o755)
    return MacSpeechStt(binary=str(binary), runner=runner, port=0, **kw)


@pytest.mark.asyncio
async def test_wav_goes_straight_to_the_helper(tmp_path: Path) -> None:
    runner = _Runner({"text": "我已經有保險了"})
    out = await _collect(_mac(tmp_path, runner).stream(_frames(b"x"), mime_type="audio/wav"))
    assert [c.text for c in out] == ["我已經有保險了"]
    assert len(runner.calls) == 1
    assert "--on-device" in runner.calls[0] and "--locale" in runner.calls[0]


@pytest.mark.asyncio
async def test_webm_is_transcoded_first(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "shutil.which", lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None
    )
    runner = _Runner()
    stream = _mac(tmp_path, runner).stream(_frames(b"x"), mime_type="audio/webm;codecs=opus")
    await _collect(stream)
    assert runner.calls[0][0] == "/usr/bin/ffmpeg"
    assert runner.calls[0][-1].endswith("utterance.wav")
    assert runner.calls[1][0].endswith("mac-stt")


@pytest.mark.asyncio
async def test_missing_ffmpeg_for_webm_raises(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("shutil.which", lambda name: None)
    with pytest.raises(RuntimeError, match="ffmpeg"):
        await _collect(_mac(tmp_path, _Runner()).stream(_frames(b"x"), mime_type="audio/webm"))


@pytest.mark.asyncio
async def test_helper_error_raises(tmp_path: Path) -> None:
    runner = _Runner({"error": "speech recognition not authorized: denied"}, code=4)
    with pytest.raises(RuntimeError, match="not authorized"):
        await _collect(_mac(tmp_path, runner).stream(_frames(b"x"), mime_type="audio/wav"))


@pytest.mark.asyncio
async def test_unbuilt_helper_is_reported_not_silent() -> None:
    stt = MacSpeechStt(binary="/nonexistent/mac-stt", port=0)
    assert stt.available() is False
    with pytest.raises(RuntimeError, match="not built"):
        await _collect(stt.stream(_frames(b"x"), mime_type="audio/wav"))


class _Fixed:
    def __init__(self, provider: str, text: str | None) -> None:
        self.provider = provider
        self.text = text

    async def stream(self, audio: AsyncIterator[bytes], **_: Any) -> AsyncIterator[TranscriptChunk]:
        _ = [f async for f in audio]
        if self.text is None:
            raise RuntimeError(f"{self.provider} failed")
        yield TranscriptChunk(text=self.text, is_final=True)


@pytest.mark.asyncio
async def test_fallback_uses_the_first_adapter_that_answers() -> None:
    chain = FallbackStt(_Fixed("mac", None), _Fixed("elevenlabs", "雲端結果"))
    out = await _collect(chain.stream(_frames(b"a", b"b")))
    assert [c.text for c in out] == ["雲端結果"]
    assert chain.provider == "elevenlabs"


@pytest.mark.asyncio
async def test_fallback_prefers_the_on_device_adapter_when_it_works() -> None:
    chain = FallbackStt(_Fixed("mac", "本機結果"), _Fixed("elevenlabs", "雲端結果"))
    out = await _collect(chain.stream(_frames(b"a")))
    assert [c.text for c in out] == ["本機結果"]
    assert chain.provider == "mac"


@pytest.mark.asyncio
async def test_fallback_raises_when_every_adapter_fails() -> None:
    chain = FallbackStt(_Fixed("mac", None), _Fixed("elevenlabs", None))
    with pytest.raises(RuntimeError, match="elevenlabs failed"):
        await _collect(chain.stream(_frames(b"a")))
