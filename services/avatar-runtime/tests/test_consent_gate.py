"""§73 / ADR-010 — only self-made, synthetic or consented likenesses may load.

These are the tests that stop an unlicensed face reaching a deployment. They are
about provenance, not pixels.
"""

from __future__ import annotations

import pytest

from app.avatars.store import AvatarStore
from app.core.errors import AvatarConsentMissingError, AvatarNotFoundError


def test_synthetic_likeness_needs_no_consent_holder(avatars_dir):
    avatar = AvatarStore(avatars_dir).load("synthetic_ok")
    assert avatar.consent.depicts_real_person is False
    assert avatar.consent.likeness_kind == "synthetic"


def test_real_person_with_a_named_owner_loads(avatars_dir):
    avatar = AvatarStore(avatars_dir).load("real_with_owner")
    assert avatar.consent.owner == "Example Ltd"


def test_real_person_without_an_owner_is_refused(avatars_dir):
    """Claiming a real likeness while naming nobody is an incomplete record."""
    with pytest.raises(AvatarConsentMissingError, match="names no owner"):
        AvatarStore(avatars_dir).load("real_no_owner")


def test_missing_consent_file_is_refused(avatars_dir):
    with pytest.raises(AvatarConsentMissingError):
        AvatarStore(avatars_dir).load("no_consent")


def test_unknown_avatar_is_not_a_consent_error(avatars_dir):
    """A typo must not look like a licensing problem."""
    with pytest.raises(AvatarNotFoundError):
        AvatarStore(avatars_dir).load("nope")


def test_lru_evicts_beyond_max_active(avatars_dir):
    store = AvatarStore(avatars_dir, max_active=1)
    store.load("synthetic_ok")
    store.load("real_with_owner")
    assert len(store._active) == 1  # noqa: SLF001 - the eviction is the behaviour under test
