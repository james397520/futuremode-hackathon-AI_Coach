"""NVIDIA RTX specifics (§29–§35, §36, §56, §65, §82).

§65's RTX ladder, in order::

    batch↓
    continuous → state_bank
    resolution↓

Different from Mac's because the constraint is different. VRAM is dedicated and
finite, so the lever is working-set size: halving the §19 micro-batch frees
memory immediately and costs only scheduling efficiency. Continuous mode goes
next. Resolution is last, because §35 already starts at 512×512 and dropping
below that is visible in a UI card.

Precision is *not* on this ladder. §29.2 uses the official MuseTalk 1.5 CUDA
path, whose published configuration is the one that has been validated; §33 and
§34 both warn that the upstream stacks are version-sensitive. Quantising them
locally would mean shipping a configuration nobody upstream has tested.

**不能直接 OOM crash** (§65).
"""

from __future__ import annotations

from typing import Final

from app.core.config import EncoderKind, ProfileName, RuntimeMode, RuntimeProfile

#: §36 — hardware encode on RTX.
ENCODER: Final[EncoderKind] = EncoderKind.NVENC

#: §30 — Ubuntu is the recommended production OS; Windows is a dev platform.
RECOMMENDED_OS: Final[str] = "ubuntu"

#: §33 — FasterLivePortrait's TensorRT path needs the grid_sample plugin and is
#: documented against TensorRT 8.x. Newer is *not* assumed compatible.
TENSORRT_MAJOR_VERIFIED: Final[int] = 8

#: §35 — the first RTX stage, before anything is widened.
STAGE_RESOLUTION: Final[tuple[int, int]] = (512, 512)
#: §65 floor for the resolution step.
MIN_RESOLUTION: Final[tuple[int, int]] = (384, 384)

#: §19 — benchmark 4 / 8 / 16 per platform; 8 is §55's starting point.
BATCH_LADDER: Final[tuple[int, ...]] = (16, 8, 4, 2, 1)


def next_batch_size(current: int) -> int | None:
    """The next smaller batch size on the §19 ladder, or ``None`` at 1."""
    smaller = [size for size in BATCH_LADDER if size < current]
    return max(smaller) if smaller else None


def degrade_rtx(profile: RuntimeProfile) -> RuntimeProfile | None:
    """One rung down the §65 RTX ladder. ``None`` when there is nowhere left."""
    # 1. batch↓
    smaller = next_batch_size(profile.batch_size)
    if smaller is not None:
        return profile.with_changes(batch_size=smaller, name=ProfileName.RTX_BALANCED)

    # 2. continuous → state_bank
    if profile.mode is RuntimeMode.CONTINUOUS:
        return profile.with_changes(
            mode=RuntimeMode.STATE_BANK,
            name=ProfileName.RTX_BALANCED,
        )

    # 3. resolution↓
    min_w, min_h = MIN_RESOLUTION
    if profile.width > min_w or profile.height > min_h:
        stage_w, stage_h = STAGE_RESOLUTION
        if profile.width > stage_w or profile.height > stage_h:
            return profile.with_changes(
                width=stage_w, height=stage_h, name=ProfileName.RTX_BALANCED
            )
        return profile.with_changes(width=min_w, height=min_h, name=ProfileName.RTX_BALANCED)

    return None


def health_fields(*, liveportrait_ready: bool, musetalk_ready: bool) -> dict[str, str]:
    """§39's RTX ``/health`` body fields."""
    return {
        "platform": "rtx_cuda",
        "liveportrait": "tensorrt" if liveportrait_ready else "unavailable",
        "musetalk": "cuda" if musetalk_ready else "unavailable",
        "encoder": ENCODER.value,
    }


#: §31 — why the two engines run as separate workers. Reported in
#: ``/capabilities`` so the topology is discoverable from the API.
WORKER_SPLIT_NOTE: Final[str] = (
    "LivePortrait (TensorRT) and MuseTalk (PyTorch CUDA) run as separate workers "
    "(§31): their CUDA/TensorRT version constraints conflict, and splitting them "
    "keeps upgrades and profiling independent."
)


__all__ = [
    "BATCH_LADDER",
    "ENCODER",
    "MIN_RESOLUTION",
    "RECOMMENDED_OS",
    "STAGE_RESOLUTION",
    "TENSORRT_MAJOR_VERIFIED",
    "WORKER_SPLIT_NOTE",
    "degrade_rtx",
    "health_fields",
    "next_batch_size",
]
