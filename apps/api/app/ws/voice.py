"""Voice session boundary — STT in, TTS out, server-side only (§22, §71).

    Browser -> Voice Session Service -> ElevenLabs / OpenAI -> streaming audio
    (spec §71: 避免長期憑證暴露在 browser)

The browser never holds a provider credential and never talks to a TTS/STT vendor.
It sends microphone frames over the session socket and receives synthesised audio
frames back; every provider call happens here.

§22.3 turn-taking is the interesting part:

* `barge_in()` cancels the in-flight TTS task **and** the persona generation task, so
  the trainee interrupting mid-sentence stops the customer talking immediately —
  `AI speaking -> detect voice -> stop TTS -> Listening -> transcribe -> continue`.
* `turn_timeout` closes a turn the trainee never finishes, so a dropped mic does not
  hang the session.
* Partial and final transcripts are emitted as `speech.partial` / `speech.final`, and
  a failed STT segment is retried once before the turn is abandoned.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.ws.events import EventEmitter, now_ms
from app.ws.voice_catalog import resolve_voice_id

log = structlog.get_logger(__name__)

#: §49.2 voice latency budget — exceeded segments are logged for the SLO dashboard.
STT_LATENCY_BUDGET_MS = 800
TTS_FIRST_BYTE_BUDGET_MS = 600
DEFAULT_TURN_TIMEOUT_S = 30.0
DEFAULT_SILENCE_TIMEOUT_S = 2.0


class VoiceState(StrEnum):
    IDLE = "idle"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    THINKING = "processing"
    SPEAKING = "persona_speaking"


class TranscriptChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = ""
    is_final: bool = False
    confidence: float = 1.0
    at_ms: int = Field(default_factory=now_ms)


class AudioChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: bytes = b""
    mime_type: str = "audio/mpeg"
    is_final: bool = False


class VoiceConfig(BaseModel):
    """§22.4 Voice Settings."""

    model_config = ConfigDict(extra="forbid")

    provider: str = "openai"                # openai | elevenlabs | none
    voice_id: str | None = None
    language: str = "zh-TW"
    speed: float = 1.0
    stability: float | None = None
    similarity: float | None = None
    emotion_style: str | None = None
    #: Explicit ElevenLabs `style` (0-1). Overrides the coarse emotion_style
    #: mapping. Higher = more expressive = more pitch drift; the rising-intonation
    #: complaint on Chinese from English-trained voices is mostly this plus low
    #: stability.
    style: float | None = None
    speaker_boost: bool = True
    #: Per-request model override (e.g. multilingual_v2 for quality).
    model_id: str | None = None
    interruptible: bool = True
    silence_timeout_s: float = DEFAULT_SILENCE_TIMEOUT_S
    turn_timeout_s: float = DEFAULT_TURN_TIMEOUT_S
    caption_language: str | None = None


@runtime_checkable
class SttPort(Protocol):
    """Streaming speech-to-text. Implementations run server-side only."""

    provider: str

    def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str = "zh-TW",
        mime_type: str = "audio/webm",
    ) -> AsyncIterator[TranscriptChunk]: ...


@runtime_checkable
class TtsPort(Protocol):
    """Streaming text-to-speech."""

    provider: str

    def stream(
        self, text: str, *, config: VoiceConfig
    ) -> AsyncIterator[AudioChunk]: ...


# ---------------------------------------------------------------------------
# providers
# ---------------------------------------------------------------------------
class OpenAiStt:
    """OpenAI transcription. Key from settings only (§70)."""

    provider = "openai"

    def __init__(self, *, model: str = "gpt-4o-transcribe", client: Any | None = None) -> None:
        self.model = model
        self._client = client

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            from app.core.config import get_settings  # assumed

            settings = get_settings()
            key = getattr(settings, "openai_api_key", "")
            getter = getattr(key, "get_secret_value", None)
            self._client = httpx.AsyncClient(
                base_url=getattr(settings, "openai_base_url", "https://api.openai.com/v1"),
                headers={
                    "Authorization": f"Bearer {str(getter()) if callable(getter) else key}"
                },
                timeout=60.0,
            )
        return self._client

    async def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str = "zh-TW",
        mime_type: str = "audio/webm",
    ) -> AsyncIterator[TranscriptChunk]:
        """Buffer the utterance, then transcribe it in one call.

        The REST transcription endpoint is not incremental, so "streaming" here means
        one final chunk per utterance. A realtime websocket implementation can be
        dropped in behind the same port without touching `VoiceSession`.
        """
        buffer = bytearray()
        async for frame in audio:
            buffer.extend(frame)
        if not buffer:
            return
        files = {
            "file": ("audio.webm", bytes(buffer), mime_type),
            "model": (None, self.model),
            "language": (None, language.split("-")[0]),
        }
        try:
            response = await self._http().post("/audio/transcriptions", files=files)
            if response.status_code >= 400:
                raise RuntimeError(f"stt {response.status_code}: {response.text[:160]}")
            payload = response.json()
        except Exception as exc:
            log.warning("voice.stt_failed", provider=self.provider, error=repr(exc))
            raise
        yield TranscriptChunk(text=str(payload.get("text") or ""), is_final=True)


#: Scribe wants ISO 639-3. Anything unmapped is omitted so the model auto-detects
#: rather than being told a wrong language.
_SCRIBE_LANGUAGE: dict[str, str] = {"zh": "zho", "en": "eng", "ja": "jpn", "ko": "kor"}


def _to_traditional(text: str, language: str) -> str:
    """Scribe transcribes zh-TW speech into Simplified characters. In a Taiwanese
    product that is wrong on the transcript, in the evaluator's evidence quotes
    and in every citation. s2twp also maps mainland phrasing (软件 -> 軟體)."""
    if not text or not language.lower().startswith("zh") or language.lower().endswith("cn"):
        return text
    try:
        from opencc import OpenCC

        return OpenCC("s2twp").convert(text)
    except Exception as exc:
        log.info("voice.stt_convert_skipped", error=repr(exc))
        return text


class ElevenLabsStt:
    """ElevenLabs Scribe transcription (§22). Credentials stay server-side.

    Buffer-then-transcribe, like `OpenAiStt`: the REST endpoint is not
    incremental, so one utterance yields one final chunk. Verified against the
    live API with zh-TW audio produced by our own TTS.
    """

    provider = "elevenlabs"

    def __init__(self, *, model_id: str = "scribe_v1", client: Any | None = None) -> None:
        self.model_id = model_id
        self._client = client

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            from app.core.config import get_settings

            settings = get_settings()
            key = getattr(settings, "elevenlabs_api_key", "")
            getter = getattr(key, "get_secret_value", None)
            self._client = httpx.AsyncClient(
                base_url=getattr(settings, "elevenlabs_base_url", "https://api.elevenlabs.io/v1"),
                headers={"xi-api-key": str(getter()) if callable(getter) else str(key)},
                timeout=60.0,
            )
        return self._client

    async def stream(
        self, audio: AsyncIterator[bytes], *, language: str = "zh-TW", mime_type: str = "audio/webm"
    ) -> AsyncIterator[TranscriptChunk]:
        buffer = bytearray()
        async for frame in audio:
            buffer.extend(frame)
        if not buffer:
            return
        data: dict[str, str] = {"model_id": self.model_id}
        code = _SCRIBE_LANGUAGE.get(language.split("-")[0].lower())
        if code:
            data["language_code"] = code
        ext = "mp4" if "mp4" in mime_type else "mp3" if "mpeg" in mime_type else "webm"
        try:
            response = await self._http().post(
                "/speech-to-text",
                files={"file": (f"utterance.{ext}", bytes(buffer), mime_type)},
                data=data,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"stt {response.status_code}: {response.text[:160]}")
            payload = response.json()
        except Exception as exc:
            log.warning("voice.stt_failed", provider=self.provider, error=repr(exc))
            raise
        text = _to_traditional(str(payload.get("text") or "").strip(), language)
        yield TranscriptChunk(text=text, is_final=True)


class MacSpeechStt:
    """macOS-native recognition via the `tools/mac-stt` helper (Speech.framework).

    Runs entirely on this machine when `on_device` is set — no key, no network,
    no vendor. The browser records Opus-in-WebM, which AVFoundation cannot read,
    so anything that is not already wav/m4a/mp3/aiff is transcoded with ffmpeg
    first. Every failure raises; `FallbackStt` decides what happens next.
    """

    provider = "mac"

    def __init__(
        self,
        *,
        binary: str | None = None,
        on_device: bool = True,
        runner: Any | None = None,
        timeout_s: float = 70.0,
        port: int | None = None,
    ) -> None:
        self.binary = binary or _default_mac_stt_bin()
        self.port = _default_mac_stt_port() if port is None else port
        self.on_device = on_device
        self._runner = runner  # test seam: async (argv) -> (returncode, stdout, stderr)
        self.timeout_s = timeout_s

    def available(self) -> bool:
        import os
        from pathlib import Path

        return bool(self.binary) and Path(self.binary).is_file() and os.access(self.binary, os.X_OK)

    async def probe(self, language: str = "zh-TW") -> dict[str, Any]:
        daemon = await self.daemon_probe(language)
        if daemon is not None:
            daemon["daemon"] = True
            return daemon
        if not self.available():
            return {"available": False, "reason": "helper not built"}
        code, out, _ = await self._run([self.binary, "--probe", "--locale", language])
        try:
            return json.loads(out) if code == 0 else {"available": False, "reason": out[:200]}
        except json.JSONDecodeError:
            return {"available": False, "reason": "bad probe output"}


    async def _run(self, argv: list[str]) -> tuple[int, str, str]:
        if self._runner is not None:
            return await self._runner(argv)
        proc = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=self.timeout_s)
        except TimeoutError:
            proc.kill()
            raise RuntimeError("mac-stt timed out") from None
        return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")

    async def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str = "zh-TW",
        mime_type: str = "audio/webm",
    ) -> AsyncIterator[TranscriptChunk]:
        import shutil
        import tempfile
        from pathlib import Path

        buffer = bytearray()
        async for frame in audio:
            buffer.extend(frame)
        if not buffer:
            return
        if not self.available():
            raise RuntimeError("mac-stt helper not built (run tools/mac-stt/build.sh)")

        if "mp4" in mime_type:
            ext = "mp4"
        elif "mpeg" in mime_type:
            ext = "mp3"
        elif "wav" in mime_type:
            ext = "wav"
        else:
            ext = "webm"
        with tempfile.TemporaryDirectory(prefix="aicoach-stt-") as tmp:
            src = Path(tmp) / f"utterance.{ext}"
            src.write_bytes(bytes(buffer))
            target = src
            if ext in ("webm", "ogg"):
                ffmpeg = shutil.which("ffmpeg")
                if not ffmpeg:
                    raise RuntimeError("ffmpeg required to decode WebM/Opus for mac-stt")
                target = Path(tmp) / "utterance.wav"
                code, _, err = await self._run(
                    [ffmpeg, "-loglevel", "error", "-y", "-i", str(src),
                     "-ar", "16000", "-ac", "1", str(target)]
                )
                if code != 0:
                    raise RuntimeError(f"ffmpeg failed: {err[:160]}")
            payload = await self._via_daemon(str(target), language)
            if payload is None:
                argv = [self.binary, "--file", str(target), "--locale", language,
                        "--on-device" if self.on_device else "--allow-server"]
                code, out, err = await self._run(argv)
                try:
                    payload = json.loads(out) if out.strip() else {}
                except json.JSONDecodeError:
                    payload = {}
                if code != 0 and "error" not in payload:
                    payload["error"] = err[:160] or f"exit {code}"
        if "error" in payload:
            raise RuntimeError(f"mac-stt: {payload['error']}")
        yield TranscriptChunk(text=str(payload.get("text") or "").strip(), is_final=True)

    async def _via_daemon(self, path: str, language: str) -> dict[str, Any] | None:
        """One request to the resident helper. None when it is not running —
        the caller then falls back to a one-shot process, which will itself be
        refused by TCC when spawned from the API, so the daemon is the path that
        actually works in production; the fallback exists for dev shells."""
        port = self.port
        if not port:
            return None
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port), timeout=1.0
            )
        except (OSError, TimeoutError):
            return None
        try:
            req = {"id": 1, "file": path, "locale": language, "onDevice": self.on_device}
            writer.write((json.dumps(req) + "\n").encode("utf-8"))
            await writer.drain()
            line = await asyncio.wait_for(reader.readline(), timeout=self.timeout_s)
        finally:
            writer.close()
        try:
            return json.loads(line.decode("utf-8")) if line else {"error": "daemon closed"}
        except json.JSONDecodeError:
            return {"error": "bad daemon reply"}

    async def daemon_probe(self, language: str = "zh-TW") -> dict[str, Any] | None:
        """Capability report from the running daemon, or None when it is down."""
        if not self.port:
            return None
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", self.port), timeout=1.0
            )
        except (OSError, TimeoutError):
            return None
        try:
            writer.write((json.dumps({"id": 0, "probe": True, "locale": language}) + "\n").encode())
            await writer.drain()
            line = await asyncio.wait_for(reader.readline(), timeout=10.0)
        finally:
            writer.close()
        try:
            return json.loads(line.decode("utf-8")) if line else None
        except json.JSONDecodeError:
            return None


class FallbackStt:
    """Try one recogniser, fall through to the next on failure.

    Ordering is a product decision, not a technical one: `mac` first keeps the
    audio on the machine whenever the machine can do it, and only sends to the
    cloud when it cannot. The provider name reports which one actually answered.
    """

    def __init__(self, *adapters: Any) -> None:
        self.adapters = [a for a in adapters if a is not None]
        self.provider = "none"

    async def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str = "zh-TW",
        mime_type: str = "audio/webm",
    ) -> AsyncIterator[TranscriptChunk]:
        frames = [f async for f in audio]
        last: Exception | None = None
        for adapter in self.adapters:
            try:
                stream = adapter.stream(
                    _replay_frames(frames), language=language, mime_type=mime_type
                )
                async for chunk in stream:
                    self.provider = adapter.provider
                    yield chunk
                return
            except Exception as exc:
                last = exc
                log.info("voice.stt_fallback", from_provider=adapter.provider, error=repr(exc))
        if last is not None:
            raise last


def _default_tts_model() -> str:
    try:
        from app.core.config import get_settings

        return str(getattr(get_settings(), "elevenlabs_tts_model", "") or "eleven_flash_v2_5")
    except Exception:
        return "eleven_flash_v2_5"


def _default_mac_stt_port() -> int:
    try:
        from app.core.config import get_settings

        return int(getattr(get_settings(), "mac_stt_port", 8790) or 0)
    except Exception:
        return 8790


def _default_mac_stt_bin() -> str:
    from pathlib import Path

    try:
        from app.core.config import get_settings

        configured = str(getattr(get_settings(), "mac_stt_bin", "") or "")
    except Exception:
        configured = ""
    if not configured:
        return ""
    path = Path(configured)
    if not path.is_absolute():
        # apps/api/app/ws/voice.py -> repo root is four levels up.
        path = Path(__file__).resolve().parents[4] / path
    return str(path)


class OpenAiTts:
    provider = "openai"

    def __init__(self, *, model: str = "gpt-4o-mini-tts", client: Any | None = None) -> None:
        self.model = model
        self._client = client

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            from app.core.config import get_settings  # assumed

            settings = get_settings()
            key = getattr(settings, "openai_api_key", "")
            getter = getattr(key, "get_secret_value", None)
            self._client = httpx.AsyncClient(
                base_url=getattr(settings, "openai_base_url", "https://api.openai.com/v1"),
                headers={
                    "Authorization": f"Bearer {str(getter()) if callable(getter) else key}"
                },
                timeout=60.0,
            )
        return self._client

    async def stream(self, text: str, *, config: VoiceConfig) -> AsyncIterator[AudioChunk]:
        body = {
            "model": self.model,
            "input": text,
            "voice": config.voice_id or "alloy",
            "speed": config.speed,
            "response_format": "mp3",
        }
        async with self._http().stream("POST", "/audio/speech", json=body) as response:
            if response.status_code >= 400:
                raise RuntimeError(f"tts {response.status_code}")
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield AudioChunk(data=chunk, mime_type="audio/mpeg")
        yield AudioChunk(data=b"", mime_type="audio/mpeg", is_final=True)


class ElevenLabsTts:
    """ElevenLabs streaming TTS (§71). Credentials stay server-side."""

    provider = "elevenlabs"

    def __init__(
        self,
        *,
        model_id: str | None = None,
        client: Any | None = None,
    ) -> None:
        self.model_id = model_id or _default_tts_model()
        self._client = client

    def _http(self) -> Any:
        if self._client is None:
            import httpx

            from app.core.config import get_settings  # assumed

            settings = get_settings()
            key = getattr(settings, "elevenlabs_api_key", "")
            getter = getattr(key, "get_secret_value", None)
            self._client = httpx.AsyncClient(
                base_url=getattr(
                    settings, "elevenlabs_base_url", "https://api.elevenlabs.io/v1"
                ),
                headers={"xi-api-key": str(getter()) if callable(getter) else str(key)},
                timeout=60.0,
            )
        return self._client

    async def stream(self, text: str, *, config: VoiceConfig) -> AsyncIterator[AudioChunk]:
        voice_id = config.voice_id or "21m00Tcm4TlvDq8ikWAM"
        # Defaults chosen against the drift complaint: high stability, no style.
        # 0.5 / emotion_style->0.4 made every Chinese sentence end on a question.
        style = (
            config.style
            if config.style is not None
            else (0.0 if not config.emotion_style else 0.15)
        )
        body: dict[str, Any] = {
            "text": text,
            "model_id": config.model_id or self.model_id,
            "voice_settings": {
                "stability": config.stability if config.stability is not None else 0.75,
                "similarity_boost": (
                    config.similarity if config.similarity is not None else 0.75
                ),
                "style": max(0.0, min(1.0, style)),
                "use_speaker_boost": config.speaker_boost,
                "speed": max(0.7, min(1.2, config.speed)),
            },
        }
        async with self._http().stream(
            "POST", f"/text-to-speech/{voice_id}/stream", json=body
        ) as response:
            if response.status_code >= 400:
                raise RuntimeError(f"elevenlabs {response.status_code}")
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield AudioChunk(data=chunk, mime_type="audio/mpeg")
        yield AudioChunk(data=b"", mime_type="audio/mpeg", is_final=True)


class NullStt:
    """No STT configured: voice degrades to text (§51 — core features never stop)."""

    provider = "none"

    async def stream(
        self, audio: AsyncIterator[bytes], *, language: str = "zh-TW", mime_type: str = "audio/webm"
    ) -> AsyncIterator[TranscriptChunk]:
        async for _frame in audio:
            pass
        return
        yield TranscriptChunk()  # pragma: no cover - makes this an async generator


class NullTts:
    provider = "none"

    async def stream(self, text: str, *, config: VoiceConfig) -> AsyncIterator[AudioChunk]:
        return
        yield AudioChunk()  # pragma: no cover


# ---------------------------------------------------------------------------
# the session
# ---------------------------------------------------------------------------
TurnHandler = Callable[[str], Awaitable[Any]]
AudioSink = Callable[[AudioChunk], Awaitable[None]]


class VoiceSession:
    """One voice-enabled simulation session (§22).

    `VoiceSessionService` in the router layer keeps one of these per session id; the
    gateway forwards push-to-talk and microphone frames to it.
    """

    def __init__(
        self,
        *,
        session_id: str,
        emitter: EventEmitter,
        config: VoiceConfig,
        stt: SttPort | None = None,
        tts: TtsPort | None = None,
        on_turn: TurnHandler | None = None,
        audio_sink: AudioSink | None = None,
    ) -> None:
        self.session_id = session_id
        self.emitter = emitter
        self.config = config
        self.stt: SttPort = stt or NullStt()
        self.tts: TtsPort = tts or NullTts()
        self.on_turn = on_turn
        self.audio_sink = audio_sink
        self.state = VoiceState.IDLE
        self._frames: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._listen_task: asyncio.Task[None] | None = None
        self._speak_task: asyncio.Task[None] | None = None
        self._turn_task: asyncio.Task[Any] | None = None
        self._closed = False

    # -- inbound (STT) -----------------------------------------------------
    async def start_listening(self, _session_id: str | None = None) -> None:
        """Push-to-talk pressed, or VAD detected speech."""
        if self._closed:
            return
        if self.state is VoiceState.SPEAKING and self.config.interruptible:
            await self.barge_in()
        self._drain_frames()
        self.state = VoiceState.LISTENING
        await self.emitter.speech_started("trainee")
        self._listen_task = asyncio.create_task(self._transcribe_loop())

    async def push_audio(self, frame: bytes) -> None:
        if self.state is VoiceState.LISTENING and frame:
            await self._frames.put(frame)

    async def stop_listening(self, _session_id: str | None = None) -> None:
        """Push-to-talk released / silence detected: close the utterance."""
        if self.state is not VoiceState.LISTENING:
            return
        await self._frames.put(None)
        self.state = VoiceState.TRANSCRIBING
        if self._listen_task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await asyncio.wait_for(self._listen_task, timeout=self.config.turn_timeout_s)

    async def _transcribe_loop(self) -> None:
        started = now_ms()
        text = ""
        try:
            async for chunk in self._transcribe_with_retry():
                if not chunk.text:
                    continue
                if chunk.is_final:
                    text = chunk.text
                else:
                    await self.emitter.speech_partial("trainee", chunk.text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.emitter.session_error(
                "stt_failed", "we could not hear that clearly — please try again"
            )
            log.warning("voice.transcribe_failed", session=self.session_id, error=repr(exc))
            self.state = VoiceState.IDLE
            return

        latency = now_ms() - started
        if latency > STT_LATENCY_BUDGET_MS:
            log.info("voice.stt_slow", session=self.session_id, latency_ms=latency)
        if not text.strip():
            self.state = VoiceState.IDLE
            return
        self.state = VoiceState.THINKING
        if self.on_turn is not None:
            self._turn_task = asyncio.create_task(self._run_turn(text))

    async def _transcribe_with_retry(self) -> AsyncIterator[TranscriptChunk]:
        """One retry on a failed segment (§22.3 retry STT)."""
        frames = list(await self._collect_frames())
        for attempt in (1, 2):
            try:
                async for chunk in self.stt.stream(
                    _replay_frames(frames), language=self.config.language
                ):
                    yield chunk
                return
            except Exception as exc:
                if attempt == 2:
                    raise
                log.info("voice.stt_retry", session=self.session_id, error=repr(exc))
                await asyncio.sleep(0.2)

    async def _collect_frames(self) -> list[bytes]:
        frames: list[bytes] = []
        try:
            while True:
                frame = await asyncio.wait_for(
                    self._frames.get(), timeout=self.config.turn_timeout_s
                )
                if frame is None:
                    break
                frames.append(frame)
        except TimeoutError:
            log.info("voice.turn_timeout", session=self.session_id)
        return frames

    def _drain_frames(self) -> None:
        while not self._frames.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                self._frames.get_nowait()

    async def _run_turn(self, text: str) -> None:
        if self.on_turn is None:
            return
        try:
            await self.on_turn(text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("voice.turn_failed", session=self.session_id, error=repr(exc))
        finally:
            if self.state is VoiceState.THINKING:
                self.state = VoiceState.IDLE

    # -- outbound (TTS) ----------------------------------------------------
    async def speak(self, text: str) -> None:
        """Synthesise the persona's reply and stream it to the client."""
        if self._closed or not text.strip() or self.tts.provider == "none":
            return
        self.state = VoiceState.SPEAKING
        await self.emitter.speech_started("persona")
        self._speak_task = asyncio.create_task(self._speak_loop(text))
        with contextlib.suppress(asyncio.CancelledError):
            await self._speak_task

    async def _speak_loop(self, text: str) -> None:
        started = now_ms()
        first = True
        try:
            async for chunk in self.tts.stream(text, config=self.config):
                if first and chunk.data:
                    latency = now_ms() - started
                    if latency > TTS_FIRST_BYTE_BUDGET_MS:
                        log.info(
                            "voice.tts_slow", session=self.session_id, latency_ms=latency
                        )
                    first = False
                if self.audio_sink is not None:
                    await self.audio_sink(chunk)
        except asyncio.CancelledError:
            log.info("voice.tts_cancelled", session=self.session_id)
            raise
        except Exception as exc:
            log.warning("voice.tts_failed", session=self.session_id, error=repr(exc))
            await self.emitter.session_error(
                "tts_failed", "voice playback failed; captions remain available"
            )
        finally:
            if self.state is VoiceState.SPEAKING:
                self.state = VoiceState.IDLE

    async def barge_in(self) -> None:
        """§22.3: the trainee interrupted — stop TTS immediately, drop the audio tail."""
        cancelled = False
        for task in (self._speak_task, self._turn_task):
            if task is not None and not task.done():
                task.cancel()
                cancelled = True
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._speak_task = None
        self._turn_task = None
        self.state = VoiceState.LISTENING
        if cancelled:
            log.info("voice.barge_in", session=self.session_id)
            if self.audio_sink is not None:
                await self.audio_sink(AudioChunk(data=b"", is_final=True))

    async def aclose(self) -> None:
        self._closed = True
        await self.barge_in()
        if self._listen_task is not None and not self._listen_task.done():
            self._listen_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listen_task
        self.state = VoiceState.IDLE


async def _replay_frames(frames: Sequence[bytes]) -> AsyncIterator[bytes]:
    for frame in frames:
        yield frame



def build_stt(engine: str | None = None) -> SttPort:
    """The speech-to-text adapter for one request.

    `engine` is the client's per-utterance choice: `mac` (on-device, falls back
    to the cloud if the helper cannot answer), `cloud` (vendor only), or None /
    `auto` for the server's `STT_PROVIDER`. Separate from `build_voice_session`
    because HTTP transcription needs no emitter, no TTS and no session state.
    """
    try:
        from app.core.config import get_settings

        settings = get_settings()
        cloud: Any = None
        if getattr(settings, "elevenlabs_api_key", None):
            cloud = ElevenLabsStt()
        elif getattr(settings, "openai_api_key", None):
            cloud = OpenAiStt()

        want = (engine or str(getattr(settings, "stt_provider", "elevenlabs"))).lower()
        if want == "auto":
            want = str(getattr(settings, "stt_provider", "elevenlabs")).lower()

        if want == "mac":
            mac = MacSpeechStt()
            if mac.available():
                return FallbackStt(mac, cloud) if cloud is not None else mac
            log.info("voice.mac_stt_unavailable", binary=mac.binary)
            return cloud or NullStt()
        if want in ("cloud", "elevenlabs", "openai"):
            return cloud or NullStt()
    except Exception as exc:
        log.warning("voice.stt_setup_failed", error=repr(exc))
    return NullStt()


def build_voice_session(
    *,
    session_id: str,
    emitter: EventEmitter,
    persona_voice: dict[str, Any] | None = None,
    persona: dict[str, Any] | None = None,
    on_turn: TurnHandler | None = None,
    audio_sink: AudioSink | None = None,
) -> VoiceSession:
    """Pick providers from the persona's voice config + settings (§22.4, §44)."""
    voice = dict(persona_voice or {})
    config = VoiceConfig(
        # ElevenLabs is the configured provider (TTS_PROVIDER); a persona that
        # names its own wins, otherwise the gender/age table decides.
        provider=str(voice.get("provider") or "elevenlabs"),
        voice_id=voice.get("voice_id") or resolve_voice_id(persona),
        language=str(voice.get("language") or "zh-TW"),
        speed=float(voice.get("speed") or 1.0),
        stability=voice.get("stability"),
        emotion_style=voice.get("emotion_style"),
    )
    stt: SttPort = NullStt()
    tts: TtsPort = NullTts()
    try:
        from app.core.config import get_settings  # assumed

        settings = get_settings()
        stt = build_stt()
        if config.provider == "elevenlabs" and getattr(settings, "elevenlabs_api_key", None):
            tts = ElevenLabsTts()
        elif config.provider == "openai" and getattr(settings, "openai_api_key", None):
            tts = OpenAiTts()
    except Exception as exc:
        log.warning("voice.provider_setup_failed", error=repr(exc))
    return VoiceSession(
        session_id=session_id,
        emitter=emitter,
        config=config,
        stt=stt,
        tts=tts,
        on_turn=on_turn,
        audio_sink=audio_sink,
    )


__all__ = [
    "DEFAULT_TURN_TIMEOUT_S",
    "STT_LATENCY_BUDGET_MS",
    "TTS_FIRST_BYTE_BUDGET_MS",
    "AudioChunk",
    "ElevenLabsStt",
    "ElevenLabsTts",
    "NullStt",
    "NullTts",
    "OpenAiStt",
    "OpenAiTts",
    "SttPort",
    "TranscriptChunk",
    "TtsPort",
    "VoiceConfig",
    "VoiceSession",
    "VoiceState",
    "build_stt",
    "build_voice_session",
]
