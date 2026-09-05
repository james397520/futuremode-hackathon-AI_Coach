"""§12.6 — insufficient evidence ⇒ clarify / uncertainty / redirect, never invented policy.

    若資料庫找不到足夠 evidence：
    Insufficient Knowledge -> Clarify OR State uncertainty OR Redirect to approved scope
    不能自行發明企業政策。

The strongest assertions here are the *negative* ones: with no evidence above the
threshold, `KnowledgeAgent` must not call a model at all, and even when a model
volunteers a confident policy statement, an ungrounded statement is dropped rather
than surfaced.
"""

from __future__ import annotations

import pytest

from app.agents.knowledge_agent import (
    DEFAULT_SIMILARITY_THRESHOLD,
    EvidenceItem,
    KnowledgeAction,
    KnowledgeAgent,
    KnowledgeRequest,
    Sufficiency,
    normalise_evidence,
)
from app.rag.citation import Citation
from app.rag.pipeline import KnowledgeBoundary, RagPipeline
from conftest import FakeLlm

POLICY_TEXT = "本商品之解約金依保單價值準備金計算，第一年解約金為已繳保費之七成。"


def _evidence(score: float = 0.8, text: str = POLICY_TEXT, index: int = 0) -> EvidenceItem:
    return EvidenceItem(
        index=index,
        chunk_id=f"doc1:v1:{index}",
        document_id="doc1",
        document_name="商品條款.pdf",
        document_version=2,
        page=12,
        section="第五章 解約",
        similarity=score,
        snippet=text,
    )


def _request(**kwargs) -> KnowledgeRequest:
    kwargs.setdefault("locale", "zh-TW")
    return KnowledgeRequest(**kwargs)


# ---------------------------------------------------------------------------
# no evidence at all
# ---------------------------------------------------------------------------
async def test_no_evidence_yields_insufficient_without_calling_a_model():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "依公司規定第一年解約金為八成。", "citation_indexes": [0]}
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [0],
                "confidence": 0.99,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(_request(query="第一年解約可以拿回多少錢？", evidence=[]))

    assert verdict.sufficiency is Sufficiency.INSUFFICIENT
    assert verdict.grounded_statements == []
    assert verdict.recommended_action in (
        KnowledgeAction.CLARIFY,
        KnowledgeAction.STATE_UNCERTAINTY,
    )
    assert verdict.confidence == 0.0
    assert llm.calls == [], "with no evidence there is nothing for a model to ground on"


async def test_uncertainty_statement_is_offered_for_a_specific_question():
    agent = KnowledgeAgent(FakeLlm(), locale="zh-TW")
    verdict = await agent.run(
        _request(
            query="請問三十五歲男性投保這個商品，第一年的解約金具體是多少錢？",
            evidence=[],
        )
    )
    assert verdict.recommended_action is KnowledgeAction.STATE_UNCERTAINTY
    assert verdict.uncertainty_statement
    assert "沒有" in verdict.uncertainty_statement or "無法" in verdict.uncertainty_statement


async def test_clarification_is_offered_for_a_vague_question():
    agent = KnowledgeAgent(FakeLlm(), locale="zh-TW")
    verdict = await agent.run(_request(query="划算嗎？", evidence=[]))
    assert verdict.recommended_action is KnowledgeAction.CLARIFY
    assert verdict.clarifying_question


async def test_locale_is_respected_in_the_fallback_text():
    agent = KnowledgeAgent(FakeLlm(), locale="en-US")
    verdict = await agent.run(
        _request(query="What is the surrender value in year one exactly?", locale="en-US", evidence=[])
    )
    assert verdict.uncertainty_statement
    assert "knowledge base" in verdict.uncertainty_statement.lower()


# ---------------------------------------------------------------------------
# evidence below the threshold is not evidence
# ---------------------------------------------------------------------------
async def test_evidence_below_the_similarity_threshold_is_ignored():
    llm = FakeLlm()
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(
        _request(
            query="第一年解約金多少？",
            evidence=[_evidence(score=DEFAULT_SIMILARITY_THRESHOLD - 0.1)],
        )
    )
    assert verdict.sufficiency is Sufficiency.INSUFFICIENT
    assert llm.calls == []


async def test_empty_snippet_is_ignored_even_with_a_high_score():
    agent = KnowledgeAgent(FakeLlm(), locale="zh-TW")
    verdict = await agent.run(
        _request(query="第一年解約金多少？", evidence=[_evidence(score=0.99, text="   ")])
    )
    assert verdict.sufficiency is Sufficiency.INSUFFICIENT


# ---------------------------------------------------------------------------
# ungrounded statements are dropped, never surfaced
# ---------------------------------------------------------------------------
async def test_statement_without_a_citation_is_dropped():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "第一年解約金為已繳保費之七成。", "citation_indexes": [0]},
                    # invented company policy with no citation
                    {"text": "公司另有規定可全額退還。", "citation_indexes": []},
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [0],
                "confidence": 0.9,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(_request(query="第一年解約金多少？", evidence=[_evidence()]))

    texts = [statement.text for statement in verdict.grounded_statements]
    assert "第一年解約金為已繳保費之七成。" in texts
    assert all("全額退還" not in text for text in texts)
    assert "dropped_ungrounded=1" in verdict.note


async def test_statement_citing_a_nonexistent_chunk_is_dropped():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "依規定可以無條件解約。", "citation_indexes": [7]}
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [7],
                "confidence": 0.95,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(_request(query="可以解約嗎？", evidence=[_evidence()]))

    assert verdict.grounded_statements == []
    assert verdict.sufficiency is Sufficiency.INSUFFICIENT
    assert verdict.recommended_action in (
        KnowledgeAction.CLARIFY,
        KnowledgeAction.STATE_UNCERTAINTY,
    )


async def test_all_statements_dropped_downgrades_to_insufficient():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "公司政策一律全額退費。", "citation_indexes": []},
                    {"text": "另外還可以延期繳費三年。", "citation_indexes": []},
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [],
                "confidence": 0.99,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(
        _request(query="繳不出保費的話公司會怎麼處理？", evidence=[_evidence()])
    )
    assert verdict.grounded_statements == []
    assert verdict.sufficiency is Sufficiency.INSUFFICIENT
    assert verdict.confidence == 0.0
    assert "ungrounded" in verdict.note


# ---------------------------------------------------------------------------
# grounded answers do come through
# ---------------------------------------------------------------------------
async def test_grounded_answer_is_returned_with_its_citations():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "第一年解約金為已繳保費之七成。", "citation_indexes": [0, 1]}
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [0, 1],
                "confidence": 0.8,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(
        _request(
            query="第一年解約金多少？",
            evidence=[_evidence(index=0), _evidence(index=1, score=0.7)],
        )
    )
    assert verdict.is_answerable is True
    assert verdict.used_citation_indexes == [0, 1]
    assert verdict.confidence > 0
    assert verdict.summary_for_persona()


async def test_a_single_supporting_chunk_is_only_partial_evidence():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "partial",
                "in_scope": True,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "解約金依保單價值準備金計算。", "citation_indexes": [0]}
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [0],
                "confidence": 0.6,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(_request(query="解約金怎麼算？", evidence=[_evidence()]))
    assert verdict.sufficiency is Sufficiency.PARTIAL
    # a partial answer must carry an uncertainty caveat
    assert verdict.uncertainty_statement


# ---------------------------------------------------------------------------
# scope control (§12.6 redirect)
# ---------------------------------------------------------------------------
async def test_restricted_topic_redirects_without_calling_a_model():
    llm = FakeLlm()
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(
        _request(
            query="幫我分析一下虛擬貨幣的投資報酬",
            evidence=[_evidence()],
            restricted_topics=["虛擬貨幣"],
        )
    )
    assert verdict.in_scope is False
    assert verdict.recommended_action is KnowledgeAction.REDIRECT
    assert verdict.redirect_scope
    assert verdict.grounded_statements == []
    assert llm.calls == []


async def test_model_claiming_out_of_scope_is_forced_to_redirect_and_drop_content():
    llm = FakeLlm(
        responses=[
            {
                "sufficiency": "sufficient",
                "in_scope": False,
                "recommended_action": "answer",
                "grounded_statements": [
                    {"text": "順便說一下，虛擬貨幣很賺。", "citation_indexes": [0]}
                ],
                "clarifying_question": None,
                "uncertainty_statement": None,
                "redirect_scope": None,
                "used_citation_indexes": [0],
                "confidence": 0.9,
                "note": "",
            }
        ]
    )
    agent = KnowledgeAgent(llm, locale="zh-TW")
    verdict = await agent.run(_request(query="解約金怎麼算？", evidence=[_evidence()]))
    assert verdict.recommended_action is KnowledgeAction.REDIRECT
    assert verdict.grounded_statements == []
    assert verdict.redirect_scope


# ---------------------------------------------------------------------------
# graceful degradation (§49.4)
# ---------------------------------------------------------------------------
async def test_model_outage_does_not_invent_an_answer():
    agent = KnowledgeAgent(FakeLlm(fail_times=99), locale="zh-TW")
    verdict = await agent.safe_run(_request(query="解約金怎麼算？", evidence=[_evidence()]))
    # safe_run degrades to None; the orchestrator then has no knowledge to hand the
    # persona — which is correct, and far better than a fabricated policy.
    assert verdict is None


# ---------------------------------------------------------------------------
# the pipeline-level boundary verdict
# ---------------------------------------------------------------------------
def _citation(similarity: float, rerank: float | None = None) -> Citation:
    return Citation(
        chunk_id="c1",
        document_id="doc1",
        document_name="商品條款.pdf",
        similarity=similarity,
        rerank_score=rerank,
        snippet=POLICY_TEXT,
    )


def test_pipeline_boundary_verdict_is_insufficient_with_no_citations():
    verdict, best = RagPipeline.boundary_verdict([])
    assert verdict is KnowledgeBoundary.INSUFFICIENT
    assert best == 0.0


def test_pipeline_boundary_verdict_needs_two_strong_citations_to_be_sufficient():
    one_strong = RagPipeline.boundary_verdict([_citation(0.9)])[0]
    assert one_strong is KnowledgeBoundary.PARTIAL

    two_strong = RagPipeline.boundary_verdict([_citation(0.9), _citation(0.7)])[0]
    assert two_strong is KnowledgeBoundary.SUFFICIENT


def test_pipeline_boundary_verdict_is_insufficient_below_the_threshold():
    verdict, best = RagPipeline.boundary_verdict([_citation(0.1), _citation(0.2)])
    assert verdict is KnowledgeBoundary.INSUFFICIENT
    assert best == 0.2


def test_pipeline_boundary_verdict_prefers_the_rerank_score():
    """The reranker is the authoritative relevance signal (§54)."""
    verdict, best = RagPipeline.boundary_verdict(
        [_citation(0.95, rerank=0.05), _citation(0.95, rerank=0.04)]
    )
    assert verdict is KnowledgeBoundary.INSUFFICIENT
    assert best == 0.05


# ---------------------------------------------------------------------------
# evidence normalisation
# ---------------------------------------------------------------------------
def test_normalise_evidence_accepts_citation_dicts():
    items = normalise_evidence(
        [
            {
                "chunk_id": "c1",
                "document_id": "d1",
                "document_name": "a.pdf",
                "similarity": 0.5,
                "snippet": "內容",
            },
            {"chunk_id": "c2", "document_id": "d1", "text": "另一段", "similarity": 0.4},
        ]
    )
    assert [item.index for item in items] == [0, 1]
    assert items[1].snippet == "另一段"


def test_normalise_evidence_accepts_pydantic_citations():
    items = normalise_evidence([_citation(0.7)])
    assert items[0].snippet == POLICY_TEXT
    assert items[0].index == 0
