"""Per-avatar preprocessing cache (§20, §7, §64).

§20 lists what is worth keeping per avatar::

    face bbox / landmarks / crop coordinates / parsing mask / blend mask
    reusable latent / frame metadata / source asset hash

and notes that State Bank mode has the highest reuse — which follows: in Mode A
the host frames come from a fixed set of loops, so their geometry never changes
after the first pass.

The cache lives at ``avatars/<id>/cache/`` (§7) and is keyed by the **source
asset hash**. That key is the important part: if someone replaces
``source/portrait.png``, every cached bbox and mask describes a face that is no
longer there, and the composite would paste a mouth into the wrong place. A
hash mismatch discards the cache silently and rebuilds — never an error, since
a stale cache is a performance problem, not a correctness one, as long as it is
detected.

Storage is ``.npz`` via numpy, not pickle. Nothing here ever executes data.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final

import numpy as np

from app.core.logging import get_logger, log_avatar

logger = get_logger(__name__)

CACHE_DIR_NAME: Final[str] = "cache"
GEOMETRY_FILE: Final[str] = "face_geometry.npz"
MANIFEST_FILE: Final[str] = "cache.json"
MASKS_DIR: Final[str] = "masks"
LANDMARKS_DIR: Final[str] = "landmarks"
LATENTS_DIR: Final[str] = "muse_latents"

CACHE_VERSION: Final[int] = 1


def hash_file(path: Path) -> str:
    """sha256 of a file, streamed."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


@dataclass(slots=True)
class FaceGeometry:
    """The §20 per-avatar geometry."""

    #: ``(x, y, w, h)`` face box in source pixels.
    bbox: tuple[int, int, int, int]
    #: ``(N, 2)`` landmarks in source pixels.
    landmarks: np.ndarray
    #: ``(x, y, w, h)`` crop the engines operate in.
    crop: tuple[int, int, int, int]
    #: Optional face-parsing mask, float32 in [0, 1].
    parsing_mask: np.ndarray | None = None
    #: Optional pre-feathered blend mask.
    blend_mask: np.ndarray | None = None
    source_sha256: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_arrays(self) -> dict[str, np.ndarray]:
        arrays: dict[str, np.ndarray] = {
            "bbox": np.asarray(self.bbox, dtype=np.int32),
            "landmarks": np.asarray(self.landmarks, dtype=np.float32),
            "crop": np.asarray(self.crop, dtype=np.int32),
        }
        if self.parsing_mask is not None:
            arrays["parsing_mask"] = self.parsing_mask.astype(np.float32)
        if self.blend_mask is not None:
            arrays["blend_mask"] = self.blend_mask.astype(np.float32)
        return arrays


class AvatarCache:
    """Read/write access to one avatar's ``cache/`` directory."""

    __slots__ = ("_root", "_source_hash")

    def __init__(self, avatar_dir: Path, *, source_hash: str = "") -> None:
        self._root = avatar_dir / CACHE_DIR_NAME
        self._source_hash = source_hash

    @property
    def root(self) -> Path:
        return self._root

    def ensure_dirs(self) -> None:
        for name in ("", MASKS_DIR, LANDMARKS_DIR, LATENTS_DIR):
            (self._root / name if name else self._root).mkdir(parents=True, exist_ok=True)

    # -- manifest ----------------------------------------------------------

    def _manifest_path(self) -> Path:
        return self._root / MANIFEST_FILE

    def read_manifest(self) -> dict[str, Any]:
        try:
            data = json.loads(self._manifest_path().read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return data if isinstance(data, dict) else {}

    def write_manifest(self, **fields: Any) -> None:
        self.ensure_dirs()
        payload = {
            "version": CACHE_VERSION,
            "source_sha256": self._source_hash,
            **fields,
        }
        self._manifest_path().write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def is_valid(self) -> bool:
        """True when the cache belongs to the current source asset."""
        manifest = self.read_manifest()
        if manifest.get("version") != CACHE_VERSION:
            return False
        if not self._source_hash:
            return False
        return manifest.get("source_sha256") == self._source_hash

    # -- geometry ----------------------------------------------------------

    def save_geometry(self, geometry: FaceGeometry) -> Path:
        self.ensure_dirs()
        path = self._root / GEOMETRY_FILE
        np.savez_compressed(path, **geometry.to_arrays())
        self.write_manifest(has_geometry=True, landmark_count=int(len(geometry.landmarks)))
        return path

    def load_geometry(self) -> FaceGeometry | None:
        """Load the cached geometry, or ``None`` if absent or stale."""
        path = self._root / GEOMETRY_FILE
        if not path.is_file() or not self.is_valid():
            return None
        try:
            with np.load(path, allow_pickle=False) as data:
                bbox = tuple(int(v) for v in data["bbox"])
                crop = tuple(int(v) for v in data["crop"])
                geometry = FaceGeometry(
                    bbox=(bbox[0], bbox[1], bbox[2], bbox[3]),
                    landmarks=np.asarray(data["landmarks"], dtype=np.float32),
                    crop=(crop[0], crop[1], crop[2], crop[3]),
                    parsing_mask=(
                        np.asarray(data["parsing_mask"]) if "parsing_mask" in data else None
                    ),
                    blend_mask=np.asarray(data["blend_mask"]) if "blend_mask" in data else None,
                    source_sha256=self._source_hash,
                )
        except (OSError, KeyError, ValueError) as exc:
            # A corrupt cache is a rebuild, not an outage.
            log_avatar(
                logger,
                "avatar.cache.invalid",
                reason=type(exc).__name__,
                available=False,
            )
            return None
        return geometry

    # -- opaque per-frame artefacts ---------------------------------------

    def save_array(self, group: str, name: str, array: np.ndarray) -> Path:
        """Store one array under ``cache/<group>/<name>.npy``."""
        directory = self._root / group
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{name}.npy"
        np.save(path, array)
        return path

    def load_array(self, group: str, name: str) -> np.ndarray | None:
        path = self._root / group / f"{name}.npy"
        if not path.is_file() or not self.is_valid():
            return None
        try:
            return np.load(path, allow_pickle=False)
        except (OSError, ValueError):
            return None

    def invalidate(self) -> None:
        """Drop the manifest so everything reads as stale on the next load.

        The arrays themselves are left alone: they are large, rewriting them is
        the expensive part, and an unreferenced ``.npz`` costs only disk.
        """
        path = self._manifest_path()
        if path.is_file():
            path.unlink()


__all__ = [
    "CACHE_DIR_NAME",
    "CACHE_VERSION",
    "GEOMETRY_FILE",
    "LANDMARKS_DIR",
    "LATENTS_DIR",
    "MANIFEST_FILE",
    "MASKS_DIR",
    "AvatarCache",
    "FaceGeometry",
    "hash_file",
]
