"""Motion templates (§11, §7, §3.1).

§11's pipeline is offline::

    driver video → motion extractor → motion template → .pkl

and the runtime reuses the ``.pkl``. That is the whole reason Mode A (§3.1) is
fast: the expensive part — extracting expression and pose trajectories from a
3–8 second driving clip — happened once, at avatar-build time, on someone's
workstation.

This module is the *runtime* view of those artefacts: metadata, integrity, and
the frame-indexing that makes a template loop seamlessly. It does **not**
unpickle anything. ``pickle.load`` on a file is arbitrary code execution, and
these files arrive from an asset-preparation step that may run elsewhere; the
engines load their own templates through their own APIs, inside their own
sandboxed process, and this service only ever reads the sidecar metadata.

§11's driving-clip requirements are recorded in :data:`DRIVER_REQUIREMENTS` so
the avatar-preparation script can print them rather than hiding them in a spec.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from app.core.errors import AvatarPrepareFailedError
from app.expression.presets import ExpressionName

#: §11 — what a driving clip must look like for the template to be usable.
DRIVER_REQUIREMENTS: Final[tuple[str, ...]] = (
    "camera fixed",
    "frontal or slightly off-axis",
    "stable lighting",
    "no large movement",
    "natural expression",
    "minimal mouth movement (MuseTalk owns the mouth)",
    "head motion stays inside the UI card",
)

#: §11 — 3–8 seconds per expression.
MIN_DRIVER_SECONDS: Final[float] = 3.0
MAX_DRIVER_SECONDS: Final[float] = 8.0

TEMPLATE_SUFFIX: Final[str] = ".pkl"
SIDECAR_SUFFIX: Final[str] = ".json"


@dataclass(frozen=True, slots=True)
class MotionTemplate:
    """One expression's extracted motion, as the runtime sees it."""

    name: ExpressionName
    path: Path
    frame_count: int
    fps: int
    #: sha256 of the ``.pkl``, recorded at build time (§74 "checksum").
    sha256: str
    #: Which extractor produced it, pinned (§75).
    extractor: str = ""
    extractor_revision: str = ""

    @property
    def duration_s(self) -> float:
        return self.frame_count / float(self.fps) if self.fps else 0.0

    def frame_at(self, index: int) -> int:
        """Loop the template's own frame index. Ping-pong, not wrap-around.

        A wrap jumps from the last frame back to the first, which is a visible
        pop unless the clip was authored as a perfect loop — and §11's driving
        clips are not. Ping-ponging plays the trajectory forwards then
        backwards, so the seam is a change of direction rather than a cut.
        """
        if self.frame_count <= 1:
            return 0
        period = 2 * (self.frame_count - 1)
        position = index % period
        return position if position < self.frame_count else period - position

    def verify(self) -> bool:
        """Recompute the checksum. False on mismatch or a missing file."""
        if not self.sha256 or not self.path.is_file():
            return False
        digest = hashlib.sha256()
        with self.path.open("rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest() == self.sha256

    def to_json(self) -> dict[str, Any]:
        return {
            "name": self.name.value,
            "path": self.path.name,
            "frame_count": self.frame_count,
            "fps": self.fps,
            "sha256": self.sha256,
            "extractor": self.extractor,
            "extractor_revision": self.extractor_revision,
        }


def sidecar_path(template_path: Path) -> Path:
    """``motion/skeptical.pkl`` → ``motion/skeptical.json``."""
    return template_path.with_suffix(SIDECAR_SUFFIX)


def write_sidecar(template: MotionTemplate) -> Path:
    """Record a template's metadata next to it."""
    path = sidecar_path(template.path)
    path.write_text(json.dumps(template.to_json(), indent=2) + "\n", encoding="utf-8")
    return path


def read_sidecar(template_path: Path) -> MotionTemplate:
    """Load a template's metadata. Raises if it is absent or malformed."""
    path = sidecar_path(template_path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise AvatarPrepareFailedError(
            f"motion template '{template_path.stem}' has no metadata sidecar"
        ) from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise AvatarPrepareFailedError(
            f"motion template '{template_path.stem}' has unreadable metadata"
        ) from exc
    try:
        return MotionTemplate(
            name=ExpressionName(raw["name"]),
            path=template_path,
            frame_count=int(raw["frame_count"]),
            fps=int(raw["fps"]),
            sha256=str(raw.get("sha256", "")),
            extractor=str(raw.get("extractor", "")),
            extractor_revision=str(raw.get("extractor_revision", "")),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise AvatarPrepareFailedError(
            f"motion template '{template_path.stem}' metadata is incomplete"
        ) from exc


def discover_templates(motion_dir: Path) -> dict[ExpressionName, MotionTemplate]:
    """Read every ``motion/*.pkl`` that has a valid sidecar.

    Templates without a sidecar are skipped with no error: a half-built avatar
    should start with the expressions it does have (§53's spirit applied to
    assets), not refuse to load at all.
    """
    if not motion_dir.is_dir():
        return {}
    found: dict[ExpressionName, MotionTemplate] = {}
    for path in sorted(motion_dir.glob(f"*{TEMPLATE_SUFFIX}")):
        try:
            template = read_sidecar(path)
        except AvatarPrepareFailedError:
            continue
        found[template.name] = template
    return found


def validate_driver_duration(seconds: float) -> None:
    """§11 — a driving clip must be 3–8 seconds."""
    if not MIN_DRIVER_SECONDS <= seconds <= MAX_DRIVER_SECONDS:
        raise AvatarPrepareFailedError(
            f"driving clip must be {MIN_DRIVER_SECONDS:.0f}-{MAX_DRIVER_SECONDS:.0f}s, "
            f"got {seconds:.1f}s"
        )


__all__ = [
    "DRIVER_REQUIREMENTS",
    "MAX_DRIVER_SECONDS",
    "MIN_DRIVER_SECONDS",
    "SIDECAR_SUFFIX",
    "TEMPLATE_SUFFIX",
    "MotionTemplate",
    "discover_templates",
    "read_sidecar",
    "sidecar_path",
    "validate_driver_duration",
    "write_sidecar",
]
