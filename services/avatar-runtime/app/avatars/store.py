"""On-disk avatar assets (§7) behind a mandatory consent gate (§73 / ADR-010).

The layout is the spec's:

    avatars/<avatar_id>/
        avatar.json
        source/portrait.png
        motion/<expression>.pkl        (only once LivePortrait has run)
        loops/<expression>.mp4         (the prerendered expression bank)
        cache/
        license/consent.json

Two rules are enforced here rather than left to callers, because "we forgot to
check" is exactly how an unlicensed likeness reaches production:

* **No consent record, no load.** `require_consent` defaults on and a missing or
  malformed `license/consent.json` raises rather than warning.
* **A consent record that claims a real person must name who agreed.** A
  synthetic likeness needs no consent holder; a real one does, and a record
  asserting `depicts_real_person` without an owner is treated as incomplete.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog

from app.core.errors import (
    AvatarConsentMissingError,
    AvatarNotFoundError,
    AvatarPrepareFailedError,
)

log = structlog.get_logger(__name__)

CONSENT_RELPATH = Path("license") / "consent.json"
MANIFEST_NAME = "avatar.json"


@dataclass(frozen=True, slots=True)
class ConsentRecord:
    """The §73 provenance record. Absence of this file blocks loading."""

    likeness_kind: str
    depicts_real_person: bool
    owner: str | None
    license: str | None
    created_at: str | None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> ConsentRecord:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise AvatarConsentMissingError(
                f"no consent record at {path}; §73 permits only self-made, "
                "synthetic or consented likenesses"
            ) from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise AvatarConsentMissingError(f"unreadable consent record at {path}: {exc}") from exc

        if not isinstance(raw, dict):
            raise AvatarConsentMissingError(f"consent record at {path} is not an object")

        depicts_real = bool(raw.get("depicts_real_person", True))
        owner = raw.get("owner")
        # A synthetic likeness has nobody to consent. A real one must say who did.
        if depicts_real and not owner:
            raise AvatarConsentMissingError(
                f"consent record at {path} claims a real person but names no owner"
            )

        return cls(
            likeness_kind=str(raw.get("likeness_kind", "unknown")),
            depicts_real_person=depicts_real,
            owner=owner if isinstance(owner, str) else None,
            license=raw.get("license") if isinstance(raw.get("license"), str) else None,
            created_at=raw.get("created_at") if isinstance(raw.get("created_at"), str) else None,
            raw=raw,
        )


@dataclass(frozen=True, slots=True)
class Avatar:
    """A loaded avatar: its manifest, its source portrait, and its provenance."""

    avatar_id: str
    root: Path
    manifest: dict[str, Any]
    consent: ConsentRecord
    portrait_path: Path | None

    @property
    def display_name(self) -> str:
        name = self.manifest.get("display_name")
        return name if isinstance(name, str) and name else self.avatar_id

    @property
    def loops_dir(self) -> Path:
        return self.root / "loops"

    @property
    def has_expression_bank(self) -> bool:
        """True once `build_expression_bank` has produced playable loops.

        Without it the runtime still serves frames — the static backend animates
        the source portrait — so this gates quality, never availability (§53).
        """
        return self.loops_dir.is_dir() and any(self.loops_dir.glob("*.mp4"))

    def to_json(self) -> dict[str, Any]:
        return {
            "avatar_id": self.avatar_id,
            "display_name": self.display_name,
            "has_portrait": self.portrait_path is not None,
            "has_expression_bank": self.has_expression_bank,
            "likeness_kind": self.consent.likeness_kind,
            "expressions": self.manifest.get("expressions", []),
        }


class AvatarStore:
    """Loads avatars from disk with a small LRU of active entries (§64)."""

    def __init__(self, root: Path, *, require_consent: bool = True, max_active: int = 3) -> None:
        self._root = Path(root)
        self._require_consent = require_consent
        self._max_active = max(1, max_active)
        self._active: dict[str, Avatar] = {}

    @property
    def root(self) -> Path:
        return self._root

    def list_ids(self) -> list[str]:
        if not self._root.is_dir():
            return []
        return sorted(p.name for p in self._root.iterdir() if (p / MANIFEST_NAME).is_file())

    def load(self, avatar_id: str) -> Avatar:
        if avatar_id in self._active:
            # Refresh recency without reloading from disk.
            avatar = self._active.pop(avatar_id)
            self._active[avatar_id] = avatar
            return avatar

        root = self._root / avatar_id
        manifest_path = root / MANIFEST_NAME
        if not manifest_path.is_file():
            raise AvatarNotFoundError(f"no avatar {avatar_id!r} under {self._root}")

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AvatarPrepareFailedError(f"unreadable {manifest_path}: {exc}") from exc
        if not isinstance(manifest, dict):
            raise AvatarPrepareFailedError(f"{manifest_path} is not an object")

        consent_path = root / CONSENT_RELPATH
        if self._require_consent:
            consent = ConsentRecord.load(consent_path)
        else:
            # Only reachable when an operator has explicitly disabled the gate.
            try:
                consent = ConsentRecord.load(consent_path)
            except AvatarConsentMissingError:
                log.warning("avatar.consent.bypassed", avatar_id=avatar_id, path=str(consent_path))
                consent = ConsentRecord("unknown", False, None, None, None, {})

        portrait = self._resolve_portrait(root, manifest)
        avatar = Avatar(avatar_id, root, manifest, consent, portrait)

        self._active[avatar_id] = avatar
        while len(self._active) > self._max_active:
            evicted, _ = next(iter(self._active.items()))
            self._active.pop(evicted)
            log.info("avatar.evicted", avatar_id=evicted, max_active=self._max_active)

        log.info(
            "avatar.loaded",
            avatar_id=avatar_id,
            likeness=consent.likeness_kind,
            portrait=bool(portrait),
            expression_bank=avatar.has_expression_bank,
        )
        return avatar

    @staticmethod
    def _resolve_portrait(root: Path, manifest: dict[str, Any]) -> Path | None:
        source = manifest.get("source")
        rel = source.get("image") if isinstance(source, dict) else None
        candidates = [rel] if isinstance(rel, str) else []
        candidates += ["source/portrait.png", "source/portrait.jpg"]
        for candidate in candidates:
            path = root / candidate
            if path.is_file():
                return path
        return None
