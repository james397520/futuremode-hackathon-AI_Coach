"""Fusion of the two trainee-affect signals.

The asymmetry is the point: text is auditable (it must quote the trainee's own
words), the face reading is an uncalibrated client-supplied guess. These tests
pin that asymmetry down so a later "simplification" cannot quietly average the
two into a label nobody can defend.
"""

from __future__ import annotations

from app.domain.affect import FaceAffect, TextAffect, face_from_command, fuse_affect


def text(label: str, intensity: str = "medium", quote: str = "我不確定") -> TextAffect:
    return TextAffect(label=label, intensity=intensity, evidence_quote=quote)


def face(label: str, confidence: float) -> FaceAffect:
    return face_from_command({"label": label, "confidence": confidence, "at_ms": 1})


def test_neither_signal_speaks_is_unclear_not_calm() -> None:
    fused = fuse_affect(None, None)
    assert fused.label == "不明確"
    assert fused.source == "none"
    assert fused.confidence == 0.0


def test_text_alone_carries_its_quote() -> None:
    fused = fuse_affect(text("緊張", "high", "我有點怕講錯"), None)
    assert (fused.label, fused.source) == ("緊張", "text")
    assert fused.evidence_quote == "我有點怕講錯"
    assert fused.confidence > 0.5


def test_face_alone_is_capped_and_has_no_quote() -> None:
    fused = fuse_affect(None, face("happy", 0.95))
    assert (fused.label, fused.source) == ("正向", "face")
    assert fused.evidence_quote == ""
    # No evidence behind it, so it must never look as certain as a text reading.
    assert fused.confidence <= 0.6


def test_a_weak_face_reading_counts_as_silence() -> None:
    fused = fuse_affect(None, face("angry", 0.2))
    assert fused.source == "none"


def test_agreement_beats_either_signal_alone() -> None:
    alone = fuse_affect(text("苦惱", "medium"), None)
    together = fuse_affect(text("苦惱", "medium"), face("angry", 0.8))
    assert together.source == "both"
    assert together.confidence > alone.confidence
    assert together.conflict is False


def test_disagreement_keeps_the_auditable_signal_and_records_it() -> None:
    fused = fuse_affect(text("正向", "high", "太好了"), face("angry", 0.9))
    # Text wins: it is the one with a quote a reviewer can check.
    assert fused.label == "正向"
    assert fused.source == "text"
    assert fused.conflict is True
    # ...but confidence drops, so nothing downstream treats it as settled.
    assert fused.confidence < fuse_affect(text("正向", "high", "太好了"), None).confidence


def test_unclear_text_defers_to_a_confident_face() -> None:
    fused = fuse_affect(text("不明確", "unknown", ""), face("sad", 0.7))
    assert (fused.label, fused.source) == ("挫折", "face")


def test_surprise_has_no_counterpart_and_does_not_become_nervous() -> None:
    assert face("surprised", 0.9).label == "不明確"
    assert fuse_affect(None, face("surprised", 0.9)).source == "none"


def test_client_payload_is_clamped() -> None:
    assert face("happy", 9.0).confidence == 1.0
    assert face("happy", -3.0).confidence == 0.0
    assert face_from_command({"label": "", "confidence": 1.0}) is None
    assert face_from_command(None) is None


def test_an_unknown_client_label_is_not_guessed_at() -> None:
    assert face("smug", 0.9).label == "不明確"
