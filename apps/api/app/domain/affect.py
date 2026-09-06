"""Trainee affect — two independent signals and the deterministic fusion of them.

Two things watch the trainee, and they are not equally trustworthy:

* **Text** (`TextAffect`) — the `AffectAgent` reads what the trainee actually
  typed or said, and must cite a verbatim quote from that turn. It is auditable:
  every reading can be traced to words in the transcript.
* **Face** (`FaceAffect`) — the browser's MediaPipe blendshape rule engine
  (`emotion_webcam`, ported to TypeScript). It is *advisory* in the strict
  sense: it arrives over the socket from an untrusted client, its weights are
  hand-tuned from FACS common sense with no calibration against labelled data,
  and it carries no evidence anyone can check.

So the fusion is deliberately asymmetric. Agreement raises confidence; a face
reading fills a silent text reading; but when the two genuinely disagree the
**text wins and the disagreement is recorded** rather than averaged away. An
averaged label would be the one thing nobody could defend in a review.

Fusion is plain arithmetic on purpose — no second model call. A model asked to
reconcile two labels invents a third.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.domain.common import DomainModel

#: The team's six-label space (`backend/app/schemas.py::EmotionContent`), kept
#: verbatim so readings from either system are directly comparable.
AffectLabel = Literal["平穩", "緊張", "苦惱", "挫折", "正向", "不明確"]
AffectIntensity = Literal["low", "medium", "high", "unknown"]

#: The browser classifier's eight labels mapped into the six above. `surprised`
#: has no counterpart — surprise is not an attitude toward the conversation —
#: so it maps to 不明確 rather than being forced into 緊張.
FACE_TO_LABEL: dict[str, AffectLabel] = {
    "neutral": "平穩",
    "happy": "正向",
    "sad": "挫折",
    # 苦惱, not 不耐煩. These three rules fire on a brow-lowered, mouth-tightened
    # face, and on the *trainee* that reads as someone struggling with what they
    # just heard, not someone impatient with the customer. The label is shown
    # over their own picture and drives an offer of help, so it has to name the
    # state the offer answers.
    "angry": "苦惱",
    "disgusted": "苦惱",
    "contempt": "苦惱",
    "fearful": "緊張",
    "surprised": "不明確",
}

#: Below this the face reading is treated as absent. The classifier always
#: returns *something* (its top rule, whatever it scored), so a floor here is
#: what separates "the face said calm" from "the face said nothing useful".
#:
#: Kept in step with `CustomerAgent.FACE_REACT_MIN_CONFIDENCE` and the inline
#: nudge's own floor. They must agree: a frown strong enough to offer the
#: trainee help, but not strong enough to reach the customer, produces a hint
#: card about an expression nobody in the conversation reacted to.
FACE_MIN_CONFIDENCE = 0.25

_INTENSITY_WEIGHT: dict[str, float] = {
    "high": 0.9,
    "medium": 0.65,
    "low": 0.4,
    "unknown": 0.0,
}


class TextAffect(DomainModel):
    """One turn of trainee language, read by the `AffectAgent`."""

    label: AffectLabel = "不明確"
    intensity: AffectIntensity = "unknown"
    #: Verbatim from the trainee's own turn. Enforced server-side, not trusted.
    evidence_quote: str = ""
    reason: str = ""
    #: One line on how to communicate better — the only advisory field.
    suggestion: str = ""


class FaceAffect(DomainModel):
    """The browser's facial reading. Client-supplied, therefore untrusted."""

    #: Raw classifier label, before mapping. Kept so the UI can show the face.
    raw_label: str = ""
    label: AffectLabel = "不明確"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    at_ms: int = 0


class TraineeAffect(DomainModel):
    """The fused reading, plus both inputs so a reviewer can see the working."""

    label: AffectLabel = "不明確"
    intensity: AffectIntensity = "unknown"
    #: 0–1. Agreement raises it; a lone signal lowers it.
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    #: True when text and face each had something to say and said different things.
    conflict: bool = False
    #: Which signal the label came from.
    source: Literal["text", "face", "both", "none"] = "none"
    text: TextAffect | None = None
    face: FaceAffect | None = None
    evidence_quote: str = ""
    suggestion: str = ""


def fuse_affect(text: TextAffect | None, face: FaceAffect | None) -> TraineeAffect:
    """Combine the two signals. Deterministic; see the module docstring."""
    text_speaks = text is not None and text.label != "不明確" and text.intensity != "unknown"
    face_speaks = (
        face is not None
        and face.confidence >= FACE_MIN_CONFIDENCE
        and face.label != "不明確"
    )

    base = TraineeAffect(text=text, face=face)

    if not text_speaks and not face_speaks:
        # Neither signal has evidence. Say so rather than defaulting to calm:
        # "平穩" is a claim, and an unevidenced one is worse than silence.
        return base.model_copy(update={"label": "不明確", "source": "none", "confidence": 0.0})

    if text_speaks and not face_speaks:
        assert text is not None
        return base.model_copy(
            update={
                "label": text.label,
                "intensity": text.intensity,
                "confidence": round(_INTENSITY_WEIGHT[text.intensity] * 0.85, 3),
                "source": "text",
                "evidence_quote": text.evidence_quote,
                "suggestion": text.suggestion,
            }
        )

    if face_speaks and not text_speaks:
        assert face is not None
        # A face-only reading is capped: it has no quote behind it, so it may
        # colour the UI but must never look as certain as an evidenced one.
        return base.model_copy(
            update={
                "label": face.label,
                "intensity": "low",
                "confidence": round(min(face.confidence, 0.6), 3),
                "source": "face",
            }
        )

    assert text is not None and face is not None
    if text.label == face.label:
        # Independent agreement is the one case that earns real confidence.
        combined = _INTENSITY_WEIGHT[text.intensity] * 0.6 + face.confidence * 0.4
        return base.model_copy(
            update={
                "label": text.label,
                "intensity": text.intensity,
                "confidence": round(min(1.0, combined + 0.15), 3),
                "source": "both",
                "evidence_quote": text.evidence_quote,
                "suggestion": text.suggestion,
            }
        )

    # Genuine disagreement: keep the auditable signal, record the conflict, and
    # drop confidence so nothing downstream treats it as settled.
    return base.model_copy(
        update={
            "label": text.label,
            "intensity": text.intensity,
            "confidence": round(_INTENSITY_WEIGHT[text.intensity] * 0.5, 3),
            "conflict": True,
            "source": "text",
            "evidence_quote": text.evidence_quote,
            "suggestion": text.suggestion,
        }
    )


def face_from_command(payload: dict[str, object] | None) -> FaceAffect | None:
    """Build a `FaceAffect` from the client's `trainee.affect` command."""
    if not payload:
        return None
    raw = str(payload.get("label") or "")
    if not raw:
        return None
    try:
        confidence = float(payload.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    return FaceAffect(
        raw_label=raw,
        label=FACE_TO_LABEL.get(raw, "不明確"),
        confidence=max(0.0, min(1.0, confidence)),
        at_ms=int(payload.get("at_ms") or 0),
    )
