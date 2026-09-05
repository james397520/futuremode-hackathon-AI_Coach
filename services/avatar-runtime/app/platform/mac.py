"""Apple Silicon specifics (§24–§28, §36, §56, §65, §81).

Two things live here and nothing else: the §65 Mac memory-degrade ladder, and
the facts about the Mac path that the rest of the service should not have to
know (§25: MLX/Metal workers run host-native, never in Docker; §36: the encoder
is VideoToolbox).

§65's Mac ladder, in order::

    fp16 → q8
    continuous → state_bank
    25fps → 20fps

The order is not arbitrary. Quantisation is the cheapest win on unified memory
and costs the least perceptible quality, so it goes first. Dropping continuous
mode to the state bank is next: it is a large saving and §3.1 says the bank is
the recommended mode anyway. Frame rate is last, because it is the one a
trainee actually notices.

**不能直接 OOM crash** (§65). :func:`degrade_mac` returning ``None`` means the
ladder is exhausted, and the orchestrator's answer to that is the §53 fallback
chain — never an unhandled allocation failure.
"""

from __future__ import annotations

from typing import Final

from app.core.config import EncoderKind, Precision, ProfileName, RuntimeMode, RuntimeProfile

#: §36 — hardware encode on Mac.
ENCODER: Final[EncoderKind] = EncoderKind.VIDEOTOOLBOX

#: §26 development baseline.
MIN_PYTHON: Final[str] = "3.11"
#: §26 — 16GB verifies function; 24GB+ is a reasonable working machine.
MIN_MEMORY_MB: Final[int] = 16_000
COMFORTABLE_MEMORY_MB: Final[int] = 24_000

#: §65 floor. Below this the avatar stops being a talking head.
MIN_FPS: Final[int] = 20

#: §27 — the FasterLivePortrait-MLX runtime profiles, fastest last.
MLX_PROFILES: Final[tuple[str, ...]] = ("quality", "speed", "turbo", "ultra")
#: §54's starting choice.
DEFAULT_MLX_PROFILE: Final[str] = "turbo"

#: §28 — MuseTalk-MLX variants in the order §65 walks them.
PRECISION_LADDER: Final[tuple[Precision, ...]] = (Precision.FP16, Precision.Q8, Precision.Q4)


def next_precision(current: Precision) -> Precision | None:
    """The next quantisation step down, or ``None`` at q4."""
    try:
        index = PRECISION_LADDER.index(current)
    except ValueError:
        return Precision.Q8
    if index + 1 >= len(PRECISION_LADDER):
        return None
    return PRECISION_LADDER[index + 1]


def degrade_mac(profile: RuntimeProfile) -> RuntimeProfile | None:
    """One rung down the §65 Mac ladder. ``None`` when there is nowhere left.

    Each call takes exactly one step, so the orchestrator can degrade, retry,
    and emit one ``avatar.runtime.degraded`` event per step rather than
    collapsing to the floor on the first sign of pressure.
    """
    # 1. fp16 → q8 (→ q4)
    reduced = next_precision(profile.precision)
    if reduced is not None:
        return profile.with_changes(precision=reduced, name=_demote_name(profile.name))

    # 2. continuous → state_bank
    if profile.mode is RuntimeMode.CONTINUOUS:
        return profile.with_changes(
            mode=RuntimeMode.STATE_BANK,
            name=ProfileName.MAC_BALANCED,
        )

    # 3. 25fps → 20fps
    if profile.fps > MIN_FPS:
        return profile.with_changes(fps=MIN_FPS, name=ProfileName.MAC_LOW)

    # 4. Micro-batch is the last lever before the fallback chain takes over.
    if profile.batch_size > 1:
        return profile.with_changes(
            batch_size=max(1, profile.batch_size // 2), name=ProfileName.MAC_LOW
        )

    return None


def _demote_name(name: ProfileName) -> ProfileName:
    if name is ProfileName.MAC_HIGH:
        return ProfileName.MAC_BALANCED
    if name is ProfileName.MAC_BALANCED:
        return ProfileName.MAC_LOW
    return name


def health_fields(*, liveportrait_ready: bool, musetalk_ready: bool) -> dict[str, str]:
    """§39's Mac ``/health`` body fields."""
    return {
        "platform": "mac_mlx",
        "liveportrait": "ready" if liveportrait_ready else "unavailable",
        "musetalk": "ready" if musetalk_ready else "unavailable",
        "encoder": ENCODER.value,
    }


#: §25 — why the MLX worker is not containerised. Surfaced in ``/capabilities``
#: so an operator reading the API sees the constraint without reading the spec.
DOCKER_NOTE: Final[str] = (
    "MLX/Metal workers run host-native on macOS (§25). Redis, PostgreSQL and the "
    "web backend may be containerised; this runtime may not."
)


__all__ = [
    "COMFORTABLE_MEMORY_MB",
    "DEFAULT_MLX_PROFILE",
    "DOCKER_NOTE",
    "ENCODER",
    "MIN_FPS",
    "MIN_MEMORY_MB",
    "MIN_PYTHON",
    "MLX_PROFILES",
    "PRECISION_LADDER",
    "degrade_mac",
    "health_fields",
    "next_precision",
]
