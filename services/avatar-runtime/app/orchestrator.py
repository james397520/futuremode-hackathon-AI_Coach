"""Session orchestration: state machine, frame loop, barge-in, fallback ladder.

The runtime state machine is §14 (IDLE / LISTENING / SPEAKING plus THINKING,
INTERRUPTED, TRANSITION). Two rules from the spec drive most of the design:

* **§53 — an avatar failure must never end a training session.** Every engine
  sits behind a try/except that steps *down* the ladder and keeps producing
  frames. `StaticPortraitBackend` is the floor and needs no engine at all.
* **§17 — audio PTS is the master clock.** When rendering falls behind, frames
  are dropped rather than queued, so audio never waits for video.

§47 is also enforced here: `set_state` is applied before the audio for the same
turn arrives, so the figure visibly prepares to speak.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

import numpy as np
import structlog

from app.avatars.store import Avatar, AvatarStore
from app.backends.static_portrait import StaticPortraitBackend
from app.core.config import Settings
from app.core.errors import SessionLimitReachedError, SessionNotFoundError
from app.core.event_bus import EventBus, EventName
from app.core.jitter_buffer import AudioJitterBuffer
from app.expression.controller import ExpressionController
from app.expression.mapper import PersonaSnapshot
from app.stream.encoder import FrameEncoder

log = structlog.get_logger(__name__)


class RuntimeState(StrEnum):
    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    INTERRUPTED = "interrupted"
    TRANSITION = "transition"


@dataclass(slots=True)
class SessionStats:
    frames_rendered: int = 0
    frames_dropped: int = 0
    render_ms_total: float = 0.0
    encode_ms_total: float = 0.0
    started_at: float = field(default_factory=time.monotonic)

    @property
    def uptime_s(self) -> float:
        return time.monotonic() - self.started_at

    @property
    def avg_render_ms(self) -> float:
        return self.render_ms_total / self.frames_rendered if self.frames_rendered else 0.0

    def to_json(self) -> dict[str, Any]:
        return {
            "frames_rendered": self.frames_rendered,
            "frames_dropped": self.frames_dropped,
            "avg_render_ms": round(self.avg_render_ms, 3),
            "avg_encode_ms": round(
                self.encode_ms_total / self.frames_rendered if self.frames_rendered else 0.0, 3
            ),
            "uptime_s": round(self.uptime_s, 1),
            "measured_fps": round(self.frames_rendered / self.uptime_s, 1) if self.uptime_s else 0.0,
        }


class AvatarSession:
    """One live avatar: expression control, audio, and the frame loop."""

    def __init__(
        self,
        session_id: str,
        avatar: Avatar,
        *,
        settings: Settings,
        width: int,
        height: int,
        fps: int,
        mode: str,
        bus: EventBus,
    ) -> None:
        self.session_id = session_id
        self.avatar = avatar
        self.width, self.height, self.fps = width, height, fps
        self.mode = mode
        self.state = RuntimeState.IDLE
        self.stats = SessionStats()
        self.degraded_reason: str | None = None

        self._bus = bus
        self._settings = settings
        self._controller = ExpressionController(now_s=0.0)
        self._encoder = FrameEncoder(fmt="jpeg", quality=settings.frame_quality)
        self._jitter = AudioJitterBuffer(
            target_ms=settings.jitter_target_ms,
            max_ms=settings.jitter_max_ms,
            sample_rate=settings.feature_sample_rate,
        )
        self._backend = self._build_backend()
        self._samples_per_frame = max(1, settings.feature_sample_rate // fps)
        self._t0 = time.monotonic()
        self._speaking_until = 0.0
        self._lock = asyncio.Lock()

    # -- construction --------------------------------------------------------
    def _build_backend(self) -> StaticPortraitBackend:
        """Walk the §53 ladder. Today only the floor is installable here.

        MLX / CUDA engines plug in above this; each one that fails to load logs a
        degrade reason and falls through, so the worst case is always a working
        static portrait rather than a dead session.
        """
        portrait = self._load_portrait()
        # Per-avatar framing (§71 leaves room for where the head sits), so a
        # portrait whose face is higher or lower than the default still gets its
        # mouth overlay in the right place. Missing or malformed -> defaults.
        geometry = self.avatar.manifest.get("geometry")
        if not isinstance(geometry, dict):
            geometry = None
        return StaticPortraitBackend(
            portrait, width=self.width, height=self.height, geometry=geometry
        )

    def _load_portrait(self) -> np.ndarray:
        path = self.avatar.portrait_path
        if path is not None:
            try:
                from PIL import Image  # lazy: Pillow is an optional extra

                return np.asarray(Image.open(path).convert("RGB"))
            except Exception as exc:  # noqa: BLE001 - any decode failure degrades
                self.degraded_reason = f"portrait_unreadable: {exc}"
                log.warning("avatar.portrait.unreadable", path=str(path), error=repr(exc))
        else:
            self.degraded_reason = "no_portrait"
        # Last resort: a flat card in the product's own palette. Still frames,
        # still animates, still never crashes the session.
        fill = np.array([232, 238, 250], dtype=np.uint8)
        return np.broadcast_to(fill, (self.height, self.width, 3)).copy()

    # -- control -------------------------------------------------------------
    async def set_persona_state(self, payload: dict[str, Any]) -> dict[str, Any]:
        """§43 + §47: apply expression *before* the audio for this turn."""
        snapshot = PersonaSnapshot.model_validate(payload)
        now = time.monotonic() - self._t0
        async with self._lock:
            transition = self._controller.apply(snapshot, now_s=now)
            if self.state is RuntimeState.IDLE:
                self.state = RuntimeState.LISTENING
        if transition is not None:
            await self._publish(
                EventName.EXPRESSION_TRANSITION,
                {
                    "from": str(transition.from_state),
                    "to": str(transition.to_state),
                    "kind": str(transition.kind),
                    "duration_ms": transition.duration_ms,
                },
            )
        await self._publish(
            EventName.STATE_CHANGED,
            {"expression": str(self._controller.state), "runtime_state": str(self.state)},
        )
        return {"expression": str(self._controller.state), "state": str(self.state)}

    async def push_audio(self, samples: np.ndarray) -> dict[str, Any]:
        """Queue TTS audio. Entering SPEAKING is what starts mouth motion."""
        self._jitter.push(samples)
        now = time.monotonic() - self._t0
        self._speaking_until = now + self._jitter.buffered_ms / 1000.0
        if self.state is not RuntimeState.SPEAKING:
            self.state = RuntimeState.SPEAKING
            await self._publish(EventName.SPEAKING_STARTED, {})
        await self._publish(
            EventName.AUDIO_BUFFERING, {"buffered_ms": round(self._jitter.buffered_ms, 1)}
        )
        return {"buffered_ms": self._jitter.buffered_ms, "primed": self._jitter.primed}

    async def speak_text(self, text: str, *, rate_cps: float = 5.5) -> dict[str, Any]:
        """Drive the mouth from text when there is no TTS audio.

        This is **not** lip sync and does not claim to be: it synthesises a
        syllable-rate envelope so the figure visibly speaks for about as long as
        the line takes to say. Without it the avatar sits closed-mouthed through
        the customer's entire reply, which reads as broken rather than as
        "TTS is not configured".

        `push_audio` remains the real path — when a TTS provider is wired in, its
        PCM drives the same envelope and this is never called. CJK is counted per
        character and latin per ~4, which is roughly syllable-equivalent.
        """
        stripped = text.strip()
        if not stripped:
            return {"speaking": False, "duration_ms": 0}

        cjk = sum(1 for ch in stripped if "\u4e00" <= ch <= "\u9fff")
        latin = len(stripped) - cjk
        syllables = cjk + latin / 4.0
        duration_s = max(0.6, min(30.0, syllables / max(1.0, rate_cps)))

        sr = self._settings.feature_sample_rate
        n = int(duration_s * sr)
        t = np.arange(n, dtype=np.float32) / sr
        # ~4.2 syllables/sec of amplitude modulation, with a slower prosody
        # envelope over it so the line has phrasing rather than a flat buzz.
        syllable = 0.5 + 0.5 * np.sin(2 * np.pi * 4.2 * t - np.pi / 2)
        prosody = 0.65 + 0.35 * np.sin(2 * np.pi * 0.45 * t)
        # Fade the tail so the mouth closes on the last word instead of clipping.
        tail = np.clip((duration_s - t) / 0.25, 0.0, 1.0)
        envelope = (syllable**2 * prosody * tail * 0.42).astype(np.float32)

        await self.push_audio(envelope)
        return {"speaking": True, "duration_ms": int(duration_s * 1000), "synthetic": True}

    async def interrupt(self) -> dict[str, Any]:
        """§15 barge-in: flush audio, close the mouth, return to LISTENING.

        The mouth closing is the part that matters. A figure that keeps mouthing
        words after the trainee cut in reads as a bug to every viewer.
        """
        async with self._lock:
            self._jitter.flush()
            self._backend.close_mouth()
            self.state = RuntimeState.LISTENING
            self._speaking_until = 0.0
        await self._publish(EventName.INTERRUPTED, {})
        await self._publish(EventName.SPEAKING_ENDED, {"reason": "interrupted"})
        return {"state": str(self.state)}

    # -- rendering -----------------------------------------------------------
    def render_frame(self) -> tuple[bytes, str, dict[str, Any]]:
        """Render + encode one frame. Never raises for engine reasons."""
        now = time.monotonic() - self._t0
        t_render = time.perf_counter()

        if self.state is RuntimeState.SPEAKING and self._jitter.buffered_ms > 0:
            samples = self._jitter.pop_samples(self._samples_per_frame)
        else:
            samples = np.zeros(self._samples_per_frame, dtype=np.float32)
        openness = self._backend.push_audio_envelope(samples)

        pose = self._controller.sample(now_s=now)
        frame = self._backend.render(pose, mouth_open=openness)
        render_ms = (time.perf_counter() - t_render) * 1000.0

        t_encode = time.perf_counter()
        payload, fmt = self._encoder.encode(frame)
        encode_ms = (time.perf_counter() - t_encode) * 1000.0

        self.stats.frames_rendered += 1
        self.stats.render_ms_total += render_ms
        self.stats.encode_ms_total += encode_ms

        return payload, fmt, {
            "expression": str(pose.expression),
            "mouth_open": round(openness, 3),
            "render_ms": round(render_ms, 2),
            "encode_ms": round(encode_ms, 2),
            "state": str(self.state),
        }

    def maybe_end_speaking(self) -> bool:
        now = time.monotonic() - self._t0
        if self.state is RuntimeState.SPEAKING and self._jitter.buffered_ms <= 0 and now > self._speaking_until:
            self.state = RuntimeState.LISTENING
            return True
        return False

    def snapshot(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "avatar_id": self.avatar.avatar_id,
            "state": str(self.state),
            "expression": str(self._controller.state),
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "mode": self.mode,
            "encoder": self._encoder.effective_format,
            "backend": self._backend.name,
            "degraded_reason": self.degraded_reason,
            "audio_buffered_ms": round(self._jitter.buffered_ms, 1),
            "stats": self.stats.to_json(),
        }

    async def _publish(self, name: EventName, data: dict[str, Any]) -> None:
        # EventBus.publish is synchronous and takes the payload as kwargs; the
        # wrapper stays async so callers do not have to care if that changes.
        self._bus.publish(name, self.session_id, **data)


class AvatarOrchestrator:
    """Owns the avatar store, the event bus, and the live sessions."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.store = AvatarStore(
            Path(settings.avatars_dir),
            require_consent=settings.require_consent,
            max_active=settings.max_active_avatars,
        )
        self.bus = EventBus()
        self._sessions: dict[str, AvatarSession] = {}
        self._counter = 0

    @property
    def sessions(self) -> dict[str, AvatarSession]:
        return self._sessions

    def create_session(
        self, *, avatar_id: str, width: int, height: int, fps: int, mode: str
    ) -> AvatarSession:
        if len(self._sessions) >= self._settings.max_sessions:
            raise SessionLimitReachedError(
                f"{len(self._sessions)} sessions already open (max {self._settings.max_sessions})"
            )
        avatar = self.store.load(avatar_id)          # raises if consent is missing (§73)
        self._counter += 1
        session_id = f"avs_{int(time.time())}_{self._counter}"
        session = AvatarSession(
            session_id,
            avatar,
            settings=self._settings,
            width=width,
            height=height,
            fps=fps,
            mode=mode,
            bus=self.bus,
        )
        self._sessions[session_id] = session
        log.info(
            "avatar.session.created",
            session_id=session_id,
            avatar_id=avatar_id,
            size=f"{width}x{height}",
            fps=fps,
            mode=mode,
        )
        return session

    def get(self, session_id: str) -> AvatarSession:
        try:
            return self._sessions[session_id]
        except KeyError as exc:
            raise SessionNotFoundError(f"no session {session_id!r}") from exc

    async def close_session(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is not None:
            log.info("avatar.session.closed", session_id=session_id, **session.stats.to_json())

    async def aclose(self) -> None:
        for sid in list(self._sessions):
            await self.close_session(sid)
        await self.bus.aclose()
