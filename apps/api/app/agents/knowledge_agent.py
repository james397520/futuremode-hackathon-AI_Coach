"""Knowledge Agent — RAG, citations, scope control, insufficiency (spec §19.3, §12.6).

The knowledge boundary is enforced **structurally**, not by asking the model nicely:

* If retrieval returns nothing above the similarity threshold, the agent short-circuits
  and returns an `insufficient` verdict *without calling a model at all*. There is no
  code path in which an empty evidence set can produce a policy statement.
* If the model does answer, every `grounded_statement` must carry at least one
  `citation_index` pointing at a real retrieved chunk. Statements that do not are
  dropped; if that empties the answer, the verdict is downgraded to `insufficient`
  with `state_uncertainty`.

    Insufficient Knowledge -> Clarify | State uncertainty | Redirect to approved scope
    (spec §12.6 — 不能自行發明企業政策)
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.agents.base import Agent
from app.agents.llm_client import ModelPurpose
from app.agents.patterns import fold, matched_topics
from app.agents.prompts.common import data_block, schema_block, untrusted_block
from app.agents.prompts.knowledge import (
    CLARIFY_QUESTIONS,
    REDIRECT_SCOPES,
    UNCERTAINTY_STATEMENTS,
    knowledge_system_prompt,
    localised,
)

log = structlog.get_logger(__name__)

#: Below this cosine similarity a chunk is not evidence (spec §12.3 threshold).
DEFAULT_SIMILARITY_THRESHOLD = 0.35
#: Fewer usable chunks than this and we treat the evidence as partial at best.
MIN_SUFFICIENT_CHUNKS = 1


class Sufficiency(StrEnum):
    SUFFICIENT = "sufficient"
    PARTIAL = "partial"
    INSUFFICIENT = "insufficient"


class KnowledgeAction(StrEnum):
    ANSWER = "answer"
    CLARIFY = "clarify"
    STATE_UNCERTAINTY = "state_uncertainty"
    REDIRECT = "redirect"


class EvidenceItem(BaseModel):
    """One retrieved chunk, as shown to the model (index is the citation handle)."""

    model_config = ConfigDict(extra="forbid")

    index: int
    chunk_id: str
    document_id: str
    document_name: str
    document_version: int = 1
    page: int | None = None
    section: str | None = None
    similarity: float = 0.0
    rerank_score: float | None = None
    snippet: str = ""

    @property
    def effective_score(self) -> float:
        return self.rerank_score if self.rerank_score is not None else self.similarity


class GroundedStatement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    citation_indexes: list[int] = Field(default_factory=list)


class KnowledgeVerdict(BaseModel):
    """Structured output (spec §66). Never free text."""

    model_config = ConfigDict(extra="forbid")

    sufficiency: Sufficiency = Sufficiency.INSUFFICIENT
    in_scope: bool = True
    recommended_action: KnowledgeAction = KnowledgeAction.STATE_UNCERTAINTY
    grounded_statements: list[GroundedStatement] = Field(default_factory=list)
    clarifying_question: str | None = None
    uncertainty_statement: str | None = None
    redirect_scope: str | None = None
    used_citation_indexes: list[int] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    note: str = ""

    @property
    def is_answerable(self) -> bool:
        return (
            self.recommended_action is KnowledgeAction.ANSWER
            and bool(self.grounded_statements)
        )

    def summary_for_persona(self) -> str:
        """A short, citation-free digest the customer agent may use for coherence."""
        if not self.grounded_statements:
            return ""
        return " ".join(statement.text for statement in self.grounded_statements)[:600]


class KnowledgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    locale: str = "zh-TW"
    mode: str = "training"
    allowed_scope: list[str] = Field(default_factory=list)
    restricted_topics: list[str] = Field(default_factory=list)
    evidence: list[EvidenceItem] = Field(default_factory=list)
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    #: conversation context so the model can resolve "那個方案" style references
    recent_turns: list[tuple[str, str]] = Field(default_factory=list)


@runtime_checkable
class KnowledgeRetrievalPort(Protocol):
    """Structural port satisfied by `app.rag.pipeline.RagPipeline`.

    Declared as a protocol so the agent layer never imports the RAG package directly
    and can be tested against a deterministic fake.
    """

    async def query(
        self,
        query: str,
        *,
        knowledge_base_ids: Sequence[str] = (),
        top_k: int = 8,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        metadata_filter: dict[str, Any] | None = None,
    ) -> Any: ...


class KnowledgeAgent(Agent[KnowledgeRequest, KnowledgeVerdict]):
    name = "knowledge"
    purpose = ModelPurpose.KNOWLEDGE
    output_model = KnowledgeVerdict
    optional = True
    default_temperature = 0.1
    default_max_tokens = 800

    def __init__(self, *args: Any, retrieval: KnowledgeRetrievalPort | None = None, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.retrieval = retrieval

    def system_prompt(self) -> str:
        return knowledge_system_prompt(self.locale)

    def build_user_prompt(self, request: KnowledgeRequest) -> str:
        history = "\n".join(f"{s}: {t}" for s, t in request.recent_turns[-6:])
        return "\n\n".join(
            [
                data_block(
                    "scope",
                    {
                        "allowed_scope": request.allowed_scope,
                        "restricted_topics": request.restricted_topics,
                        "mode": request.mode,
                    },
                ),
                data_block(
                    "retrieved_evidence",
                    [
                        {
                            "citation_index": item.index,
                            "document": item.document_name,
                            "version": item.document_version,
                            "page": item.page,
                            "section": item.section,
                            "score": round(item.effective_score, 4),
                            "text": item.snippet,
                        }
                        for item in request.evidence
                    ],
                ),
                untrusted_block("recent_transcript", history),
                untrusted_block("question", request.query),
                schema_block(self._schema(), name=self.output_model.__name__),
            ]
        )

    # -- entry point -------------------------------------------------------
    async def retrieve(
        self,
        query: str,
        *,
        knowledge_base_ids: Sequence[str] = (),
        top_k: int = 8,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
    ) -> list[EvidenceItem]:
        """Pull evidence through the retrieval port (tenant filtering happens there)."""
        if self.retrieval is None:
            return []
        result = await self.retrieval.query(
            query,
            knowledge_base_ids=knowledge_base_ids,
            top_k=top_k,
            similarity_threshold=similarity_threshold,
        )
        return normalise_evidence(getattr(result, "citations", None) or result)

    async def run(self, request: KnowledgeRequest) -> KnowledgeVerdict:
        usable = [
            item
            for item in request.evidence
            if item.effective_score >= request.similarity_threshold and item.snippet.strip()
        ]
        scope_hits = matched_topics(request.query, request.restricted_topics)

        # --- structural short-circuits: no model call, no invention ---------
        if scope_hits:
            return self._redirect(request, note=f"restricted topic: {', '.join(scope_hits)}")
        if not usable:
            return self._insufficient(request, note="no chunk above similarity threshold")

        verdict = await self._invoke_structured(
            self._messages(request.model_copy(update={"evidence": usable}))
        )
        return self._verify(verdict, request, usable)

    # -- deterministic verdicts -------------------------------------------
    def _insufficient(self, request: KnowledgeRequest, *, note: str) -> KnowledgeVerdict:
        """§12.6: clarify, state uncertainty, or redirect — never invent policy."""
        vague = len(fold(request.query)) <= 8 or request.query.strip().endswith(("嗎", "?", "？"))
        if vague:
            return KnowledgeVerdict(
                sufficiency=Sufficiency.INSUFFICIENT,
                in_scope=True,
                recommended_action=KnowledgeAction.CLARIFY,
                clarifying_question=localised(CLARIFY_QUESTIONS, request.locale),
                confidence=0.0,
                note=note,
            )
        return KnowledgeVerdict(
            sufficiency=Sufficiency.INSUFFICIENT,
            in_scope=True,
            recommended_action=KnowledgeAction.STATE_UNCERTAINTY,
            uncertainty_statement=localised(UNCERTAINTY_STATEMENTS, request.locale),
            confidence=0.0,
            note=note,
        )

    def _redirect(self, request: KnowledgeRequest, *, note: str) -> KnowledgeVerdict:
        return KnowledgeVerdict(
            sufficiency=Sufficiency.INSUFFICIENT,
            in_scope=False,
            recommended_action=KnowledgeAction.REDIRECT,
            redirect_scope=localised(REDIRECT_SCOPES, request.locale),
            confidence=0.0,
            note=note,
        )

    # -- post-validation ---------------------------------------------------
    def _verify(
        self,
        verdict: KnowledgeVerdict,
        request: KnowledgeRequest,
        usable: Sequence[EvidenceItem],
    ) -> KnowledgeVerdict:
        """Drop every ungrounded statement; downgrade if nothing survives."""
        valid_indexes = {item.index for item in usable}
        kept: list[GroundedStatement] = []
        dropped = 0
        for statement in verdict.grounded_statements:
            indexes = [i for i in statement.citation_indexes if i in valid_indexes]
            if not indexes or not statement.text.strip():
                dropped += 1
                continue
            kept.append(GroundedStatement(text=statement.text, citation_indexes=indexes))

        result = verdict.model_copy(deep=True)
        result.grounded_statements = kept
        result.used_citation_indexes = sorted({i for s in kept for i in s.citation_indexes})

        if not result.in_scope:
            result.recommended_action = KnowledgeAction.REDIRECT
            result.redirect_scope = result.redirect_scope or localised(
                REDIRECT_SCOPES, request.locale
            )
            result.grounded_statements = []
            result.used_citation_indexes = []
            return result

        if not kept:
            fallback = self._insufficient(
                request, note=f"model produced {dropped} ungrounded statement(s); all dropped"
            )
            log.warning(
                "knowledge.ungrounded_output_dropped",
                dropped=dropped,
                query_len=len(request.query),
            )
            return fallback

        if result.recommended_action is KnowledgeAction.ANSWER:
            if len(kept) < MIN_SUFFICIENT_CHUNKS or result.sufficiency is Sufficiency.INSUFFICIENT:
                result.sufficiency = Sufficiency.PARTIAL
            if result.sufficiency is Sufficiency.PARTIAL and not result.uncertainty_statement:
                result.uncertainty_statement = localised(UNCERTAINTY_STATEMENTS, request.locale)
        if dropped:
            result.note = f"{result.note} | dropped_ungrounded={dropped}".strip(" |")
        result.confidence = min(
            1.0, max(item.effective_score for item in usable if item.index in valid_indexes)
        )
        return result


def normalise_evidence(raw: Any) -> list[EvidenceItem]:
    """Accept citations from `RagPipeline` (models or dicts) as `EvidenceItem`s."""
    items: list[EvidenceItem] = []
    for index, entry in enumerate(raw or []):
        if isinstance(entry, EvidenceItem):
            items.append(entry.model_copy(update={"index": index}))
            continue
        data = entry if isinstance(entry, dict) else _to_dict(entry)
        items.append(
            EvidenceItem(
                index=index,
                chunk_id=str(data.get("chunk_id", "")),
                document_id=str(data.get("document_id", "")),
                document_name=str(data.get("document_name", "")),
                document_version=int(data.get("document_version", 1) or 1),
                page=data.get("page"),
                section=data.get("section"),
                similarity=float(data.get("similarity", 0.0) or 0.0),
                rerank_score=data.get("rerank_score"),
                snippet=str(data.get("snippet", data.get("text", "")) or ""),
            )
        )
    return items


def _to_dict(entry: Any) -> dict[str, Any]:
    dumper = getattr(entry, "model_dump", None)
    if callable(dumper):
        return dict(dumper())
    return {key: getattr(entry, key) for key in dir(entry) if not key.startswith("_")}


__all__ = [
    "DEFAULT_SIMILARITY_THRESHOLD",
    "EvidenceItem",
    "GroundedStatement",
    "KnowledgeAction",
    "KnowledgeAgent",
    "KnowledgeRequest",
    "KnowledgeRetrievalPort",
    "KnowledgeVerdict",
    "Sufficiency",
    "normalise_evidence",
]
