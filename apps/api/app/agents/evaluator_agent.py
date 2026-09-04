"""Evaluator Agent — evidence-based scoring (spec §19.6, §26, §27, §28).

Spec §27 forbids a bare number: every dimension must expand into a quote from the
real transcript with a timestamp, the issue, and a better approach. This module makes
that a *verified* property rather than a prompt request:

`_verify_evidence()` checks each returned quote against the actual transcript turns.
A quote that does not appear verbatim (after NFKC/whitespace folding) in a turn the
model attributed it to is **dropped**. A dimension left with no evidence is rewritten:

    evidence = []                      -> nothing invented
    confidence <= LOW_CONFIDENCE (0.3) -> the caller can grey it out
    score      -> neutral 45–55 band   -> no unearned praise, no unearned penalty
    rubric_note -> "缺少可評估此維度的行為證據"

That is the behaviour `tests/test_evaluator.py` pins: **no evidence ⇒ low confidence,
never a fabricated quote.**
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Final

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import ModelPurpose
from app.agents.patterns import fold, normalize
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.evaluator import NO_EVIDENCE_NOTE, evaluator_system_prompt
from app.agents.prompts.knowledge import localised

log = structlog.get_logger(__name__)

#: Mirrors `SKILL_KEYS` in packages/shared-types/src/entities.ts (§26.1). Kept as a
#: local tuple so the ten dimensions cannot drift silently if `app.domain` renames
#: its enum; the values are identical strings.
SKILL_KEYS: Final[tuple[str, ...]] = (
    "professional_knowledge",
    "empathy",
    "needs_discovery",
    "communication_clarity",
    "objection_handling",
    "trust_building",
    "product_knowledge",
    "compliance",
    "closing_ability",
    "goal_achievement",
)

LOW_CONFIDENCE: Final = 0.3
NEUTRAL_SCORE: Final = 50
NEUTRAL_BAND: Final = (45, 55)
#: A quote shorter than this is not distinctive enough to verify meaningfully.
MIN_QUOTE_CHARS: Final = 4


class TranscriptRef(BaseModel):
    """A real transcript turn — the only legal source of an evidence quote."""

    model_config = ConfigDict(extra="forbid")

    id: str
    speaker: str
    text: str
    timestamp_ms: int = 0


class EvidenceDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timestamp_ms: int = 0
    transcript_turn_ids: list[str] = Field(default_factory=list)
    quote: str = ""
    issue: str | None = None
    better_approach: str | None = None


class SkillScoreDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    skill: str
    score: int = Field(default=NEUTRAL_SCORE, ge=0, le=100)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    rubric_note: str = ""
    evidence: list[EvidenceDraft] = Field(default_factory=list)
    improvement_suggestion: str = ""


class EvaluationDraft(BaseModel):
    """Structured evaluation — mirrors the `Evaluation` entity's scoring fields."""

    model_config = ConfigDict(extra="forbid")

    skills: list[SkillScoreDraft] = Field(default_factory=list)
    overall_score: int = Field(default=0, ge=0, le=100)
    goal_achieved: bool = False
    passed: bool = False
    key_strength: str = ""
    main_improvement: str = ""
    compliance_status: str = "safe"
    #: how many model-supplied quotes were rejected as unverifiable
    rejected_quotes: int = 0
    dimensions_without_evidence: list[str] = Field(default_factory=list)


class TurnObservation(BaseModel):
    """Per-turn evidence accumulated live, so final scoring is cheap and grounded."""

    model_config = ConfigDict(extra="forbid")

    turn_id: str
    timestamp_ms: int
    speaker: str
    text: str
    signals: list[str] = Field(default_factory=list)
    citations: int = 0
    compliance_severity: str = "safe"
    intent_label: str = ""
    #: skill -> observed delta, used as a prior and to spot dimensions with no data
    skill_hints: dict[str, int] = Field(default_factory=dict)


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transcript: list[TranscriptRef] = Field(default_factory=list)
    observations: list[TurnObservation] = Field(default_factory=list)
    locale: str = "zh-TW"
    mode: str = "training"
    rubric_weights: dict[str, float] = Field(default_factory=dict)
    pass_threshold: int = 60
    required_evidence: list[str] = Field(default_factory=list)
    forbidden_behaviors: list[str] = Field(default_factory=list)
    learning_objectives: list[str] = Field(default_factory=list)
    success_condition: str = ""
    compliance_findings: list[dict[str, Any]] = Field(default_factory=list)
    custom_skills: list[dict[str, Any]] = Field(default_factory=list)


#: Which turn signals count as observed behaviour for which dimension (§26.1). Used to
#: build the live prior and — crucially — to know whether a dimension had *any* chance
#: of being observed at all.
SIGNAL_TO_SKILL: Final[dict[str, tuple[str, int]]] = {
    "empathy": ("empathy", +8),
    "acknowledged_family_pressure": ("trust_building", +12),
    "needs_question": ("needs_discovery", +8),
    "evidence_provided": ("professional_knowledge", +8),
    "product_explanation": ("product_knowledge", +6),
    "objection_addressed": ("objection_handling", +10),
    "objection_ignored": ("objection_handling", -10),
    "overselling": ("trust_building", -10),
    "closing_attempt": ("closing_ability", +8),
    "agreement": ("goal_achievement", +15),
    "compliance_risk": ("compliance", -25),
    "off_topic": ("communication_clarity", -6),
}


class EvaluatorAgent(Agent[EvaluationRequest, EvaluationDraft]):
    name = "evaluator"
    purpose = ModelPurpose.EVALUATOR
    output_model = EvaluationDraft
    optional = True
    default_temperature = 0.0
    default_max_tokens = 3000

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.observations: list[TurnObservation] = []

    # -- live accumulation -------------------------------------------------
    def observe_turn(
        self,
        *,
        turn_id: str,
        timestamp_ms: int,
        speaker: str,
        text: str,
        signals: Sequence[str] = (),
        citations: int = 0,
        compliance_severity: str = "safe",
        intent_label: str = "",
    ) -> TurnObservation:
        """Accumulate per-turn evidence during the session (spec §19.6).

        Deterministic and model-free: this is the audit trail the final scoring pass
        is checked against.
        """
        hints: dict[str, int] = {}
        for signal in signals:
            mapping = SIGNAL_TO_SKILL.get(str(signal))
            if mapping is None:
                continue
            skill, delta = mapping
            hints[skill] = hints.get(skill, 0) + delta
        if citations:
            hints["professional_knowledge"] = hints.get("professional_knowledge", 0) + 4
        observation = TurnObservation(
            turn_id=turn_id,
            timestamp_ms=timestamp_ms,
            speaker=speaker,
            text=text,
            signals=[str(s) for s in signals],
            citations=citations,
            compliance_severity=compliance_severity,
            intent_label=intent_label,
            skill_hints=hints,
        )
        self.observations.append(observation)
        return observation

    def live_scores(self) -> dict[str, int]:
        """Running score per dimension for the optional live score panel (§23)."""
        scores = {skill: NEUTRAL_SCORE for skill in SKILL_KEYS}
        for observation in self.observations:
            for skill, delta in observation.skill_hints.items():
                if skill in scores:
                    scores[skill] = max(0, min(100, scores[skill] + delta))
        return scores

    def observed_skills(self) -> set[str]:
        return {
            skill
            for observation in self.observations
            for skill in observation.skill_hints
        }

    # -- prompts -----------------------------------------------------------
    def system_prompt(self) -> str:
        return evaluator_system_prompt(self.locale)

    def build_user_prompt(self, request: EvaluationRequest) -> str:
        transcript = "\n".join(
            f"[{turn.id}] {turn.timestamp_ms}ms {turn.speaker}: {turn.text}"
            for turn in request.transcript
        )
        return "\n\n".join(
            [
                data_block(
                    "rubric",
                    {
                        "weights": request.rubric_weights or {k: 1.0 for k in SKILL_KEYS},
                        "pass_threshold": request.pass_threshold,
                        "required_evidence": request.required_evidence,
                        "forbidden_behaviors": request.forbidden_behaviors,
                        "custom_skills": request.custom_skills,
                    },
                ),
                data_block(
                    "objectives",
                    {
                        "learning_objectives": request.learning_objectives,
                        "success_condition": request.success_condition,
                    },
                ),
                data_block(
                    "compliance_findings",
                    [
                        {
                            "type": f.get("type"),
                            "severity": f.get("severity"),
                            "evidence": f.get("evidence"),
                        }
                        for f in request.compliance_findings
                    ],
                ),
                data_block(
                    "per_turn_observations",
                    [
                        {
                            "turn_id": o.turn_id,
                            "at_ms": o.timestamp_ms,
                            "signals": o.signals,
                            "citations": o.citations,
                        }
                        for o in (request.observations or self.observations)
                    ],
                ),
                untrusted_block("transcript", transcript, max_chars=20000),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    async def run(self, request: EvaluationRequest) -> EvaluationDraft:
        draft = await self._invoke_structured(self._messages(request))
        return self.finalise(draft, request)

    # -- verification ------------------------------------------------------
    def finalise(self, draft: EvaluationDraft, request: EvaluationRequest) -> EvaluationDraft:
        by_id = {turn.id: turn for turn in request.transcript}
        haystacks = {turn.id: fold(turn.text) for turn in request.transcript}
        trainee_ids = {t.id for t in request.transcript if t.speaker == "trainee"}
        rejected = 0
        skills: dict[str, SkillScoreDraft] = {}

        for skill_score in draft.skills:
            skill = str(skill_score.skill)
            verified, dropped = self._verify_evidence(
                skill_score.evidence, by_id, haystacks, trainee_ids
            )
            rejected += dropped
            skills[skill] = skill_score.model_copy(update={"evidence": verified})

        # every dimension must be present, even if the model skipped it
        observed = self.observed_skills() | {
            skill
            for observation in request.observations
            for skill in observation.skill_hints
        }
        priors = self.live_scores()
        for skill in SKILL_KEYS:
            skills.setdefault(
                skill,
                SkillScoreDraft(skill=skill, score=priors.get(skill, NEUTRAL_SCORE), confidence=0.0),
            )

        no_evidence: list[str] = []
        finalised: list[SkillScoreDraft] = []
        for skill in [*SKILL_KEYS, *(k for k in skills if k not in SKILL_KEYS)]:
            item = skills[skill]
            if item.evidence:
                finalised.append(item)
                continue
            no_evidence.append(skill)
            note = item.rubric_note.strip()
            marker = localised(NO_EVIDENCE_NOTE, request.locale)
            finalised.append(
                item.model_copy(
                    update={
                        "evidence": [],
                        "confidence": min(item.confidence, LOW_CONFIDENCE),
                        "score": self._neutralise(item.score, observed_hint=skill in observed),
                        "rubric_note": marker if not note else f"{marker}（{note}）",
                    }
                )
            )

        overall = self._weighted_overall(finalised, request.rubric_weights)
        compliance_status = self._compliance_status(request.compliance_findings)
        result = draft.model_copy(
            update={
                "skills": finalised,
                "overall_score": overall,
                "passed": overall >= request.pass_threshold
                and compliance_status not in ("high", "critical"),
                "compliance_status": compliance_status,
                "rejected_quotes": rejected,
                "dimensions_without_evidence": no_evidence,
            }
        )
        if rejected:
            log.warning("evaluator.rejected_quotes", count=rejected)
        return result

    @staticmethod
    def _verify_evidence(
        evidence: Sequence[EvidenceDraft],
        by_id: Mapping[str, TranscriptRef],
        haystacks: Mapping[str, str],
        trainee_ids: set[str],
    ) -> tuple[list[EvidenceDraft], int]:
        """Keep only quotes that really exist in the turns they are attributed to."""
        kept: list[EvidenceDraft] = []
        dropped = 0
        for item in evidence:
            quote = normalize(item.quote)
            folded_quote = fold(quote)
            if len(folded_quote) < MIN_QUOTE_CHARS:
                dropped += 1
                continue
            ids = [tid for tid in item.transcript_turn_ids if tid in by_id]
            matching = [tid for tid in ids if folded_quote in haystacks[tid]]
            if not matching:
                # The model may have quoted a real line but mis-attributed the turn id;
                # accept it only if the quote exists verbatim somewhere, and repair the
                # id. Otherwise it is a fabrication and must go.
                matching = [tid for tid, hay in haystacks.items() if folded_quote in hay]
                if not matching:
                    dropped += 1
                    continue
            anchor = by_id[matching[0]]
            kept.append(
                item.model_copy(
                    update={
                        "quote": quote,
                        "transcript_turn_ids": matching,
                        "timestamp_ms": item.timestamp_ms or anchor.timestamp_ms,
                    }
                )
            )
        # evidence about the trainee's own behaviour is the point of §27; keep the
        # customer quotes too (they carry the missed signal) but put trainee first
        kept.sort(key=lambda e: 0 if set(e.transcript_turn_ids) & trainee_ids else 1)
        return kept, dropped

    @staticmethod
    def _neutralise(score: int, *, observed_hint: bool) -> int:
        """Pull an unsupported score into the neutral band (spec §27)."""
        low, high = NEUTRAL_BAND
        if low <= score <= high:
            return score
        return NEUTRAL_SCORE if not observed_hint else max(low, min(high, score))

    @staticmethod
    def _weighted_overall(
        skills: Sequence[SkillScoreDraft], weights: Mapping[str, float]
    ) -> int:
        total_weight = 0.0
        total = 0.0
        for item in skills:
            weight = float(weights.get(str(item.skill), 1.0))
            if weight <= 0:
                continue
            # Low-confidence dimensions contribute proportionally less, so an
            # unobserved dimension cannot dominate the headline number (§28).
            effective = weight * max(0.25, item.confidence if item.evidence else 0.25)
            total += item.score * effective
            total_weight += effective
        if total_weight <= 0:
            return 0
        return int(round(total / total_weight))

    @staticmethod
    def _compliance_status(findings: Sequence[Mapping[str, Any]]) -> str:
        order = {"safe": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
        worst = "safe"
        for finding in findings:
            severity = str(finding.get("severity", "safe"))
            if order.get(severity, 0) > order.get(worst, 0):
                worst = severity
        return worst


__all__ = [
    "LOW_CONFIDENCE",
    "NEUTRAL_BAND",
    "NEUTRAL_SCORE",
    "SIGNAL_TO_SKILL",
    "SKILL_KEYS",
    "EvaluationDraft",
    "EvaluationRequest",
    "EvaluatorAgent",
    "EvidenceDraft",
    "SkillScoreDraft",
    "TranscriptRef",
    "TurnObservation",
]
