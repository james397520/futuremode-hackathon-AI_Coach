"""Wav2Lip lip sync over ONNX Runtime — the realistic mouth on modest hardware.

Why this exists alongside `mlx_backend`
---------------------------------------
MuseTalk is the spec's choice (§24.2) and produces the better mouth, but it is
out of reach on a machine like an M3 base: measured 62.6 s/frame at q4/batch 1
(see BENCHMARK.md). Wav2Lip is an older, far smaller model that generates only a
96x96 mouth crop, and it measures on the same machine at:

    CoreML  batch 8   9.3 ms/frame   (107 fps)
    CoreML  batch 1  11.8 ms/frame   ( 85 fps)
    CPU     batch 1  27.6 ms/frame   ( 36 fps)

That is ~19% of a 20 fps frame budget on CoreML, and it clears the budget even
on pure CPU. So the ladder is not "MuseTalk or a drawn ellipse" — this sits in
between and is the path that actually runs here.

What it is honest about
-----------------------
Wav2Lip's output is a 96x96 crop. Pasted back at stage resolution it is softer
than the surrounding photo, so `compositor` blends it under a feathered mask
rather than hard-pasting a square. The result is real generated lip motion
driven by audio, not a shape drawn on a still.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import structlog

from app.core.errors import EngineUnavailableError

log = structlog.get_logger(__name__)

MODEL_FILENAME = "wav2lip_gan.onnx"
MODEL_URL = "https://huggingface.co/bluefoxcreation/Wav2lip-Onnx/resolve/main/wav2lip_gan.onnx"

#: Wav2Lip's fixed geometry. Not configurable — the graph is built for it.
FACE_SIZE = 96
MEL_BINS = 80
MEL_WINDOW = 16
#: Audio the mel front-end expects.
SAMPLE_RATE = 16_000


@dataclass(frozen=True, slots=True)
class Wav2LipProbe:
    available: bool
    usable: bool
    reason: str
    ms_per_frame: float | None = None
    provider: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "engine": "wav2lip_onnx",
            "model": MODEL_FILENAME,
            "available": self.available,
            "usable": self.usable,
            "reason": self.reason,
            "ms_per_frame": self.ms_per_frame,
            "provider": self.provider,
        }


def model_path(root: Path) -> Path:
    return root / "models" / MODEL_FILENAME


def is_installed(root: Path) -> bool:
    try:
        import onnxruntime  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return model_path(root).is_file()


def _providers() -> list[str]:
    """CoreML first when present — it is ~3x CPU here — with CPU as the floor."""
    import onnxruntime as ort

    available = set(ort.get_available_providers())
    chosen = [p for p in ("CoreMLExecutionProvider", "CUDAExecutionProvider") if p in available]
    chosen.append("CPUExecutionProvider")
    return chosen


class Wav2LipEngine:
    """Loaded ONNX session plus the crop/paste plumbing around it."""

    name = "wav2lip_onnx"

    def __init__(self, session: Any, provider: str) -> None:
        self._session = session
        self.provider = provider

    @classmethod
    def load(cls, root: Path) -> Wav2LipEngine:
        if not is_installed(root):
            raise EngineUnavailableError(
                f"wav2lip model not found at {model_path(root)}; "
                "run scripts/fetch_wav2lip.py"
            )
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.log_severity_level = 3
        providers = _providers()
        session = ort.InferenceSession(
            str(model_path(root)), sess_options=options, providers=providers
        )
        active = session.get_providers()[0]
        log.info("wav2lip.loaded", provider=active)
        return cls(session, active)

    def generate(self, faces: np.ndarray, mels: np.ndarray) -> np.ndarray:
        """Generate mouth crops.

        `faces` is (N, 96, 96, 3) uint8 — the *masked* lower face stacked with a
        reference frame internally. `mels` is (N, 80, 16) float32.
        Returns (N, 96, 96, 3) uint8.
        """
        if faces.ndim != 4 or faces.shape[1:] != (FACE_SIZE, FACE_SIZE, 3):
            raise ValueError(f"faces must be (N,{FACE_SIZE},{FACE_SIZE},3), got {faces.shape}")
        if mels.shape[1:] != (MEL_BINS, MEL_WINDOW):
            raise ValueError(f"mels must be (N,{MEL_BINS},{MEL_WINDOW}), got {mels.shape}")

        normalised = faces.astype(np.float32) / 255.0
        # Wav2Lip takes 6 channels: the frame with its lower half masked, then
        # the unmasked reference. Masking is what forces the model to synthesise
        # the mouth instead of copying it through.
        masked = normalised.copy()
        masked[:, FACE_SIZE // 2 :, :, :] = 0.0
        stacked = np.concatenate([masked, normalised], axis=3)      # (N,96,96,6)
        vid = np.transpose(stacked, (0, 3, 1, 2)).astype(np.float32)
        mel = mels[:, np.newaxis, :, :].astype(np.float32)

        out = self._session.run(None, {"mel": mel, "vid": vid})[0]   # (N,3,96,96)
        frames = np.transpose(out, (0, 2, 3, 1))
        return np.clip(frames * 255.0, 0, 255).astype(np.uint8)


def probe(root: Path, *, fps: int, budget_fraction: float = 0.4) -> Wav2LipProbe:
    """Measure this host rather than trusting a published figure (§89)."""
    try:
        import onnxruntime  # noqa: F401
    except Exception:  # noqa: BLE001
        return Wav2LipProbe(False, False, "onnxruntime is not installed")
    if not model_path(root).is_file():
        return Wav2LipProbe(False, False, f"model missing at {model_path(root)}")

    budget_ms = (1000.0 / fps) * budget_fraction
    try:
        engine = Wav2LipEngine.load(root)
        faces = np.zeros((4, FACE_SIZE, FACE_SIZE, 3), dtype=np.uint8)
        mels = np.zeros((4, MEL_BINS, MEL_WINDOW), dtype=np.float32)
        engine.generate(faces, mels)                                  # warmup
        start = time.perf_counter()
        engine.generate(faces, mels)
        ms = (time.perf_counter() - start) * 1000.0 / 4
    except Exception as exc:  # noqa: BLE001 - a degrade, never a crash (§53)
        return Wav2LipProbe(True, False, f"probe failed: {exc!r}")

    usable = ms <= budget_ms
    return Wav2LipProbe(
        True,
        usable,
        f"{ms:.1f} ms/frame at {fps} fps (budget {budget_ms:.0f} ms)"
        if usable
        else f"too slow: {ms:.1f} ms/frame against {budget_ms:.0f} ms",
        ms_per_frame=ms,
        provider=engine.provider,
    )
