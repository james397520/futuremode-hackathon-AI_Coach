"""LivePortrait engine port (§1.1, §5, §24, §29, §88).

**LivePortrait 管「演技」** — head pose, eyes, blinks, upper-face expression,
listening/idle motion. It does *not* drive the mouth; that is MuseTalk's job and
§2 explains why letting both touch the same pixels goes wrong.

This module defines the port, not an engine. The engines themselves are pinned
third-party checkouts (see the README's "Engine ports" table) that are **not
installed by this service and not vendored into this repo**:

* Mac — ``ivanfioravanti/fasterliveportrait-mlx`` (§24.1)
* RTX — ``warmshao/FasterLivePortrait`` (§29.1)
* upstream — ``KlingAIResearch/LivePortrait`` (§88)

Two rules every implementation follows:

1. **:meth:`LivePortraitPort.is_available` never imports the engine.** It probes
   with ``importlib.util.find_spec`` and checks that the weights exist on disk.
   A capability probe that can raise is not a capability probe.
2. **Every failure is an :class:`~app.core.errors.EngineUnavailableError`.** The
   orchestrator turns that into the §53 fallback chain — freeze the expression
   and let MuseTalk carry the frame — rather than ending the training session
   (ADR-009).

Licence note (§74): LivePortrait's code is MIT, but the default InsightFace
detection models it ships with are **non-commercial research only**. A
commercial deployment must substitute a differently-licensed detector and
re-audit every model asset. That is why nothing here downloads weights.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from app.core.errors import EngineUnavailableError
from app.core.logging import get_logger, log_avatar

if TYPE_CHECKING:
    import numpy as np

    from app.expression.interpolator import RenderPose
    from app.liveportrait.motion_template import MotionTemplate

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class EngineInfo:
    """What an engine reports about itself for §39/§40/§75."""

    name: str
    #: Pinned upstream revision, from the §75 model manifest. Never "latest".
    revision: str
    variant: str = ""
    available: bool = False
    #: Human-readable reason when ``available`` is False. Shown to operators,
    #: never to trainees.
    reason: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "engine": self.name,
            "revision": self.revision,
            "variant": self.variant,
            "available": self.available,
            "reason": self.reason,
        }


@runtime_checkable
class LivePortraitEngine(Protocol):
    """The narrow surface the orchestrator uses."""

    def is_available(self) -> bool: ...

    async def load(self, avatar_dir: Path) -> None: ...

    async def render(self, pose: RenderPose, frame_index: int) -> np.ndarray: ...

    async def close(self) -> None: ...


class LivePortraitPort(ABC):
    """Base class shared by the MLX and TensorRT implementations.

    Subclasses supply three things: the module names to probe, how to build the
    engine object (lazily, inside :meth:`load`), and how to turn a
    :class:`~app.expression.interpolator.RenderPose` into a frame.
    """

    #: Modules that must be importable for this engine to work.
    required_modules: tuple[str, ...] = ()
    engine_name: str = "liveportrait"
    #: §75 — pinned revision. A blank value means "not pinned", which
    #: :meth:`describe` reports as a problem rather than hiding.
    revision: str = ""

    def __init__(self, *, weights_dir: Path | None = None) -> None:
        self._weights_dir = weights_dir
        self._loaded_avatar: Path | None = None
        self._templates: dict[str, MotionTemplate] = {}

    # -- availability ------------------------------------------------------

    def missing_modules(self) -> tuple[str, ...]:
        """Which required modules are absent. Probed, never imported."""
        from app.platform.detect import module_available

        return tuple(name for name in self.required_modules if not module_available(name))

    def is_available(self) -> bool:
        """True when this engine could actually run here.

        Deliberately conservative: a missing weights directory counts as
        unavailable, because discovering it at the first frame of a training
        session is far worse than discovering it at boot (§52 preflight).
        """
        if self.missing_modules():
            return False
        if self._weights_dir is not None and not self._weights_dir.is_dir():
            return False
        return True

    def unavailable_reason(self) -> str:
        missing = self.missing_modules()
        if missing:
            return f"missing modules: {', '.join(missing)}"
        if self._weights_dir is not None and not self._weights_dir.is_dir():
            return "weights directory not found"
        return ""

    def describe(self) -> EngineInfo:
        return EngineInfo(
            name=self.engine_name,
            revision=self.revision or "unpinned",
            available=self.is_available(),
            reason=self.unavailable_reason(),
        )

    def require(self) -> None:
        """Raise :class:`EngineUnavailableError` unless this engine can run."""
        if not self.is_available():
            reason = self.unavailable_reason() or "engine not installed"
            log_avatar(
                logger,
                "avatar.engine.unavailable",
                engine=self.engine_name,
                reason=reason,
                available=False,
            )
            raise EngineUnavailableError(self.engine_name, reason)

    # -- lifecycle ---------------------------------------------------------

    async def load(self, avatar_dir: Path) -> None:
        """Load an avatar's motion templates and warm the engine (§52).

        The heavy import happens in :meth:`_open`, which subclasses implement
        and which is only ever reached after :meth:`require` has passed.
        """
        self.require()
        await self._open(avatar_dir)
        self._loaded_avatar = avatar_dir

    @abstractmethod
    async def _open(self, avatar_dir: Path) -> None:
        """Import the engine and prepare it for ``avatar_dir``."""

    @abstractmethod
    async def render(self, pose: RenderPose, frame_index: int) -> np.ndarray:
        """One expression/pose frame, RGB, canvas-sized."""

    async def close(self) -> None:
        self._loaded_avatar = None
        self._templates.clear()


__all__ = ["EngineInfo", "LivePortraitEngine", "LivePortraitPort"]
