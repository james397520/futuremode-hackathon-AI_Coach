"""Voice selection from the persona's gender and age.

The property that matters is **stability**: a customer whose voice changes
between turns, or between a rehearsal and the assessment of the same persona,
is a bug rather than variety.
"""

from __future__ import annotations

from app.ws.voice_catalog import VOICES, age_band, resolve_voice_id, select_voice_id


def test_the_chosen_voices_are_reachable_by_gender() -> None:
    got = {
        select_voice_id(gender=g, age=a, persona_id="p")
        for g in ("male", "female")
        for a in (24, 45)
    }
    assert got == {v[0] for v in VOICES.values()}
    # One voice per gender, and they differ.
    assert len(got) == 2


def test_young_and_middle_split_at_35() -> None:
    assert age_band(34) == "young"
    assert age_band(35) == "middle"


def test_the_elderly_share_the_middle_aged_voice() -> None:
    assert select_voice_id(gender="male", age=72, persona_id="p") == select_voice_id(
        gender="male", age=45, persona_id="p"
    )


def test_selection_is_stable_across_calls() -> None:
    args = {"gender": "other", "age": None, "persona_id": "per_abc123"}
    assert len({select_voice_id(**args) for _ in range(50)}) == 1


def test_an_unknown_age_is_treated_as_middle_aged() -> None:
    assert select_voice_id(gender="female", age=None, persona_id="p") == VOICES[
        ("female", "middle")
    ][0]


def test_an_explicit_persona_voice_is_never_overridden() -> None:
    persona = {"id": "p1", "gender": "male", "age": 28, "voice": {"voice_id": "chosen-by-hand"}}
    assert resolve_voice_id(persona) == "chosen-by-hand"


def test_a_blank_explicit_voice_falls_back_to_the_table() -> None:
    persona = {"id": "p1", "gender": "male", "age": 28, "voice": {"voice_id": "   "}}
    assert resolve_voice_id(persona) == VOICES[("male", "young")][0]


def test_ungendered_personas_still_get_a_consistent_voice() -> None:
    a = resolve_voice_id({"id": "p1", "age": 40})
    b = resolve_voice_id({"id": "p1", "age": 40})
    assert a == b and a


def test_pinned_persona_carries_gender_so_voice_selection_can_see_it() -> None:
    """Regression: pin() omitted `gender`, so resolve_voice_id fell to the
    ungendered hash and a female persona could get the male voice."""
    from types import SimpleNamespace

    from app.services.session_service import SessionService

    persona = SimpleNamespace(
        id="per_lin", version=1, name="林佳穎", gender="female", age=29, occupation="行銷專員",
        industry="零售", background="", language="zh-TW", locale="zh-TW", traits={},
        voice={"provider": "elevenlabs", "voice_id": None}, avatar_url=None, hidden={},
    )
    scenario = SimpleNamespace(id="sc", version=1, rubric_id=None, knowledge_base_ids=[])
    pinned = SessionService.pin(SessionService.__new__(SessionService), scenario, persona)
    assert pinned.persona["gender"] == "female"
    assert pinned.persona["id"] == "per_lin"
    assert resolve_voice_id(pinned.persona) == VOICES[("female", "young")][0]
