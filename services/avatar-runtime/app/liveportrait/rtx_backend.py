"""FasterLivePortrait TensorRT/ONNX port — NVIDIA RTX (§29.1, §32, §33, §82).

Upstream: ``warmshao/FasterLivePortrait``, pinned by commit *and* image digest
(§32: "Production 要 pin image digest + repo commit，不用浮動 latest").

§33 is the constraint that shapes this file: upstream documents TensorRT **8.x**
and needs the ``grid_sample`` TensorRT plugin. Newer TensorRT is not assumed
compatible, so the port checks the runtime's major version before using the TRT
path and falls back to the ONNX Runtime CUDA path when it does not match — a
slower engine is a working session; a version-mismatched TRT engine is a crash
mid-training.

As with the MLX port: no heavy import at module scope, availability probed with
``find_spec``, every failure raised as
:class:`~app.core.errors.EngineUnavailableError` so §53 can route around it.
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
from app.platform.rtx import TENSORRT_MAJOR_VERIFIED

if TYPE_CHECKING:
    from app.expression.interpolator import RenderPose

logger = get_logger(__name__)


class RTXLivePortrait(LivePortraitPort):
    """LivePortrait on TensorRT, with an ONNX Runtime CUDA fallback."""

    #: onnxruntime alone is enough to run; tensorrt only upgrades the path.
    required_modules = ("onnxruntime",)
    engine_name = "fasterliveportrait_trt"
    revision = ""

    def __init__(
        self,
        *,
        weights_dir: Path | None = None,
        prefer_tensorrt: bool = True,
        cache_mb: float = 96.0,
    ) -> None:
        super().__init__(weights_dir=weights_dir)
        self.prefer_tensorrt = prefer_tensorrt
        self._pipeline: Any | None = None
        self._source: Any | None = None
        self._backend_used = "onnxruntime"
        self._cache = FrameCache(cache_mb)

    @property
    def backend_used(self) -> str:
        """``tensorrt`` or ``onnxruntime`` — reported by §39's ``/health``."""
        return self._backend_used

    # -- TensorRT version gate (§33) --------------------------------------

    def _tensorrt_usable(self) -> tuple[bool, str]:
        """Whether the installed TensorRT matches the verified major version."""
        from app.platform.detect import module_available

        if not self.prefer_tensorrt or not module_available("tensorrt"):
            return False, "tensorrt not installed"
        try:
            import tensorrt  # type: ignore[import-not-found]  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover
            return False, f"tensorrt import failed: {exc}"
        version = str(getattr(tensorrt, "__version__", ""))
        major = version.split(".", 1)[0]
        if major != str(TENSORRT_MAJOR_VERIFIED):
            # §33: do not assume the newest TensorRT works. Say so and continue.
            return False, f"tensorrt {version} is not the verified {TENSORRT_MAJOR_VERIFIED}.x"
        return True, ""

    # -- lifecycle ---------------------------------------------------------

    async def _open(self, avatar_dir: Path) -> None:
        try:
            from faster_live_portrait import (  # type: ignore[import-not-found]
                FasterLivePortraitPipeline,
            )
        except ImportError as exc:  # pragma: no cover - requires the engine absent
            raise EngineUnavailableError(self.engine_name, f"import failed: {exc}") from exc

        portrait = avatar_dir / "source" / "portrait.png"
        if not portrait.is_file():
            raise ModelLoadFailedError(
                "the avatar has no source portrait", log_context={"engine": self.engine_name}
            )

        use_trt, reason = self._tensorrt_usable()
        self._backend_used = "tensorrt" if use_trt else "onnxruntime"
        if not use_trt and reason:
            log_avatar(
                logger,
                "avatar.engine.degraded",
                engine=self.engine_name,
                reason=reason,
                available=True,
            )

        try:
            self._pipeline = FasterLivePortraitPipeline(
                backend=self._backend_used,
                weights_dir=str(self._weights_dir) if self._weights_dir else None,
            )
            self._source = self._pipeline.prepare_source(str(portrait))
        except Exception as exc:  # noqa: BLE001 - upstream raises bare exceptions
            raise ModelLoadFailedError(
                "the FasterLivePortrait pipeline failed to initialise",
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
            backend=self._backend_used,
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
        """Same contract as the MLX port — see its docstring. ``lip_ratio`` is
        pinned at rest because MuseTalk owns the mouth (§1/§2)."""
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
                frame = self._pipeline.run_template(
                    self._source,
                    template_path=str(template.path),
                    frame_index=template.frame_at(frame_index),
                    overrides=self._driving_parameters(pose),
                )
            else:
                frame = self._pipeline.run(self._source, **self._driving_parameters(pose))
        except Exception as exc:  # noqa: BLE001 - upstream raises bare exceptions
            raise EngineUnavailableError(
                self.engine_name, f"render failed: {type(exc).__name__}"
            ) from exc

        array = np.asarray(frame)
        if array.ndim != 3:
            raise EngineUnavailableError(self.engine_name, "engine returned a non-RGB frame")
        self._cache.put(key, array)
        return array.astype(np.float32)


__all__ = ["RTXLivePortrait"]
