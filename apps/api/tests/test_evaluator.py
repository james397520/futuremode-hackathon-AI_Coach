"""§26/§27 — no evidence ⇒ low confidence, and never a fabricated quote.

    禁止只顯示：Empathy 74
    必須可展開：Evidence 02:13 + Customer quote + Trainee quote + Issue + Better Approach

The two properties pinned here are the ones a regression would quietly break:

1. a quote that does not occur verbatim in the transcript is **dropped**, and
2. a dimension left without evidence comes back with `confidence <= 0.3`, a neutral
   score and an explicit rubric note — not an invented justification.
"""

from __future__ import annotations

import pytest

from app.agents.evaluator_agent import (
    LOW_CONFIDENCE,
    NEUTRAL_BAND,
    SKILL_KEYS,
    EvaluationRequest,
    EvaluatorAgent,
    TranscriptRef,
)
from conftest import FakeLlm

TRANSCRIPT = [
    TranscriptRef(
        id="t1",
        speaker="persona",
        text="我最近其實壓力滿大的。",
        timestamp_ms=133_000,
    ),
    TranscriptRef(
        id="t2",
        speaker="trainee",
        text="了解，那我先跟你說明方案。",
        timestamp_ms=134_000,
    ),
    TranscriptRef(
        id="t3",
        speaker="trainee",
        text="這個方案一個月是三千五，包含意外與醫療的保障。",
        timestamp_ms=150_000,
    ),
]


def _request(**kwargs) -> EvaluationRequest:
    return EvaluationRequest(transcript=TRANSCRIPT, locale="zh-TW", **kwargs)


def _skill(draft, name: str):
    return next(item for item in draft.skills if str(item.skill) == name)


def _skills_payload(entries: list[dict]) -> dict:
    return {
        "skills": entries,
        "overall_score": 70,
        "goal_achieved": False,
        "passed": False,
        "key_strength": "說明清楚",
        "main_improvement": "先承接情緒",
        "compliance_status": "safe",
        "rejected_quotes": 0,
        "dimensions_without_evidence": [],
    }


# ---------------------------------------------------------------------------
# evidence verification
# ---------------------------------------------------------------------------
async def test_real_quote_is_kept_with_its_timestamp():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "empathy",
                        "score": 74,
                        "confidence": 0.8,
                        "rubric_note": "未先回應客戶情緒訊號",
                        "evidence": [
                            {
                                "timestamp_ms": 134_000,
                                "transcript_turn_ids": ["t2"],
                                "quote": "了解，那我先跟你說明方案。",
                                "issue": "未先回應客戶的壓力訊號",
                                "better_approach": "先承接壓力，再回到保障需求",
                            }
                        ],
                        "improvement_suggestion": "先同理再說明",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())

    empathy = _skill(draft, "empathy")
    assert empathy.score == 74
    assert empathy.confidence == 0.8
    assert len(empathy.evidence) == 1
    assert empathy.evidence[0].transcript_turn_ids == ["t2"]
    assert empathy.evidence[0].timestamp_ms == 134_000
    assert empathy.evidence[0].issue
    assert empathy.evidence[0].better_approach
    assert draft.rejected_quotes == 0


async def test_fabricated_quote_is_rejected_and_the_dimension_loses_confidence():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "empathy",
                        "score": 92,
                        "confidence": 0.95,
                        "rubric_note": "學員展現高度同理",
                        "evidence": [
                            {
                                "timestamp_ms": 134_000,
                                "transcript_turn_ids": ["t2"],
                                # never said by anyone in TRANSCRIPT
                                "quote": "我完全理解你的辛苦，我們慢慢來就好。",
                                "issue": None,
                                "better_approach": None,
                            }
                        ],
                        "improvement_suggestion": "保持",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())

    empathy = _skill(draft, "empathy")
    assert empathy.evidence == []
    assert empathy.confidence <= LOW_CONFIDENCE
    assert NEUTRAL_BAND[0] <= empathy.score <= NEUTRAL_BAND[1]
    assert empathy.score != 92
    assert draft.rejected_quotes == 1
    assert "empathy" in draft.dimensions_without_evidence
    assert empathy.rubric_note


async def test_a_partial_quote_of_a_real_line_is_accepted():
    """A contiguous fragment is a legitimate quote; only inventions are dropped."""
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "product_knowledge",
                        "score": 80,
                        "confidence": 0.7,
                        "rubric_note": "說明了保費與保障",
                        "evidence": [
                            {
                                "timestamp_ms": 0,
                                "transcript_turn_ids": ["t3"],
                                "quote": "一個月是三千五",
                                "issue": None,
                                "better_approach": None,
                            }
                        ],
                        "improvement_suggestion": "可補上除外責任",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    knowledge = _skill(draft, "product_knowledge")
    assert len(knowledge.evidence) == 1
    # the timestamp is back-filled from the anchor turn
    assert knowledge.evidence[0].timestamp_ms == 150_000
    assert draft.rejected_quotes == 0


async def test_misattributed_but_real_quote_has_its_turn_id_repaired():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "needs_discovery",
                        "score": 60,
                        "confidence": 0.6,
                        "rubric_note": "客戶主動透露壓力",
                        "evidence": [
                            {
                                "timestamp_ms": 0,
                                # wrong turn id: this line belongs to t1
                                "transcript_turn_ids": ["t3"],
                                "quote": "我最近其實壓力滿大的。",
                                "issue": None,
                                "better_approach": None,
                            }
                        ],
                        "improvement_suggestion": "追問壓力來源",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    discovery = _skill(draft, "needs_discovery")
    assert discovery.evidence
    assert discovery.evidence[0].transcript_turn_ids == ["t1"]
    assert draft.rejected_quotes == 0


async def test_too_short_quote_is_rejected():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "communication_clarity",
                        "score": 88,
                        "confidence": 0.9,
                        "rubric_note": "清楚",
                        "evidence": [
                            {
                                "timestamp_ms": 0,
                                "transcript_turn_ids": ["t3"],
                                "quote": "是",
                                "issue": None,
                                "better_approach": None,
                            }
                        ],
                        "improvement_suggestion": "-",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    clarity = _skill(draft, "communication_clarity")
    assert clarity.evidence == []
    assert clarity.confidence <= LOW_CONFIDENCE
    assert draft.rejected_quotes == 1


# ---------------------------------------------------------------------------
# all ten dimensions, always
# ---------------------------------------------------------------------------
async def test_every_dimension_is_returned_even_when_the_model_skips_it():
    llm = FakeLlm(responses=[_skills_payload([])])
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())

    assert {str(item.skill) for item in draft.skills} >= set(SKILL_KEYS)
    for item in draft.skills:
        assert item.evidence == []
        assert item.confidence <= LOW_CONFIDENCE
        assert NEUTRAL_BAND[0] <= item.score <= NEUTRAL_BAND[1]
        assert item.rubric_note
    assert sorted(draft.dimensions_without_evidence) == sorted(SKILL_KEYS)


async def test_unsupported_high_score_is_pulled_into_the_neutral_band():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "closing_ability",
                        "score": 97,
                        "confidence": 0.99,
                        "rubric_note": "很強",
                        "evidence": [],
                        "improvement_suggestion": "-",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    closing = _skill(draft, "closing_ability")
    assert NEUTRAL_BAND[0] <= closing.score <= NEUTRAL_BAND[1]
    assert closing.confidence <= LOW_CONFIDENCE


async def test_unsupported_low_score_is_also_neutralised():
    """An unearned penalty is as wrong as unearned praise (§27)."""
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "compliance",
                        "score": 5,
                        "confidence": 0.9,
                        "rubric_note": "很差",
                        "evidence": [],
                        "improvement_suggestion": "-",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    compliance = _skill(draft, "compliance")
    assert NEUTRAL_BAND[0] <= compliance.score <= NEUTRAL_BAND[1]
    assert compliance.confidence <= LOW_CONFIDENCE


# ---------------------------------------------------------------------------
# per-turn accumulation (§19.6)
# ---------------------------------------------------------------------------
def test_observe_turn_builds_deterministic_priors():
    agent = EvaluatorAgent(FakeLlm(), locale="zh-TW")
    agent.observe_turn(
        turn_id="t2",
        timestamp_ms=134_000,
        speaker="trainee",
        text="了解，那我先跟你說明方案。",
        signals=["product_explanation"],
    )
    agent.observe_turn(
        turn_id="t3",
        timestamp_ms=150_000,
        speaker="trainee",
        text="這個方案一個月是三千五。",
        signals=["evidence_provided", "objection_addressed"],
        citations=2,
    )
    scores = agent.live_scores()
    assert set(scores) == set(SKILL_KEYS)
    assert scores["objection_handling"] > 50
    assert scores["professional_knowledge"] > 50
    assert "objection_handling" in agent.observed_skills()
    assert all(0 <= value <= 100 for value in scores.values())


def test_observe_turn_penalises_a_compliance_risk():
    agent = EvaluatorAgent(FakeLlm(), locale="zh-TW")
    agent.observe_turn(
        turn_id="t9",
        timestamp_ms=1,
        speaker="trainee",
        text="保證一定會賺。",
        signals=["compliance_risk"],
        compliance_severity="critical",
    )
    assert agent.live_scores()["compliance"] < 50


# ---------------------------------------------------------------------------
# rubric weighting + pass/fail
# ---------------------------------------------------------------------------
async def test_compliance_findings_drive_the_compliance_status_and_fail_the_session():
    llm = FakeLlm(
        responses=[
            _skills_payload(
                [
                    {
                        "skill": "compliance",
                        "score": 90,
                        "confidence": 0.9,
                        "rubric_note": "ok",
                        "evidence": [
                            {
                                "timestamp_ms": 150_000,
                                "transcript_turn_ids": ["t3"],
                                "quote": "包含意外與醫療的保障",
                                "issue": None,
                                "better_approach": None,
                            }
                        ],
                        "improvement_suggestion": "-",
                    }
                ]
            )
        ]
    )
    draft = await EvaluatorAgent(llm, locale="zh-TW").run(
        _request(
            compliance_findings=[
                {"type": "false_promise", "severity": "critical", "evidence": "保證一定會賺"}
            ],
            pass_threshold=50,
        )
    )
    assert draft.compliance_status == "critical"
    assert draft.passed is False


async def test_zero_weight_dimension_is_excluded_from_the_overall_score():
    entries = [
        {
            "skill": "empathy",
            "score": 100,
            "confidence": 0.9,
            "rubric_note": "ok",
            "evidence": [
                {
                    "timestamp_ms": 134_000,
                    "transcript_turn_ids": ["t2"],
                    "quote": "了解，那我先跟你說明方案。",
                    "issue": None,
                    "better_approach": None,
                }
            ],
            "improvement_suggestion": "-",
        }
    ]
    weights = {key: 0.0 for key in SKILL_KEYS}
    weights["empathy"] = 1.0
    draft = await EvaluatorAgent(FakeLlm(responses=[_skills_payload(entries)]), locale="zh-TW").run(
        _request(rubric_weights=weights)
    )
    assert draft.overall_score == 100


# ---------------------------------------------------------------------------
# structured-output discipline
# ---------------------------------------------------------------------------
async def test_free_text_output_is_repaired_then_raises():
    from app.agents.errors import OutputValidationError

    llm = FakeLlm(responses=["這位學員表現不錯，同理心分數大約 74 分。"])
    with pytest.raises(OutputValidationError):
        await EvaluatorAgent(llm, locale="zh-TW").run(_request())
    # one initial call + exactly one bounded repair attempt
    assert len(llm.calls) == 2


async def test_transient_transport_failure_is_retried():
    llm = FakeLlm(responses=[_skills_payload([])], fail_times=2)
    draft = await EvaluatorAgent(llm, locale="zh-TW", max_attempts=3).run(_request())
    assert draft.skills
