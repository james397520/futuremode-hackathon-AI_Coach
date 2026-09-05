"""FasterLivePortrait-MLX port — Apple Silicon (§24.1, §27, §81).

Upstream: ``ivanfioravanti/fasterliveportrait-mlx``, pinned by commit in the
README's engine table. Not installed by this service, not vendored here.

Everything in this module is behind a lazy import. Importing ``mlx`` costs real
time and, on a machine with a damaged Metal stack, can abort the process — so
the module-level code here touches nothing but the standard library and our own
packages. :meth:`is_available` (inherited) uses ``find_spec``.

What the adapter does
---------------------
The upstream runtime animates a source portrait from a *driving* signal. In
Mode A (§3.1) the driving signal is a pre-extracted motion template
(``motion/<expression>.pkl``, §11) and the only per-frame decision is which
template frame to use — which is why this path can hit realtime on a laptop. In
Mode B (§3.2) the pose is synthesised per frame from the
:class:`~app.expression.interpolator.RenderPose` instead.

The pose→driving-parameter conversion is ours (ADR-002: the LLM never writes
model parameters). §70's clamp has already been applied by the interpolator, so
by the time a value reaches here it is guaranteed inside the card's limits.

.. warning::

   The upstream call signatures below are the adapter's contract with a
   *pinned* commit. §24.2/§74 require pinning the SHA, pinning the weights
   revision, and running your own regression before trusting it. If the pinned
   commit moves, this is the file that changes.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from app.core.errors import EngineUnavailableError, ModelLoadFailedError
from app.core.logging import get_logger, log_avatar
from app.expression.presets import ExpressionName
from app.liveportrait.base import LivePortraitPort
from app.liveportrait.cache import FrameCache, FrameKey
from app.liveportrait.motion_template import discover_templates

if TYPE_CHECKING:
    from app.expression.interpolator import RenderPose

logger = get_logger(__name__)


class MLXLivePortrait(LivePortraitPort):
    """LivePortrait on MLX."""

    required_modules = ("mlx", "fasterliveportrait_mlx")
    engine_name = "fasterliveportrait_mlx"
    #: §75 — pinned upstream revision. Set from configs/mac.yaml at deploy time.
    revision = ""

    def __init__(
        self,
        *,
        weights_dir: Path | None = None,
        mlx_profile: str = "turbo",
        cache_mb: float = 64.0,
    ) -> None:
        super().__init__(weights_dir=weights_dir)
        #: §27 — quality | speed | turbo | ultra. §54 starts at turbo.
        self.mlx_profile = mlx_profile
        self._pipeline: Any | None = None
        self._source: Any | None = None
        self._cache = FrameCache(cache_mb)

    # -- lifecycle ---------------------------------------------------------

    async def _open(self, avatar_dir: Path) -> None:
        # Lazy import: nothing above this line touches MLX.
        try:
            from fasterliveportrait_mlx import LivePortraitPipeline  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - requires the engine absent
            raise EngineUnavailableError(self.engine_name, f"import failed: {exc}") from exc

        portrait = avatar_dir / "source" / "portrait.png"
        if not portrait.is_file():
            raise ModelLoadFailedError(
                "the avatar has no source portrait", log_context={"engine": self.engine_name}
            )

        try:
            self._pipeline = LivePortraitPipeline.from_pretrained(
                profile=self.mlx_profile,
                weights_dir=str(self._weights_dir) if self._weights_dir else None,
            )
            # §20 — crop, landmarks and face geometry are computed once per
            # avatar and reused for every frame of every session.
            self._source = self._pipeline.prepare_source(str(portrait))
        except Exception as exc:  # noqa: BLE001 - upstream raises bare exceptions
            raise ModelLoadFailedError(
                "the LivePortrait MLX pipeline failed to initialise",
                log_context={"engine": self.engine_name, "error_type": type(exc).__name__},
            ) from exc

        self._templates = {
            name.value: template
            for name, template in discover_templates(avatar_dir / "motion").items()
        }
        self._cache.clear()
        log_avatar(
            logger,
            "avatar.engine.loaded",
            engine=self.engine_name,
            profile=self.mlx_profile,
            frame_count=len(self._templates),
        )

    async def close(self) -> None:
        self._cache.clear()
        pipeline = self._pipeline
        self._pipeline = None
        self._source = None
        if pipeline is not None and hasattr(pipeline, "close"):
            pipeline.close()
        await super().close()

    # -- rendering ---------------------------------------------------------

    def _driving_parameters(self, pose: RenderPose) -> dict[str, float]:
        """Map our §9 pose onto the upstream's retargeting inputs.

        Already §70-clamped by the interpolator. ``eye_open`` carries the blink
        (§14), and ``lip_ratio`` is pinned at rest because **MuseTalk owns the
        mouth** (§1/§2) — letting LivePortrait move the lips as well is exactly
        the double-editing §2 rejects.
        """
        return {
            "yaw": pose.head_yaw,
            "pitch": pose.head_pitch,
            "roll": pose.head_roll,
            "eye_ratio": pose.eye_open,
            "gaze_x": pose.gaze_x,
            "gaze_y": pose.gaze_y,
            "expression_scale": pose.intensity,
            "lip_ratio": 0.0,
        }

    async def render(self, pose: RenderPose, frame_index: int) -> np.ndarray:
        if self._pipeline is None or self._source is None:
            raise EngineUnavailableError(self.engine_name, "render called before load")

        try:
            expression = ExpressionName(pose.expression)
        except ValueError:
            expression = ExpressionName.NEUTRAL

        key = FrameKey.of(expression, frame_index, pose.intensity)
        cached = self._cache.get(key)
        if cached is not None:
            return cached.astype(np.float32)

        template = self._templates.get(expression.value)
        try:
            if template is not None:
                frame = self._pipeline.animate_from_template(
                    self._source,
                    template_path=str(template.path),
                    frame_index=template.frame_at(frame_index),
                    overrides=self._driving_parameters(pose),
                )
            else:
                # §3.2 continuous mode, or an expression with no template built.
                frame = self._pipeline.animate(self._source, **self._driving_parameters(pose))
        except Exception as exc:  # noqa: BLE001 - upstream raises bare exceptions
            raise EngineUnavailableError(
                self.engine_name, f"render failed: {type(exc).__name__}"
            ) from exc

        array = np.asarray(frame)
        if array.ndim != 3:
            raise EngineUnavailableError(self.engine_name, "engine returned a non-RGB frame")
        self._cache.put(key, array)
        return array.astype(np.float32)


__all__ = ["MLXLivePortrait"]
