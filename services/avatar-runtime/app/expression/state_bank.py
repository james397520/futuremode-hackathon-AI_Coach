"""Expression State Bank — §3.1 (Mode A) and §21 (the uniformity rules).

§3.1 is the P0 runtime mode and the reason this design can hit realtime on a
laptop: LivePortrait does **not** run every frame. Each avatar gets a small set
of pre-rendered idle loops — one per expression — and at runtime the persona
state only chooses *which loop is playing*. MuseTalk then does live lip sync on
top. Latency collapses, the GPU is free for the mouth, and every expression can
be inspected and hand-corrected before it ever reaches a trainee (§3.1's "每個
Persona 可人工校正").

§21 makes that work by insisting every loop in a bank is interchangeable:

    相同解析度 / 相同 FPS / 相同 clip length / 相同 crop

MVP shape: 512×512, 25fps, 5s, 125 frames.

If those do not match, a crossfade between two loops is a jump cut in the
middle of the face — so a non-uniform bank is refused at load time with
:class:`~app.core.errors.ExpressionBankInvalidError` rather than producing a
visibly broken avatar at runtime.

Switching loops uses a **300–500ms face-space crossfade** (§21). This module
owns the *schedule* — which two loops, which frames of each, and the mix
weight — and is deliberately free of pixel handling, so it is testable with no
video decoder installed. The actual frame pixels come from a
:class:`LoopSource`, which the backends implement.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, Protocol, runtime_checkable

from app.core.errors import ExpressionBankInvalidError
from app.expression.interpolator import ease_in_out
from app.expression.presets import ExpressionName

if TYPE_CHECKING:
    import numpy as np

#: §21 crossfade window.
MIN_CROSSFADE_MS: Final[float] = 300.0
MAX_CROSSFADE_MS: Final[float] = 500.0
DEFAULT_CROSSFADE_MS: Final[float] = 380.0

#: §21's recommended MVP loop shape.
MVP_RESOLUTION: Final[tuple[int, int]] = (512, 512)
MVP_FPS: Final[int] = 25
MVP_FRAME_COUNT: Final[int] = 125  # 5 seconds

BANK_MANIFEST_NAME: Final[str] = "bank.json"


@dataclass(frozen=True, slots=True)
class LoopSpec:
    """One expression loop's metadata (§7 ``loops/<name>.mp4``)."""

    name: ExpressionName
    path: Path
    width: int
    height: int
    fps: int
    frame_count: int
    #: Face crop in source pixels, ``(x, y, w, h)``. Every loop in a bank shares
    #: it — §21's "相同 crop" — so a crossfade mixes the same face geometry.
    crop: tuple[int, int, int, int]

    @property
    def duration_s(self) -> float:
        return self.frame_count / float(self.fps)

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name.value,
            "path": str(self.path),
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "frame_count": self.frame_count,
            "crop": list(self.crop),
        }


@runtime_checkable
class LoopSource(Protocol):
    """Pixel access for a bank. Implemented by whatever can decode the loops.

    Kept as a Protocol so the schedule logic below never imports a decoder:
    the MLX and CUDA backends supply a real one, and
    :class:`AbsentLoopSource` stands in when no decoder exists, which is what
    lets a static-portrait session still run the same expression machinery.
    """

    def frame(self, loop: ExpressionName, index: int) -> np.ndarray | None:
        """RGB frame ``index`` of ``loop``, or None when unavailable."""
        ...


class AbsentLoopSource:
    """A :class:`LoopSource` with no pixels — the §53 floor.

    Returning ``None`` is not an error path: the static backend renders its own
    portrait and only uses the bank for *which expression is active*, so a
    session runs identically whether or not the loops were ever built.
    """

    def frame(self, loop: ExpressionName, index: int) -> np.ndarray | None:  # noqa: ARG002
        return None


@dataclass(frozen=True, slots=True)
class BankSample:
    """What to composite for one frame.

    Outside a crossfade, ``alpha`` is 0 and only ``primary`` matters. During a
    crossfade the caller mixes ``primary`` and ``secondary`` by ``alpha``,
    which is already eased — a linear crossfade has a visible mid-point where
    both faces are half-transparent.
    """

    primary: ExpressionName
    primary_index: int
    secondary: ExpressionName | None = None
    secondary_index: int = 0
    alpha: float = 0.0

    @property
    def crossfading(self) -> bool:
        return self.secondary is not None and self.alpha > 0.0


class ExpressionStateBank:
    """The loaded loops for one avatar, plus the playhead and crossfade schedule."""

    __slots__ = ("_active", "_crossfade_ms", "_incoming", "_source", "_started_s", "loops")

    def __init__(
        self,
        loops: dict[ExpressionName, LoopSpec],
        *,
        source: LoopSource | None = None,
        crossfade_ms: float = DEFAULT_CROSSFADE_MS,
        initial: ExpressionName = ExpressionName.NEUTRAL,
        now_s: float = 0.0,
    ) -> None:
        if not loops:
            raise ExpressionBankInvalidError("the expression bank contains no loops")
        if not MIN_CROSSFADE_MS <= crossfade_ms <= MAX_CROSSFADE_MS:
            msg = (
                f"crossfade must be within the §21 window "
                f"[{MIN_CROSSFADE_MS}, {MAX_CROSSFADE_MS}]ms, got {crossfade_ms}"
            )
            raise ExpressionBankInvalidError(msg)
        validate_uniformity(loops)
        self.loops = dict(loops)
        self._source = source or AbsentLoopSource()
        self._crossfade_ms = crossfade_ms
        self._active = initial if initial in self.loops else next(iter(self.loops))
        self._incoming: tuple[ExpressionName, float] | None = None
        self._started_s = now_s

    # -- introspection -----------------------------------------------------

    @property
    def available(self) -> frozenset[ExpressionName]:
        """What the controller is allowed to select."""
        return frozenset(self.loops)

    @property
    def active(self) -> ExpressionName:
        return self._active

    @property
    def fps(self) -> int:
        return next(iter(self.loops.values())).fps

    @property
    def frame_count(self) -> int:
        return next(iter(self.loops.values())).frame_count

    @property
    def resolution(self) -> tuple[int, int]:
        spec = next(iter(self.loops.values()))
        return spec.width, spec.height

    # -- playback ----------------------------------------------------------

    def _index_at(self, now_s: float) -> int:
        """Playhead position, shared by every loop.

        Deliberately a *single* phase for all loops rather than one per loop:
        §21 asks for "盡量相同 motion phase", and a shared playhead is the only
        way to guarantee that a crossfade lines up the same point of the
        breathing cycle instead of mixing an inhale with an exhale.
        """
        elapsed = max(0.0, now_s - self._started_s)
        return int(elapsed * self.fps) % max(1, self.frame_count)

    def switch(self, to: ExpressionName, *, now_s: float) -> bool:
        """Begin a §21 crossfade to ``to``. False if it is already active."""
        if to not in self.loops:
            msg = f"expression {to.value!r} is not in this bank"
            raise ExpressionBankInvalidError(msg)
        if to == self._active and self._incoming is None:
            return False
        if self._incoming is not None and self._incoming[0] == to:
            return False
        # Interrupting a crossfade: the loop currently dominant becomes the
        # outgoing one, so the face never appears to reverse direction.
        sample = self.sample(now_s)
        self._active = sample.primary if sample.alpha < 0.5 else (sample.secondary or sample.primary)
        self._incoming = (to, now_s)
        return True

    def sample(self, now_s: float) -> BankSample:
        """The frames and mix weight for ``now_s``."""
        index = self._index_at(now_s)
        if self._incoming is None:
            return BankSample(primary=self._active, primary_index=index)

        incoming, started = self._incoming
        progress = (now_s - started) * 1000.0 / self._crossfade_ms
        if progress >= 1.0:
            self._active = incoming
            self._incoming = None
            return BankSample(primary=incoming, primary_index=index)
        return BankSample(
            primary=self._active,
            primary_index=index,
            secondary=incoming,
            # Same playhead for both — see `_index_at`.
            secondary_index=index,
            alpha=ease_in_out(max(0.0, progress)),
        )

    def frames_for(self, sample: BankSample) -> tuple[np.ndarray | None, np.ndarray | None]:
        """Resolve a sample to pixels via the :class:`LoopSource`."""
        primary = self._source.frame(sample.primary, sample.primary_index)
        secondary = (
            self._source.frame(sample.secondary, sample.secondary_index)
            if sample.secondary is not None
            else None
        )
        return primary, secondary

    def set_source(self, source: LoopSource) -> None:
        self._source = source


# ---------------------------------------------------------------------------
# Loading / validation
# ---------------------------------------------------------------------------


def validate_uniformity(loops: dict[ExpressionName, LoopSpec]) -> None:
    """Enforce §21: same resolution, fps, clip length and crop across the bank."""
    specs = list(loops.values())
    first = specs[0]
    for spec in specs[1:]:
        if (spec.width, spec.height) != (first.width, first.height):
            raise ExpressionBankInvalidError(
                f"loop '{spec.name.value}' is {spec.width}x{spec.height}, "
                f"but '{first.name.value}' is {first.width}x{first.height}"
            )
        if spec.fps != first.fps:
            raise ExpressionBankInvalidError(
                f"loop '{spec.name.value}' is {spec.fps}fps, but "
                f"'{first.name.value}' is {first.fps}fps"
            )
        if spec.frame_count != first.frame_count:
            raise ExpressionBankInvalidError(
                f"loop '{spec.name.value}' has {spec.frame_count} frames, but "
                f"'{first.name.value}' has {first.frame_count}"
            )
        if spec.crop != first.crop:
            raise ExpressionBankInvalidError(
                f"loop '{spec.name.value}' uses a different face crop from "
                f"'{first.name.value}'; a crossfade would move the face"
            )


def bank_manifest(loops: dict[ExpressionName, LoopSpec]) -> dict[str, Any]:
    """Serialise a bank to the ``loops/bank.json`` form."""
    first = next(iter(loops.values()))
    return {
        "version": 1,
        "width": first.width,
        "height": first.height,
        "fps": first.fps,
        "frame_count": first.frame_count,
        "crop": list(first.crop),
        "loops": {name.value: spec.to_json() for name, spec in loops.items()},
    }


def load_bank_manifest(path: Path) -> dict[ExpressionName, LoopSpec]:
    """Read ``loops/bank.json`` into validated :class:`LoopSpec` objects."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ExpressionBankInvalidError("no expression bank manifest was found") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise ExpressionBankInvalidError("the expression bank manifest is unreadable") from exc

    entries = raw.get("loops")
    if not isinstance(entries, dict) or not entries:
        raise ExpressionBankInvalidError("the expression bank manifest lists no loops")

    base = path.parent
    loops: dict[ExpressionName, LoopSpec] = {}
    for key, entry in entries.items():
        try:
            name = ExpressionName(key)
        except ValueError as exc:
            raise ExpressionBankInvalidError(f"unknown expression name {key!r} in bank") from exc
        try:
            crop = tuple(int(v) for v in entry["crop"])
            if len(crop) != 4:
                raise ValueError
            loops[name] = LoopSpec(
                name=name,
                path=(base / str(entry["path"])).resolve() if entry.get("path") else base,
                width=int(entry["width"]),
                height=int(entry["height"]),
                fps=int(entry["fps"]),
                frame_count=int(entry["frame_count"]),
                crop=(crop[0], crop[1], crop[2], crop[3]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ExpressionBankInvalidError(
                f"loop {key!r} is missing required geometry fields"
            ) from exc

    validate_uniformity(loops)
    return loops


__all__ = [
    "BANK_MANIFEST_NAME",
    "DEFAULT_CROSSFADE_MS",
    "MAX_CROSSFADE_MS",
    "MIN_CROSSFADE_MS",
    "MVP_FPS",
    "MVP_FRAME_COUNT",
    "MVP_RESOLUTION",
    "AbsentLoopSource",
    "BankSample",
    "ExpressionStateBank",
    "LoopSource",
    "LoopSpec",
    "bank_manifest",
    "load_bank_manifest",
    "validate_uniformity",
]
