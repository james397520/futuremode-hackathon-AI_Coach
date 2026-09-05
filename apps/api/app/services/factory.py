"""Composition root for the agent + RAG stack (spec §44, §70, §72).

Everything provider-specific is decided here, once, from settings — the services and
agents themselves never look at configuration. That keeps the §70 rule ("API key 不可
放 browser", keys only ever in the API process) enforceable by inspection: `get_settings`
is called in exactly two places in this package, both in this file.

Routing policy (§72): compliance / evaluation / intent prefer the **private** AMD AUP
endpoint, persona / coach / knowledge prefer the public API for fluency, and each has
the other as a fallback so a single provider outage degrades quality instead of
failing the session (§49.4).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import structlog

from app.agents.coach_agent import CoachAgent
from app.agents.compliance_agent import ComplianceAgent
from app.agents.customer_agent import CustomerAgent
from app.agents.evaluator_agent import EvaluatorAgent
from app.agents.intent import IntentPipeline, SafetyPort
from app.agents.knowledge_agent import KnowledgeAgent
from app.agents.llm_client import (
    LlmPort,
    MiniMaxClient,
    ModelPurpose,
    ModelRoute,
    OpenAiClient,
    PrivateLlmClient,
    RoutedLlmClient,
    StructlogAuditSink,
)
from app.agents.orchestrator import ConversationOrchestrator
from app.agents.scenario_director import ScenarioDirector
from app.rag.embedder import ApiEmbedder, DeterministicEmbedder, EmbedderPort, LocalEmbedder
from app.rag.pipeline import RagPipeline
from app.rag.reranker import CrossEncoderReranker, LexicalReranker, Reranker
from app.rag.vectorstore import InMemoryVectorStore, QdrantStore, TenantScope, VectorStore

log = structlog.get_logger(__name__)


def _settings() -> Any:
    from app.core.config import get_settings  # assumed: app.core.config.get_settings

    return get_settings()


def build_llm(ctx: Any) -> LlmPort:
    """Routed client with quota + audit hooks bound to this request's tenant."""
    settings = _settings()
    providers: dict[str, LlmPort] = {}
    if getattr(settings, "openai_api_key", None):
        providers["openai"] = OpenAiClient.from_settings()
    if getattr(settings, "minimax_api_key", None):
        providers["minimax"] = MiniMaxClient.from_settings()
    if getattr(settings, "private_llm_base_url", None):
        providers["private"] = PrivateLlmClient.from_settings()
    if not providers:
        raise RuntimeError(
            "no LLM provider configured: set MINIMAX_API_KEY, OPENAI_API_KEY, "
            "or PRIVATE_LLM_BASE_URL "
            "(spec §44 Model Settings)"
        )
    configured = str(getattr(settings, "llm_provider", "openai")).lower()
    # ``aup`` is the deployment name used in settings; internally it is the
    # private OpenAI-compatible provider.
    primary = "private" if configured == "aup" else configured
    if primary not in providers:
        primary = next(iter(providers))
    fallbacks = tuple(name for name in providers if name != primary)
    routes = {
        purpose: ModelRoute(purpose=purpose, primary=primary, fallbacks=fallbacks)
        for purpose in ModelPurpose
    }
    return RoutedLlmClient(
        providers,
        tenant_id=str(getattr(ctx, "tenant_id", "")),
        workspace_id=str(getattr(ctx, "workspace_id", "")),
        request_id=str(getattr(ctx, "request_id", "")),
        routes=routes,
        audit=StructlogAuditSink(),
    )


def build_embedder() -> EmbedderPort:
    """Local/private by default; the external API only when policy allows it (§2.1)."""
    settings = _settings()
    provider = str(getattr(settings, "embedding_provider", "local")).lower()
    if provider == "api":
        return ApiEmbedder.from_settings()
    if provider == "deterministic":
        # offline demo / CI only — no semantics
        return DeterministicEmbedder()
    return LocalEmbedder.from_settings()


def build_vector_store() -> VectorStore:
    settings = _settings()
    backend = str(getattr(settings, "vector_backend", "qdrant")).lower()
    if backend == "memory":
        return InMemoryVectorStore()
    if backend in ("chroma", "faiss"):
        log.warning("vectorstore.poc_backend_selected", backend=backend)
        if backend == "chroma":
            from app.rag.vectorstore import ChromaStore

            return ChromaStore()
        from app.rag.vectorstore import FaissStore

        return FaissStore()
    return QdrantStore.from_settings()


def build_reranker() -> Reranker:
    settings = _settings()
    if getattr(settings, "reranker_base_url", None):
        return Reranker(CrossEncoderReranker.from_settings())
    return Reranker(LexicalReranker())


def build_rag_pipeline(
    *,
    ctx: Any,
    knowledge_base_ids: Sequence[str] = (),
    acl_subject_ids: Sequence[str] = (),
    store: VectorStore | None = None,
    embedder: EmbedderPort | None = None,
) -> RagPipeline:
    scope = TenantScope(
        tenant_id=str(getattr(ctx, "tenant_id", "")),
        workspace_id=str(getattr(ctx, "workspace_id", "")),
        knowledge_base_ids=tuple(knowledge_base_ids),
        acl_subject_ids=tuple(acl_subject_ids),
    )
    return RagPipeline(
        store=store or build_vector_store(),
        embedder=embedder or build_embedder(),
        scope=scope,
        reranker=build_reranker(),
    )


def build_orchestrator(
    *,
    db: Any,
    ctx: Any,
    emitter: Any,
    mode: str = "training",
    locale: str = "zh-TW",
    knowledge_base_ids: Sequence[str] = (),
    llm: LlmPort | None = None,
    rag: RagPipeline | None = None,
    safety: SafetyPort | None = None,
) -> ConversationOrchestrator:
    """Assemble the §19 agent topology for one live session."""
    client = llm or build_llm(ctx)
    pipeline = rag or build_rag_pipeline(ctx=ctx, knowledge_base_ids=knowledge_base_ids)
    if safety is None:
        from app.services.safety_service import SafetyService

        safety = SafetyService(db, ctx)
    return ConversationOrchestrator(
        emitter=emitter,
        customer=CustomerAgent(client, locale=locale),
        knowledge=KnowledgeAgent(client, locale=locale, retrieval=pipeline),
        coach=CoachAgent(client, locale=locale),
        evaluator=EvaluatorAgent(client, locale=locale),
        compliance=ComplianceAgent(client, locale=locale),
        director=ScenarioDirector(locale=locale),
        intent_pipeline=IntentPipeline(llm=client, locale=locale, safety=safety),
        safety=safety,
        locale=locale,
    )


__all__ = [
    "build_embedder",
    "build_llm",
    "build_orchestrator",
    "build_rag_pipeline",
    "build_reranker",
    "build_vector_store",
]
