"""ElevenLabs voice selection from the persona's own gender and age.

Why a hard-coded table rather than querying `/voices`: the API key we run with
is permission-scoped and returns 401 for `voices_read`, so the labels
(`labels.gender`, `labels.age`) that automatic matching would need are not
readable at runtime. The mapping is therefore config, kept here where it can be
reviewed, rather than a lookup that would fail on every session.

**Selection is stable, not random.** The obvious reading of "pick a voice for the
persona" is `random.choice`, and it is wrong: a customer whose voice changes
between turns — or between a rehearsal and the assessment of the same persona —
is a bug, not variety. When a bucket holds more than one voice the choice is
made by hashing the persona id, so it is arbitrary across personas but fixed for
any given one.

An explicit `voice_id` on the persona always wins. This is a default, not a
policy: a persona author who picked a voice deliberately must not be overridden.
"""

from __future__ import annotations

import hashlib
from typing import Literal

AgeBand = Literal["young", "middle"]

#: Below this age a persona sounds young; at or above it, middle-aged.
YOUNG_MAX_AGE = 35

#: Supplied by the team. Seniors deliberately share the middle-aged voices —
#: there is no separate older voice, and stretching a young one to play a
#: 70-year-old sounds worse than simply using the mature voice.
VOICES: dict[tuple[str, AgeBand], tuple[str, ...]] = {
    ("male", "young"): ("fQj4gJSexpu8RDE2Ii5m",),
    ("female", "young"): ("NIqnuIdrAT3LLSSxN05L",),
    ("male", "middle"): ("SoLCar3sKHqXqvJc7jmm",),
    ("female", "middle"): ("Z8Aisvg1z70p27kGvkZZ",),
}

#: Used when the persona declares no gender, or declares "other". Both
#: middle-aged voices are candidates and the persona id decides, so an
#: unspecified persona still gets a consistent voice instead of a default one.
UNGENDERED_FALLBACK: tuple[str, ...] = (
    "SoLCar3sKHqXqvJc7jmm",
    "Z8Aisvg1z70p27kGvkZZ",
)


def age_band(age: int | None) -> AgeBand:
    """Ages at or above `YOUNG_MAX_AGE` — including the elderly — are 'middle'."""
    if age is None:
        return "middle"
    return "young" if age < YOUNG_MAX_AGE else "middle"


def _stable_index(seed: str, size: int) -> int:
    """Deterministic index from a seed. Not `hash()`: that is salted per process,
    so the same persona would get a different voice after every API restart."""
    if size <= 1:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % size


def select_voice_id(
    *,
    gender: str | None,
    age: int | None,
    persona_id: str = "",
) -> str:
    """Pick the voice for a persona. Same inputs always give the same voice."""
    band = age_band(age)
    candidates = VOICES.get((str(gender or ""), band)) or UNGENDERED_FALLBACK
    return candidates[_stable_index(persona_id or f"{gender}:{band}", len(candidates))]


def resolve_voice_id(persona: dict[str, object] | None) -> str:
    """Voice for a pinned persona snapshot, honouring an explicit choice."""
    persona = persona or {}
    voice = persona.get("voice")
    if isinstance(voice, dict):
        explicit = voice.get("voice_id")
        if isinstance(explicit, str) and explicit.strip():
            return explicit.strip()

    age = persona.get("age")
    return select_voice_id(
        gender=persona.get("gender") if isinstance(persona.get("gender"), str) else None,
        age=age if isinstance(age, int) else None,
        persona_id=str(persona.get("id") or persona.get("name") or ""),
    )
