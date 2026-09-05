"""Local TTS model server — Breeze2-VITS (default) or Kokoro-82M-v1.1-zh, loopback only.

    GET  /healthz  → {status, engine, model, voices, device, rtf_last, engines{…}}
    POST /speak    {text, engine?, voice?, speed?, gender?, format?} → audio/wav | audio/mpeg

The port opens immediately and the default engine loads in a background thread,
so launchd's KeepAlive sees a live process and the API's 1-second probe gets a
clean 503 ("loading") instead of a connection refused. The other engine is
loaded on first use — 545 MB (Kokoro) + 130 MB (Breeze) resident at once is a
lot on an 8 GB laptop that is already swapping. Requests are serialised inside
the engine; a 60 s wall clock bounds each one.
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

from app import engines
from app.config import Settings, get_settings
from app.engines import TtsEngine
from app.logs import configure_logging

log = structlog.get_logger("local_tts")

#: One warm-up sentence, sized like a real persona line. The first run at a new
#: length pays for arena growth (measured 6.5 s vs 1.3 s on Kokoro), and "你好"
#: alone left that bill for the first thing the customer says.
WARMUP_TEXT = "您好，我想先了解一下這個方案每個月大概要多花多少錢？"
KEEP_WARM_TEXT = "好的。"


class SpeakRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=1200)
    engine: str | None = Field(default=None, max_length=16)
    voice: str | None = Field(default=None, max_length=32)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    gender: Literal["male", "female"] | None = None
    format: Literal["wav", "mp3"] = "wav"


def wav_bytes(pcm: Any, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def mp3_bytes(wav: bytes, ffmpeg: str) -> bytes:
    """WAV → MP3 through ffmpeg on stdin/stdout. 64 kb/s mono is plenty for speech."""
    proc = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-f",
            "wav",
            "-i",
            "pipe:0",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "64k",
            "-f",
            "mp3",
            "pipe:1",
        ],
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


def resolve_default_engine(cfg: Settings) -> tuple[str | None, str | None]:
    """The engine that speaks when a request does not choose one.

    `LOCAL_TTS_ENGINE` wins when its weights are on disk. When they are not —
    somebody ran the installer before `fetch_model.sh` learned about Breeze, or
    deleted the directory — the first other engine with weights takes over and
    `/healthz` says so, rather than the service refusing to start.
    """
    wanted = (cfg.engine or "").strip().lower()
    if wanted in engines.ENGINE_NAMES and engines.is_available(wanted, cfg):
        return wanted, None
    for name in engines.ENGINE_NAMES:
        if engines.is_available(name, cfg):
            reason = (
                f"unknown engine {cfg.engine!r}"
                if wanted not in engines.ENGINE_NAMES
                else f"{wanted}: weights missing"
            )
            return name, reason
    return None, "no engine has weights on disk"


class ModelState:
    """Holds the loaded engines, or the reason one is not."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.default_engine, self.fallback_reason = resolve_default_engine(settings)
        self.engines: dict[str, TtsEngine] = {}
        self.errors: dict[str, str] = {}
        self.loading = self.default_engine is not None
        self.error: str | None = None if self.default_engine else self.fallback_reason
        self.rtf_last: float | None = None
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tts")
        self.last_request = time.monotonic()
        self._stop = threading.Event()
        self._load_lock = threading.Lock()

    # ---- loading ------------------------------------------------------------
    def get(self, name: str) -> TtsEngine:
        """The loaded engine, building it on first use. Raises on a load failure.

        Serialised: two requests naming an unloaded engine must not each build
        their own 121 MB session.
        """
        with self._load_lock:
            engine = self.engines.get(name)
            if engine is not None:
                return engine
            if not engines.is_available(name, self.settings):
                raise FileNotFoundError(f"{name}: weights missing")
            t0 = time.perf_counter()
            try:
                engine = engines.build(name, self.settings)
                engine.synthesize(WARMUP_TEXT, voice=engine.default_voice(None))
            except Exception as exc:
                self.errors[name] = f"{type(exc).__name__}: {exc}"
                log.error("tts.model_load_failed", engine=name, error=self.errors[name])
                raise
            self.engines[name] = engine
            self.errors.pop(name, None)
            log.info(
                "tts.model_loaded",
                engine=name,
                model=engine.model_name,
                voices=len(engine.voice_names()),
                sample_rate=engine.sample_rate,
                load_s=round(time.perf_counter() - t0, 2),
                rss_mb=round(peak_rss_mb()),
            )
            return engine

    def load_default(self) -> None:
        """Background thread at startup: bring the default engine up."""
        try:
            if self.default_engine is None:
                log.error("tts.no_engine", error=self.error)
                return
            self.get(self.default_engine)
        except Exception as exc:
            self.error = self.errors.get(self.default_engine or "", f"{type(exc).__name__}: {exc}")
        finally:
            self.loading = False

    @property
    def ready(self) -> bool:
        return self.default_engine is not None and self.default_engine in self.engines

    # ---- keep warm ----------------------------------------------------------
    def keep_warm(self) -> None:
        """Background thread: a tiny synthesis on every *loaded* engine whenever
        the service has sat idle for `keep_warm_s`, submitted through the same
        single-worker executor so it never overlaps a real request."""
        interval = self.settings.keep_warm_s
        while interval > 0 and not self._stop.wait(interval / 3):
            if time.monotonic() - self.last_request < interval:
                continue
            for engine in list(self.engines.values()):
                try:
                    self.executor.submit(
                        engine.synthesize, KEEP_WARM_TEXT, voice=engine.default_voice(None)
                    ).result(timeout=30)
                except Exception as exc:
                    log.warning("tts.keep_warm_failed", engine=engine.name, error=repr(exc))
            self.last_request = time.monotonic()

    def stop(self) -> None:
        self._stop.set()
        self.executor.shutdown(wait=False, cancel_futures=True)

    # ---- request resolution -------------------------------------------------
    def resolve_engine(self, req: SpeakRequest) -> TtsEngine:
        name = (req.engine or self.default_engine or "").strip().lower()
        if name not in engines.ENGINE_NAMES:
            raise HTTPException(status_code=400, detail=f"unknown engine {req.engine!r}")
        try:
            return self.get(name)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"{name} failed to load") from exc

    @staticmethod
    def resolve_voice(engine: TtsEngine, req: SpeakRequest) -> tuple[str, str | None]:
        """(voice, what-was-ignored). A single-speaker engine still answers, but
        the caller is told in `X-Voice-Ignored` that its choice did nothing —
        `LocalHttpTts` sends the persona's gender on every request and would
        otherwise never learn that it stopped mattering."""
        if engine.single_speaker:
            asked = [f"{k}={v}" for k, v in (("voice", req.voice), ("gender", req.gender)) if v]
            note = f"{','.join(asked)} ({engine.model_name} has one speaker)" if asked else None
            return engine.default_voice(None), note
        if req.voice:
            if not engine.has_voice(req.voice):
                raise HTTPException(status_code=400, detail=f"unknown voice {req.voice!r}")
            return req.voice, None
        return engine.default_voice(req.gender), None

    # ---- reporting ----------------------------------------------------------
    def engine_report(self) -> dict[str, dict[str, Any]]:
        cfg = self.settings
        out: dict[str, dict[str, Any]] = {}
        for name in engines.ENGINE_NAMES:
            loaded = self.engines.get(name)
            available = engines.is_available(name, cfg)
            if name in self.errors:
                state = "error"
            elif loaded is not None:
                state = "loaded"
            else:
                state = "available" if available else "missing"
            entry: dict[str, Any] = {
                "model": engines.model_name(name),
                "state": state,
                "default": name == self.default_engine,
                "voices": loaded.voice_names() if loaded else engines.voice_names(name, cfg),
                "single_speaker": loaded.single_speaker if loaded else name == "breeze",
                "sample_rate": loaded.sample_rate if loaded else None,
                "rtf_last": loaded.rtf_last if loaded else None,
            }
            if name in self.errors:
                entry["error"] = self.errors[name]
            out[name] = entry
        return out


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    configure_logging(json_output=cfg.log_json)
    state = ModelState(cfg)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.model = state
        threading.Thread(target=state.load_default, name="tts-load", daemon=True).start()
        threading.Thread(target=state.keep_warm, name="tts-keep-warm", daemon=True).start()
        log.info(
            "tts.started",
            host=cfg.host,
            port=cfg.port,
            engine=state.default_engine,
            engine_fallback=state.fallback_reason,
            model_dir=str(cfg.model_dir),
            breeze_dir=str(cfg.breeze_dir),
            keep_warm_s=cfg.keep_warm_s,
        )
        try:
            yield
        finally:
            state.stop()
            log.info("tts.stopped")

    app = FastAPI(
        title="AI Coach Local TTS",
        version="0.2.0",
        summary="Breeze2-VITS / Kokoro-82M-v1.1-zh on onnxruntime, loopback only",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/healthz")
    async def healthz() -> Response:
        default = state.engines.get(state.default_engine or "")
        # The top-level keys are what apps/api's `probe_local_tts` reads; they
        # describe the engine that speaks by default. `engines` has the rest.
        body: dict[str, Any] = {
            "engine": state.default_engine,
            "model": engines.model_name(state.default_engine) if state.default_engine else None,
            "device": default.device if default else None,
            "voices": default.voice_names() if default else [],
            "single_speaker": default.single_speaker if default else None,
            "sample_rate": default.sample_rate if default else None,
            "defaults": {
                "female": cfg.default_female_voice,
                "male": cfg.default_male_voice,
            },
            "engine_fallback": state.fallback_reason,
            "engines": state.engine_report(),
            "rtf_last": state.rtf_last,
            "rss_mb": round(peak_rss_mb()),
        }
        if state.ready:
            body["status"] = "ok"
            return JSONResponse(body)
        body["status"] = "loading" if state.loading else "error"
        body["error"] = state.error
        return JSONResponse(body, status_code=503)

    @app.post("/speak")
    async def speak(req: SpeakRequest, request: Request) -> Response:
        if state.loading:
            raise HTTPException(status_code=503, detail="model loading")
        if len(req.text) > cfg.max_text_chars:
            raise HTTPException(status_code=413, detail="text too long")
        engine = state.resolve_engine(req)
        voice, ignored = state.resolve_voice(engine, req)
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
            wav = wav_bytes(pcm, stats.sample_rate)
            if req.format == "mp3":
                data = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: mp3_bytes(wav, cfg.ffmpeg_bin)),
                    timeout=max(1.0, cfg.request_timeout_s - (time.perf_counter() - t0)),
                )
                media = "audio/mpeg"
            else:
                data, media = wav, "audio/wav"
        except TimeoutError as exc:
            log.warning("tts.timeout", engine=engine.name, chars=len(req.text))
            raise HTTPException(status_code=504, detail="synthesis timed out") from exc
        except HTTPException:
            raise
        except Exception as exc:
            log.error("tts.failed", engine=engine.name, chars=len(req.text), error=repr(exc))
            raise HTTPException(status_code=500, detail="synthesis failed") from exc
        total_ms = round((time.perf_counter() - t0) * 1000)
        state.last_request = time.monotonic()
        state.rtf_last = engine.rtf_last
        log.info(
            "tts.spoke",
            **stats.as_dict(),
            total_ms=total_ms,
            format=req.format,
            bytes=len(data),
            voice_ignored=bool(ignored),
        )
        headers = {
            "Cache-Control": "no-store",
            "X-Engine": engine.name,
            "X-Model": engine.model_name,
            "X-Voice": voice,
            "X-Sample-Rate": str(stats.sample_rate),
            "X-Audio-Seconds": f"{stats.audio_s:.3f}",
            "X-Rtf": f"{stats.rtf:.3f}",
            "X-Synth-Ms": f"{stats.synth_s * 1000:.0f}",
        }
        if ignored:
            headers["X-Voice-Ignored"] = ignored
        return Response(content=data, media_type=media, headers=headers)

    return app


app = create_app()
