"""Platform and capability detection (§66, §26, §40).

§66's boot sequence is::

    detect platform → warm benchmark → choose profile

and this module is all three.

The hard rule: **nothing heavy is imported here.** Availability is probed with
``importlib.util.find_spec``, which reads the import system's metadata without
executing the module. That matters more than it sounds: importing ``torch``
costs a second and several hundred megabytes, importing ``mlx`` on a machine
with a broken Metal stack can abort the process, and importing ``tensorrt``
without the matching CUDA runtime raises at import time. A capability probe that
can crash the service is not a capability probe.

The second rule: **never crash on an unknown platform.** A machine that is
neither Apple Silicon nor NVIDIA — a CI runner, an Intel Mac, an ARM server —
gets :attr:`ProfileName.STATIC` and a working session with the static-portrait
backend. That is §53's floor expressed at boot time.
"""

from __future__ import annotations

import importlib.util
import os
import platform as _platform
import shutil
import subprocess  # noqa: S404 - only ever invoked on a fixed, absolute-path binary
import sys
from dataclasses import dataclass, field
from enum import StrEnum
from functools import lru_cache
from time import perf_counter
from typing import Any, Final

import numpy as np

from app.core.config import (
    BackendKind,
    EncoderKind,
    Precision,
    ProfileName,
    RuntimeMode,
    RuntimeProfile,
)
from app.core.logging import get_logger, log_avatar

logger = get_logger(__name__)

#: Modules whose presence changes what this service can do. Probed by name only.
PROBED_MODULES: Final[tuple[str, ...]] = (
    "mlx",
    "mlx.core",
    "torch",
    "tensorrt",
    "onnxruntime",
    "cv2",
    "PIL",
    "aiortc",
    "av",
)

#: How long ``nvidia-smi`` gets before we conclude there is no usable GPU.
NVIDIA_SMI_TIMEOUT_S: Final[float] = 2.0


class Accelerator(StrEnum):
    """What kind of machine this is."""

    APPLE_SILICON = "apple_silicon"
    NVIDIA = "nvidia"
    #: Neither. Perfectly supported — it just means the static portrait path.
    NONE = "none"


def module_available(name: str) -> bool:
    """True if ``name`` is importable, without importing it.

    ``find_spec`` on a dotted name imports the *parent* package, so submodules
    are probed by checking the top-level name first and only then the child.
    """
    top = name.split(".", 1)[0]
    try:
        if importlib.util.find_spec(top) is None:
            return False
        if top == name:
            return True
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError, AttributeError, ModuleNotFoundError):
        # A broken installation (a namespace package with no loader, a stale
        # .egg-link) must read as "absent", never as an exception at boot.
        return False


def _is_apple_silicon() -> bool:
    return sys.platform == "darwin" and _platform.machine() in {"arm64", "aarch64"}


def _nvidia_smi_present() -> bool:
    """Detect an NVIDIA driver without importing torch.

    ``torch.cuda.is_available()`` is the usual test, but it costs a full torch
    import and initialises a CUDA context. ``nvidia-smi`` answers the same
    question — is there a driver and at least one device — for the price of a
    process spawn, and we only ask once per boot.
    """
    binary = shutil.which("nvidia-smi")
    if binary is None:
        return False
    try:
        result = subprocess.run(  # noqa: S603 - fixed binary, no shell, no user input
            [binary, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            timeout=NVIDIA_SMI_TIMEOUT_S,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def _nvidia_device_names() -> tuple[str, ...]:
    binary = shutil.which("nvidia-smi")
    if binary is None:
        return ()
    try:
        result = subprocess.run(  # noqa: S603
            [binary, "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            timeout=NVIDIA_SMI_TIMEOUT_S,
            check=False,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return ()
    if result.returncode != 0:
        return ()
    return tuple(line.strip() for line in result.stdout.splitlines() if line.strip())


def _total_memory_mb() -> float:
    """Physical RAM in MB. 0.0 when it cannot be determined."""
    if sys.platform == "darwin":
        binary = shutil.which("sysctl")
        if binary is not None:
            try:
                result = subprocess.run(  # noqa: S603
                    [binary, "-n", "hw.memsize"],
                    capture_output=True,
                    timeout=NVIDIA_SMI_TIMEOUT_S,
                    check=False,
                    text=True,
                )
                if result.returncode == 0:
                    return float(int(result.stdout.strip())) / (1024 * 1024)
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        pages = os.sysconf("SC_PHYS_PAGES")
        return float(page_size * pages) / (1024 * 1024)
    except (ValueError, OSError, AttributeError):
        return 0.0


@dataclass(frozen=True, slots=True)
class PlatformInfo:
    """Everything §40's ``/capabilities`` and §39's ``/health`` need to answer."""

    accelerator: Accelerator
    system: str
    machine: str
    python_version: str
    total_memory_mb: float
    gpu_names: tuple[str, ...] = ()
    modules: dict[str, bool] = field(default_factory=dict)

    # -- engine availability ----------------------------------------------

    @property
    def has_mlx(self) -> bool:
        return self.accelerator is Accelerator.APPLE_SILICON and self.modules.get("mlx", False)

    @property
    def has_cuda_torch(self) -> bool:
        return self.accelerator is Accelerator.NVIDIA and self.modules.get("torch", False)

    @property
    def has_tensorrt(self) -> bool:
        return self.accelerator is Accelerator.NVIDIA and self.modules.get("tensorrt", False)

    @property
    def has_onnxruntime(self) -> bool:
        return self.modules.get("onnxruntime", False)

    @property
    def has_webrtc(self) -> bool:
        """§38 needs both aiortc and PyAV to put H.264 on a track."""
        return self.modules.get("aiortc", False) and self.modules.get("av", False)

    @property
    def has_image_codec(self) -> bool:
        """§37 JPEG/WebP. Absent, the encoder falls back to stdlib PNG."""
        return self.modules.get("PIL", False) or self.modules.get("cv2", False)

    @property
    def backend_kind(self) -> BackendKind:
        """The backend §66 would pick before benchmarking."""
        if self.has_mlx:
            return BackendKind.MAC_MLX
        if self.has_cuda_torch or self.has_tensorrt:
            return BackendKind.RTX_CUDA
        return BackendKind.STATIC

    @property
    def encoder(self) -> EncoderKind:
        """§36 — VideoToolbox on Mac, NVENC on RTX, software otherwise."""
        if self.accelerator is Accelerator.APPLE_SILICON:
            return EncoderKind.VIDEOTOOLBOX
        if self.accelerator is Accelerator.NVIDIA:
            return EncoderKind.NVENC
        return EncoderKind.SOFTWARE

    def to_json(self) -> dict[str, Any]:
        return {
            "accelerator": self.accelerator.value,
            "system": self.system,
            "machine": self.machine,
            "python": self.python_version,
            "total_memory_mb": round(self.total_memory_mb, 1),
            "gpus": list(self.gpu_names),
            "modules": dict(self.modules),
        }


def detect_platform() -> PlatformInfo:
    """Probe the machine. Never raises."""
    apple = _is_apple_silicon()
    nvidia = (not apple) and _nvidia_smi_present()
    if apple:
        accelerator = Accelerator.APPLE_SILICON
    elif nvidia:
        accelerator = Accelerator.NVIDIA
    else:
        accelerator = Accelerator.NONE

    modules = {name: module_available(name) for name in PROBED_MODULES}
    info = PlatformInfo(
        accelerator=accelerator,
        system=sys.platform,
        machine=_platform.machine(),
        python_version=_platform.python_version(),
        total_memory_mb=_total_memory_mb(),
        gpu_names=_nvidia_device_names() if nvidia else (),
        modules=modules,
    )
    log_avatar(
        logger,
        "avatar.platform.detected",
        platform=accelerator.value,
        backend=info.backend_kind.value,
        encoder=info.encoder.value,
        memory_mb=round(info.total_memory_mb, 1),
    )
    return info


@lru_cache(maxsize=1)
def cached_platform() -> PlatformInfo:
    """Process-wide detection result. Probing twice buys nothing."""
    return detect_platform()


def reset_platform_cache() -> None:
    """Tests only."""
    cached_platform.cache_clear()
    benchmark_render_fps.cache_clear()


# ---------------------------------------------------------------------------
# §66 warm benchmark
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class BenchmarkResult:
    """One §57-shaped micro-benchmark of the local machine."""

    frames: int
    width: int
    height: int
    total_ms: float
    p50_ms: float
    p95_ms: float

    @property
    def avg_fps(self) -> float:
        if self.total_ms <= 0.0:
            return 0.0
        return 1000.0 * self.frames / self.total_ms

    @property
    def sustainable_fps(self) -> float:
        """FPS the machine holds at the *p95* frame, not the average.

        Averages flatter: a runtime that renders 90% of frames in 10ms and 10%
        in 90ms averages out to something respectable while visibly stuttering.
        §40's ``max_recommended_fps`` is a promise, so it is made against p95.
        """
        if self.p95_ms <= 0.0:
            return 0.0
        return 1000.0 / self.p95_ms

    def to_json(self) -> dict[str, Any]:
        return {
            "frames": self.frames,
            "width": self.width,
            "height": self.height,
            "total_ms": round(self.total_ms, 2),
            "p50_ms": round(self.p50_ms, 3),
            "p95_ms": round(self.p95_ms, 3),
            "avg_fps": round(self.avg_fps, 1),
            "sustainable_fps": round(self.sustainable_fps, 1),
        }


def run_render_benchmark(
    *,
    width: int = 512,
    height: int = 512,
    frames: int = 24,
) -> BenchmarkResult:
    """Time the real per-frame CPU work on this machine.

    What is measured is the §22 composite path — mask rasterisation, feather,
    colour statistics and the alpha blend — on a canvas of the requested size.
    That is deliberately *not* a synthetic loop: it is the work every backend
    does on every frame regardless of which engine produced the pixels, so it
    is a true floor for what this machine can sustain. An accelerated backend
    adds engine time on top, which is why :func:`choose_profile` treats the
    result as a ceiling and never as a promise.

    §40: ``max_recommended_fps`` must come from this, never from a constant.
    """
    # Imported here rather than at module scope purely to keep the platform
    # package importable in isolation; both are numpy-only, first-party modules.
    from app.compositor.face_mask import mouth_mask
    from app.compositor.mouth_blend import alpha_blend

    rng = np.random.default_rng(20250905)
    host = rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8).astype(np.float32)
    patch = rng.integers(0, 255, size=(height, width, 3), dtype=np.uint8).astype(np.float32)

    cx, cy = width * 0.5, height * 0.66
    span, rise = width * 0.16, height * 0.055
    angles = np.linspace(0.0, 2.0 * np.pi, 16, endpoint=False)
    landmarks = np.stack([cx + span * np.cos(angles), cy + rise * np.sin(angles)], axis=1)

    durations: list[float] = []
    # One warm pass first (§66 "warm benchmark"): the first call pays for numpy
    # buffer allocation and would otherwise dominate a 24-frame sample.
    mask = mouth_mask(landmarks, height, width)
    alpha_blend(host, patch, mask)

    for index in range(frames):
        # Nudge the landmarks each iteration so nothing can be cached away.
        wobble = 0.4 * np.sin(index * 0.7)
        started = perf_counter()
        mask = mouth_mask(landmarks + wobble, height, width)
        alpha_blend(host, patch, mask)
        durations.append((perf_counter() - started) * 1000.0)

    samples = np.asarray(durations, dtype=np.float64)
    return BenchmarkResult(
        frames=frames,
        width=width,
        height=height,
        total_ms=float(samples.sum()),
        p50_ms=float(np.percentile(samples, 50)),
        p95_ms=float(np.percentile(samples, 95)),
    )


@lru_cache(maxsize=8)
def benchmark_render_fps(width: int = 512, height: int = 512, frames: int = 24) -> BenchmarkResult:
    """Cached :func:`run_render_benchmark`. Called once at startup (§52 warmup)."""
    result = run_render_benchmark(width=width, height=height, frames=frames)
    log_avatar(
        logger,
        "avatar.benchmark.complete",
        width=width,
        height=height,
        frame_count=frames,
        fps=round(result.sustainable_fps, 1),
        duration_ms=round(result.total_ms, 2),
    )
    return result


def max_recommended_fps(
    info: PlatformInfo | None = None,
    *,
    width: int = 512,
    height: int = 512,
    ceiling: int = 30,
) -> int:
    """§40's ``max_recommended_fps``, from a real local benchmark.

    Headroom: only 60% of the measured sustainable rate is promised, because
    the benchmark measures the composite alone on an otherwise idle process,
    while a live session also runs the engines, the encoder, the WebSocket and
    the trainee's browser on the same machine.
    """
    info = info or cached_platform()
    result = benchmark_render_fps(width, height)
    usable = result.sustainable_fps * 0.6
    if info.accelerator is Accelerator.NONE:
        # Static portrait costs far less than the composite benchmark implies,
        # but promising a high rate on a machine with no accelerator invites a
        # 60fps request that nothing else in the stack can serve.
        ceiling = min(ceiling, 25)
    return max(5, min(ceiling, int(usable)))


# ---------------------------------------------------------------------------
# §66 profile selection
# ---------------------------------------------------------------------------

#: §56's profile table, as data.
PROFILES: Final[dict[ProfileName, RuntimeProfile]] = {
    ProfileName.MAC_LOW: RuntimeProfile(
        name=ProfileName.MAC_LOW,
        fps=20,
        mode=RuntimeMode.STATE_BANK,
        precision=Precision.Q8,
        batch_size=4,
        encoder=EncoderKind.VIDEOTOOLBOX,
    ),
    ProfileName.MAC_BALANCED: RuntimeProfile(
        name=ProfileName.MAC_BALANCED,
        fps=25,
        mode=RuntimeMode.STATE_BANK,
        precision=Precision.FP16,
        batch_size=8,
        encoder=EncoderKind.VIDEOTOOLBOX,
    ),
    ProfileName.MAC_HIGH: RuntimeProfile(
        name=ProfileName.MAC_HIGH,
        fps=25,
        mode=RuntimeMode.CONTINUOUS,
        precision=Precision.FP16,
        batch_size=8,
        encoder=EncoderKind.VIDEOTOOLBOX,
    ),
    ProfileName.RTX_BALANCED: RuntimeProfile(
        name=ProfileName.RTX_BALANCED,
        fps=25,
        mode=RuntimeMode.STATE_BANK,
        precision=Precision.FP16,
        batch_size=8,
        encoder=EncoderKind.NVENC,
    ),
    ProfileName.RTX_HIGH: RuntimeProfile(
        name=ProfileName.RTX_HIGH,
        width=720,
        height=720,
        fps=25,
        mode=RuntimeMode.CONTINUOUS,
        precision=Precision.FP16,
        batch_size=16,
        encoder=EncoderKind.NVENC,
    ),
    ProfileName.STATIC: RuntimeProfile(
        name=ProfileName.STATIC,
        fps=25,
        mode=RuntimeMode.STATE_BANK,
        precision=Precision.FP16,
        batch_size=1,
        encoder=EncoderKind.SOFTWARE,
    ),
}


def choose_profile(
    info: PlatformInfo | None = None,
    *,
    benchmark: BenchmarkResult | None = None,
) -> RuntimeProfile:
    """§66 — detect, benchmark, choose. Never raises, always returns a profile."""
    info = info or cached_platform()
    result = benchmark or benchmark_render_fps()
    sustainable = result.sustainable_fps

    if info.accelerator is Accelerator.APPLE_SILICON and info.has_mlx:
        # §26: 16GB is functional verification, 24GB+ is reasonable, 36GB+ is
        # comfortable for both models. Memory decides the rung, the benchmark
        # can only demote it.
        if info.total_memory_mb >= 36_000 and sustainable >= 45:
            chosen = PROFILES[ProfileName.MAC_HIGH]
        elif info.total_memory_mb >= 24_000 and sustainable >= 30:
            chosen = PROFILES[ProfileName.MAC_BALANCED]
        else:
            chosen = PROFILES[ProfileName.MAC_LOW]
    elif info.accelerator is Accelerator.NVIDIA and (info.has_tensorrt or info.has_cuda_torch):
        # §35 is explicit that the RTX first stage is 512×512 / 25fps / state
        # bank — the high profile is opt-in, not what a fast GPU gets by default.
        chosen = (
            PROFILES[ProfileName.RTX_HIGH]
            if info.has_tensorrt and sustainable >= 60
            else PROFILES[ProfileName.RTX_BALANCED]
        )
    else:
        chosen = PROFILES[ProfileName.STATIC]

    log_avatar(
        logger,
        "avatar.profile.chosen",
        platform=info.accelerator.value,
        profile=chosen.name.value,
        target_fps=chosen.fps,
        mode=chosen.mode.value,
        precision=chosen.precision.value,
        fps=round(sustainable, 1),
    )
    return chosen


def degrade(profile: RuntimeProfile) -> RuntimeProfile | None:
    """§65 — one step down the memory ladder. ``None`` at the bottom.

    The ladders themselves live in :mod:`app.platform.mac` and
    :mod:`app.platform.rtx` because they differ: Mac degrades precision and
    frame rate (unified memory, so quantisation is the lever), RTX degrades
    batch size and resolution (dedicated VRAM, so working-set size is).
    """
    from app.platform.mac import degrade_mac
    from app.platform.rtx import degrade_rtx

    if profile.name in {ProfileName.MAC_LOW, ProfileName.MAC_BALANCED, ProfileName.MAC_HIGH}:
        return degrade_mac(profile)
    if profile.name in {ProfileName.RTX_BALANCED, ProfileName.RTX_HIGH}:
        return degrade_rtx(profile)
    return None


__all__ = [
    "NVIDIA_SMI_TIMEOUT_S",
    "PROBED_MODULES",
    "PROFILES",
    "Accelerator",
    "BenchmarkResult",
    "PlatformInfo",
    "benchmark_render_fps",
    "cached_platform",
    "choose_profile",
    "degrade",
    "detect_platform",
    "max_recommended_fps",
    "module_available",
    "reset_platform_cache",
    "run_render_benchmark",
]
