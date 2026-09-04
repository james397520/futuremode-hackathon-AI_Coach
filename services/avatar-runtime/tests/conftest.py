"""Shared fixtures. Nothing here touches the network or a model file."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest


@pytest.fixture
def portrait() -> np.ndarray:
    """A deterministic stand-in for a §71 portrait."""
    rng = np.random.default_rng(1234)
    base = np.full((1024, 1024, 3), 220, dtype=np.uint8)
    # A little structure so "did the frame change" assertions are meaningful.
    base[300:700, 300:700] = rng.integers(120, 200, (400, 400, 3), dtype=np.uint8)
    return base


def _write_avatar(root: Path, avatar_id: str, consent: dict) -> Path:
    d = root / avatar_id
    (d / "source").mkdir(parents=True)
    (d / "license").mkdir(parents=True)
    (d / "avatar.json").write_text(
        json.dumps({"avatar_id": avatar_id, "display_name": avatar_id,
                    "source": {"image": "source/portrait.png"}}),
        encoding="utf-8",
    )
    (d / "license" / "consent.json").write_text(json.dumps(consent), encoding="utf-8")
    return d


@pytest.fixture
def avatars_dir(tmp_path: Path) -> Path:
    root = tmp_path / "avatars"
    root.mkdir()
    _write_avatar(root, "synthetic_ok", {
        "likeness_kind": "synthetic", "depicts_real_person": False, "owner": None,
    })
    _write_avatar(root, "real_with_owner", {
        "likeness_kind": "photo", "depicts_real_person": True, "owner": "Example Ltd",
        "license": "model release 2026-01",
    })
    _write_avatar(root, "real_no_owner", {
        "likeness_kind": "photo", "depicts_real_person": True, "owner": None,
    })
    # Deliberately has no license/consent.json at all.
    bare = root / "no_consent"
    (bare / "source").mkdir(parents=True)
    (bare / "avatar.json").write_text(json.dumps({"avatar_id": "no_consent"}), encoding="utf-8")
    return root
