"""Local TTS model server — Kokoro-82M-v1.1-zh, loopback only.

    GET  /healthz  → {status, model, voices, device, rtf_last}
    POST /speak    {text, voice?, speed?, gender?, format?} → audio/wav | audio/mpeg

The port opens immediately and the model loads in a background thread, so
launchd's KeepAlive sees a live process and the API's 1-second probe gets a
clean 503 ("loading") instead of a connection refused. Requests are serialised
inside the engine; a 60 s wall clock bounds each one.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import resource
import subprocess
import threading
import time
import wave
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

import structlog
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from app.config import Settings, get_settings
from app.engine import SAMPLE_RATE, KokoroZhEngine
from app.logs import configure_logging

MODEL_NAME = "hexgrad/Kokoro-82M-v1.1-zh"
log = structlog.get_logger("local_tts")


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)
    voice: str | None = Field(default=None, max_length=32)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    gender: Literal["male", "female"] | None = None
    format: Literal["wav", "mp3"] = "wav"


def wav_bytes(pcm: Any) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def mp3_bytes(wav: bytes, ffmpeg: str) -> bytes:
    """WAV → MP3 through ffmpeg on stdin/stdout. 64 kb/s mono is plenty for speech."""
    proc = subprocess.run(
        [ffmpeg, "-v", "error", "-f", "wav", "-i", "pipe:0", "-codec:a", "libmp3lame",
         "-b:a", "64k", "-f", "mp3", "pipe:1"],
        input=wav,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        err = proc.stderr.decode(errors="replace")[:200]
        raise RuntimeError(f"ffmpeg exit {proc.returncode}: {err}")
    return proc.stdout


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)


class ModelState:
    """Holds the engine once loaded, or the reason it is not."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine: KokoroZhEngine | None = None
        self.error: str | None = None
        self.loading = True
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts")
        self.last_request = time.monotonic()
        self._stop = threading.Event()

    def keep_warm(self) -> None:
        """Background thread: a tiny synthesis whenever the model has sat idle for
        `keep_warm_s`, submitted through the same single-worker executor so it
        never overlaps a real request."""
        interval = self.settings.keep_warm_s
        while interval > 0 and not self._stop.wait(interval / 3):
            engine = self.engine
            if engine is None or time.monotonic() - self.last_request < interval:
                continue
            try:
                self.executor.submit(
                    engine.synthesize, "好的。", voice=self.settings.default_female_voice
                ).result(timeout=30)
                self.last_request = time.monotonic()
            except Exception as exc:
                log.warning("tts.keep_warm_failed", error=repr(exc))

    def stop(self) -> None:
        self._stop.set()
        self.executor.shutdown(wait=False, cancel_futures=True)

    def load(self) -> None:
        t0 = time.perf_counter()
        try:
            d = self.settings.model_dir
            engine = KokoroZhEngine(
                model_path=d / self.settings.model_file,
                voices_path=d / self.settings.voices_file,
                config_path=d / self.settings.config_file,
                threads=self.settings.threads,
            )
            # Warm-up on a sentence-sized input before going "ok": the first run at
            # a new length pays for arena growth (measured 6.5 s vs 1.3 s), and
            # "你好" alone left that bill for the first real persona line.
            engine.synthesize(
                "您好，我想先了解一下這個方案每個月大概要多花多少錢？",
                voice=self.settings.default_female_voice,
            )
            self.engine = engine
            log.info(
                "tts.model_loaded",
                model=MODEL_NAME,
                voices=len(engine.voices),
                load_s=round(time.perf_counter() - t0, 2),
                rss_mb=round(peak_rss_mb()),
            )
        except Exception as exc:
            self.error = f"{type(exc).__name__}: {exc}"
            log.error("tts.model_load_failed", error=self.error)
        finally:
            self.loading = False

    def resolve_voice(self, req: SpeakRequest) -> str:
        assert self.engine is not None
        if req.voice:
            if not self.engine.has_voice(req.voice):
                raise HTTPException(status_code=400, detail=f"unknown voice {req.voice!r}")
            return req.voice
        s = self.settings
        return s.default_male_voice if req.gender == "male" else s.default_female_voice


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    configure_logging(json_output=cfg.log_json)
    state = ModelState(cfg)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.model = state
        threading.Thread(target=state.load, name="tts-load", daemon=True).start()
        threading.Thread(target=state.keep_warm, name="tts-keep-warm", daemon=True).start()
        log.info(
            "tts.started",
            host=cfg.host,
            port=cfg.port,
            model_dir=str(cfg.model_dir),
            keep_warm_s=cfg.keep_warm_s,
        )
        try:
            yield
        finally:
            state.stop()
            log.info("tts.stopped")

    app = FastAPI(
        title="AI Coach Local TTS",
        version="0.1.0",
        summary="Kokoro-82M-v1.1-zh on onnxruntime, loopback only",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/healthz")
    async def healthz() -> Response:
        body: dict[str, Any] = {
            "model": MODEL_NAME,
            "device": state.engine.device if state.engine else None,
            "voices": state.engine.voice_names() if state.engine else [],
            "defaults": {
                "female": cfg.default_female_voice,
                "male": cfg.default_male_voice,
            },
            "rtf_last": state.engine.rtf_last if state.engine else None,
            "rss_mb": round(peak_rss_mb()),
        }
        if state.engine is not None:
            body["status"] = "ok"
            return JSONResponse(body)
        body["status"] = "loading" if state.loading else "error"
        body["error"] = state.error
        return JSONResponse(body, status_code=503)

    @app.post("/speak")
    async def speak(req: SpeakRequest, request: Request) -> Response:
        if state.engine is None:
            raise HTTPException(
                status_code=503, detail="model loading" if state.loading else state.error
            )
        if len(req.text) > cfg.max_text_chars:
            raise HTTPException(status_code=413, detail="text too long")
        voice = state.resolve_voice(req)
        engine = state.engine
        loop = asyncio.get_running_loop()
        t0 = time.perf_counter()
        state.last_request = time.monotonic()
        try:
            pcm, stats = await asyncio.wait_for(
                loop.run_in_executor(
                    state.executor,
                    lambda: engine.synthesize(req.text, voice=voice, speed=req.speed),
                ),
                timeout=cfg.request_timeout_s,
            )
            wav = wav_bytes(pcm)
            if req.format == "mp3":
                data = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: mp3_bytes(wav, cfg.ffmpeg_bin)),
                    timeout=max(1.0, cfg.request_timeout_s - (time.perf_counter() - t0)),
                )
                media = "audio/mpeg"
            else:
                data, media = wav, "audio/wav"
        except TimeoutError as exc:
            log.warning("tts.timeout", chars=len(req.text), voice=voice)
            raise HTTPException(status_code=504, detail="synthesis timed out") from exc
        except HTTPException:
            raise
        except Exception as exc:
            log.error("tts.failed", chars=len(req.text), voice=voice, error=repr(exc))
            raise HTTPException(status_code=500, detail="synthesis failed") from exc
        total_ms = round((time.perf_counter() - t0) * 1000)
        state.last_request = time.monotonic()
        log.info(
            "tts.spoke", **stats.as_dict(), total_ms=total_ms, format=req.format, bytes=len(data)
        )
        return Response(
            content=data,
            media_type=media,
            headers={
                "Cache-Control": "no-store",
                "X-Voice": voice,
                "X-Audio-Seconds": f"{stats.audio_s:.3f}",
                "X-Rtf": f"{stats.rtf:.3f}",
                "X-Synth-Ms": f"{stats.synth_s * 1000:.0f}",
            },
        )

    return app


app = create_app()
