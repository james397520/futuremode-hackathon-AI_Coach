"""MuseTalk MLX lip sync, gated on a real measurement of the host (§24.2, §89).

The port and the q4 weights install cleanly on any Apple Silicon Mac. Whether
they are *usable* is a different question, and it is not one this file is
willing to answer from a spec sheet — §89 is explicit that the published
figures are starting configurations, not hardware guarantees, and must be frozen
by benchmark.

Measured on an Apple M3 (10 GPU cores, 8 GB unified), q4, batch 1, 256px face:

    model load        2.8 s
    GPU peak          3.4 GB      (stable; no swapping, no OOM)
    VAE encode        0.96 s      once per avatar, cached (§20)
    UNet per frame    62.6 s      n=6, range 49-85 s, no warmup trend

62.6 s/frame against a 50 ms budget at 20 fps is ~1250x short. The upstream
"~34 faces/sec" figure is an M-series *Max/Ultra* number — those parts carry 40-80
GPU cores against this machine's 10 — so the gap is hardware, not configuration:
no batch size, precision or resolution setting closes three orders of magnitude.

Hence `is_usable()`: the engine self-selects out on hardware that cannot serve it
in realtime, and the orchestrator falls through to the static-portrait backend
without the operator having to know any of the above. On a Max/Ultra or an RTX
box the same code path measures well and switches itself on.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import structlog

from app.core.errors import EngineUnavailableError

log = structlog.get_logger(__name__)

#: A frame must be generated in well under its display interval, or the mouth
#: lags the audio and §17's drift budget is blown on inference alone. 40% of the
#: interval leaves room for VAE decode, compositing, encode and the socket.
REALTIME_BUDGET_FRACTION = 0.4
#: Frames used to measure. Small because a machine that fails does so obviously.
PROBE_FRAMES = 3
#: Loading the weights is pointless below this much unified memory: q4 alone
#: peaks around 3.4 GB and macOS needs its share.
MIN_MEMORY_MB = 12_288

MODEL_REPO = "mlx-community/MuseTalk-1.5-q4"
#: Pinned per §74: a community port must be frozen by SHA, not tracked by branch.
PINNED_PORT_SHA = "c6eb30ebd1ed4d043983209813370153de9346bf"


@dataclass(frozen=True, slots=True)
class MuseTalkProbe:
    """What a real measurement of this host found."""

    available: bool
    usable: bool
    reason: str
    ms_per_frame: float | None = None
    gpu_peak_mb: float | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "engine": "musetalk_mlx",
            "model": MODEL_REPO,
            "port_sha": PINNED_PORT_SHA,
            "available": self.available,
            "usable": self.usable,
            "reason": self.reason,
            "ms_per_frame": self.ms_per_frame,
            "gpu_peak_mb": self.gpu_peak_mb,
        }


def is_installed() -> bool:
    """True when the port and MLX import. Says nothing about speed."""
    import importlib.util

    return all(
        importlib.util.find_spec(m) is not None for m in ("mlx", "mlx.core", "musetalk_mlx")
    )


def probe(*, fps: int, memory_mb: float, face_size: int = 256) -> MuseTalkProbe:
    """Decide whether to use MuseTalk on this machine, by measuring it.

    Never raises: an unusable engine is a degrade, and §53 forbids turning that
    into a failed session.
    """
    if not is_installed():
        return MuseTalkProbe(False, False, "musetalk_mlx or mlx is not installed")
    if memory_mb < MIN_MEMORY_MB:
        # Cheap rejection: q4 peaks near 3.4 GB and this machine would be
        # trading against macOS for the rest.
        return MuseTalkProbe(
            True, False, f"needs >= {MIN_MEMORY_MB} MB unified memory, host has {memory_mb:.0f} MB"
        )

    budget_ms = (1000.0 / fps) * REALTIME_BUDGET_FRACTION
    try:
        import mlx.core as mx
        from huggingface_hub import snapshot_download
        from musetalk_mlx.pipeline_mlx import MuseTalkPipeline

        pipe = MuseTalkPipeline.from_pretrained_mlx(snapshot_download(MODEL_REPO))
        face = np.zeros((face_size, face_size, 3), dtype=np.uint8)
        latent = pipe.get_latents_for_unet(face)
        mx.eval(latent)
        # A silent chunk stack is enough to time the UNet; we are measuring the
        # graph, not the audio.
        chunks = mx.zeros((PROBE_FRAMES, 50, 384))
        stack = mx.repeat(latent, PROBE_FRAMES, axis=0)

        pipe.run_batched(stack[:1], chunks[:1], batch_size=1)   # absorb JIT
        mx.eval(mx.array([0.0]))

        start = time.perf_counter()
        out = pipe.run_batched(stack, chunks, batch_size=1)
        mx.eval(out)
        ms = (time.perf_counter() - start) * 1000.0 / PROBE_FRAMES
        try:
            peak = mx.get_peak_memory() / 1048576
        except Exception:  # noqa: BLE001 - metric only
            peak = None
    except Exception as exc:  # noqa: BLE001 - any load failure is a degrade
        return MuseTalkProbe(True, False, f"probe failed: {exc!r}")

    usable = ms <= budget_ms
    reason = (
        f"{ms:.0f} ms/frame at {fps} fps (budget {budget_ms:.0f} ms)"
        if usable
        else f"too slow: {ms:.0f} ms/frame against a {budget_ms:.0f} ms budget at {fps} fps"
    )
    log.info("musetalk.probe", usable=usable, ms_per_frame=round(ms, 1), gpu_peak_mb=peak)
    return MuseTalkProbe(True, usable, reason, ms_per_frame=ms, gpu_peak_mb=peak)


def load_or_raise(*, fps: int, memory_mb: float) -> Any:
    """Load the pipeline, or raise so the caller can fall through the ladder."""
    result = probe(fps=fps, memory_mb=memory_mb)
    if not result.usable:
        raise EngineUnavailableError(f"musetalk_mlx unusable here: {result.reason}")
    from huggingface_hub import snapshot_download
    from musetalk_mlx.pipeline_mlx import MuseTalkPipeline

    return MuseTalkPipeline.from_pretrained_mlx(snapshot_download(MODEL_REPO))
