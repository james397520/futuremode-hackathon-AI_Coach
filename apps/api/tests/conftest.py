"""Test fixtures and doubles. **Nothing here touches the network.**

Two jobs:

1. **Contract stubs.** `app.core.*` and `app.domain.*` are owned by the API-platform
   module and are imported optimistically by the agent/RAG/service code. When the real
   modules are importable the tests use them unchanged; when they are not (this package
   being developed in parallel) minimal Pydantic stand-ins are installed into
   `sys.modules` so the logic under test is still exercised. The stubs mirror
   `packages/shared-types` field-for-field — if a test fails after the real modules
   land, the mirror is what needs fixing.

2. **Deterministic doubles.** `FakeLlm` replays scripted structured outputs (and token
   streams) so every agent test is reproducible; `InMemoryVectorStore` +
   `DeterministicEmbedder` stand in for Qdrant and BGE.
"""

from __future__ import annotations

import importlib
import json
import sys
import types
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field as dataclass_field
from typing import Any

import pytest


# ---------------------------------------------------------------------------
# 1. contract stubs
# ---------------------------------------------------------------------------
def _module_available(name: str) -> bool:
    try:
        importlib.import_module(name)
    except Exception:  # noqa: BLE001 - a broken module counts as unavailable here
        return False
    return True


def _install_core_stubs() -> None:
    if _module_available("app.core.context"):
        return
    from pydantic import BaseModel, Field

    core = sys.modules.get("app.core") or types.ModuleType("app.core")
    core.__path__ = []  # type: ignore[attr-defined]

    context = types.ModuleType("app.core.context")

    class RequestContext(BaseModel):
        """Stub mirror of `app.core.context.RequestContext`."""

        model_config = {"extra": "allow"}

        tenant_id: str = "t_test"
        workspace_id: str = "w_test"
        user_id: str = "u_test"
        roles: list[str] = Field(default_factory=lambda: ["trainee"])
        request_id: str = "req_test"
        team_ids: list[str] = Field(default_factory=list)

    context.RequestContext = RequestContext  # type: ignore[attr-defined]

    config = types.ModuleType("app.core.config")

    class _Settings(BaseModel):
        model_config = {"extra": "allow"}

        openai_api_key: str = ""
        private_llm_base_url: str = ""
        embedding_provider: str = "deterministic"
        vector_backend: str = "memory"
        job_queue: str = "inline"
        maker_checker_required: bool = False
        redis_url: str = "redis://localhost:6379/0"
        allow_external_embedding: bool = False

    def get_settings() -> _Settings:
        return _Settings()

    config.get_settings = get_settings  # type: ignore[attr-defined]
    config.Settings = _Settings  # type: ignore[attr-defined]

    sys.modules.setdefault("app.core", core)
    sys.modules["app.core.context"] = context
    sys.modules["app.core.config"] = config
    core.context = context  # type: ignore[attr-defined]
    core.config = config  # type: ignore[attr-defined]


def _install_domain_stubs() -> None:
    if _module_available("app.domain"):
        return
    from pydantic import BaseModel, ConfigDict, Field

    domain = types.ModuleType("app.domain")

    class PersonaSimulationState(BaseModel):
        """Stub mirror of packages/shared-types/src/persona.ts."""

        model_config = ConfigDict(extra="forbid")

        scenario_phase: str = "opening"
        emotion: str = "neutral"
        trust: int = 50
        interest: int = 50
        resistance: int = 50
        patience: int = 50
        intent: str = "unknown"
        current_goal: str = ""
        budget: int | None = None
        hidden_need_revealed: bool = False
        compliance_risk: str = "safe"
        time_pressure: int | None = 0

    class PersonaTraits(BaseModel):
        model_config = ConfigDict(extra="forbid")

        trust: int = 50
        patience: int = 50
        price_sensitivity: int = 50
        risk_aversion: int = 50
        product_knowledge: int = 50
        resistance: int = 50
        openness: int = 50

    class PersonaHiddenState(BaseModel):
        model_config = ConfigDict(extra="allow")

        primary_goal: str = ""
        hidden_need: str = ""
        main_concern: str = ""
        budget: int | None = None
        trigger_points: list[str] = Field(default_factory=list)
        objections: list[str] = Field(default_factory=list)
        forbidden_knowledge: list[str] = Field(default_factory=list)
        opening_attitude: str = ""
        exit_condition: str = ""
        success_condition: str = ""

    domain.PersonaSimulationState = PersonaSimulationState  # type: ignore[attr-defined]
    domain.PersonaTraits = PersonaTraits  # type: ignore[attr-defined]
    domain.PersonaHiddenState = PersonaHiddenState  # type: ignore[attr-defined]
    sys.modules["app.domain"] = domain


_install_core_stubs()
_install_domain_stubs()


# ---------------------------------------------------------------------------
# 2. doubles
# ---------------------------------------------------------------------------
from app.agents.llm_client import (  # noqa: E402 - must follow the stub installation
    LlmCompletion,
    LlmMessage,
    ModelPurpose,
    TokenUsage,
)
from app.rag.embedder import DeterministicEmbedder  # noqa: E402
from app.rag.vectorstore import (  # noqa: E402
    InMemoryVectorStore,
    TenantScope,
    VectorRecord,
)
from app.services.repository import InMemoryRepository  # noqa: E402


@dataclass
class FakeLlm:
    """Deterministic `LlmPort`.

    * `responses` — queue of replies for `complete()`. Each entry may be a `str`
      (returned verbatim) or a `dict`/model (JSON-encoded). When the queue drains the
      last entry repeats, which keeps a repair round-trip from exploding a test.
    * `stream_chunks` — token list for `stream()`.
    * `fail_times` — raise `LlmTransportError` this many times first, to exercise the
      retry path.
    """

    provider: str = "fake"
    responses: list[Any] = dataclass_field(default_factory=list)
    stream_chunks: list[str] = dataclass_field(default_factory=list)
    fail_times: int = 0
    calls: list[dict[str, Any]] = dataclass_field(default_factory=list)
    stream_calls: int = 0

    async def complete(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        schema: Mapping[str, Any] | None = None,
        schema_name: str = "Output",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = 30.0,
    ) -> LlmCompletion:
        from app.agents.errors import LlmTransportError

        self.calls.append(
            {
                "purpose": str(purpose),
                "schema": schema_name,
                "temperature": temperature,
                "messages": [m.content for m in messages],
            }
        )
        if self.fail_times > 0:
            self.fail_times -= 1
            raise LlmTransportError("fake transport failure")
        if not self.responses:
            payload: Any = {}
        elif len(self.responses) == 1:
            payload = self.responses[0]
        else:
            payload = self.responses.pop(0)
        text = payload if isinstance(payload, str) else _to_json(payload)
        return LlmCompletion(
            text=text,
            model="fake-model",
            provider=self.provider,
            usage=TokenUsage(prompt_tokens=10, completion_tokens=20),
            latency_ms=1,
        )

    async def stream(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = 30.0,
    ) -> AsyncIterator[str]:
        self.stream_calls += 1
        for chunk in self.stream_chunks:
            yield chunk


def _to_json(payload: Any) -> str:
    dumper = getattr(payload, "model_dump", None)
    if callable(dumper):
        payload = dumper(mode="json")
    return json.dumps(payload, ensure_ascii=False)


class FakeSafetyService:
    """Structural `SafetyPort`. Blocks on a substring so tests stay readable."""

    def __init__(self, *, block_on: Iterable[str] = (), flags: Iterable[str] = ()) -> None:
        self.block_on = tuple(block_on)
        self.flags = tuple(flags)
        self.calls: list[str] = []

    async def screen_input(
        self, text: str, *, restricted_topics: Sequence[str] = (), locale: str = "zh-TW"
    ) -> Any:
        self.calls.append(text)
        blocked = any(needle in text for needle in self.block_on)

        class _Screening:
            def __init__(self, blocked: bool, flags: tuple[str, ...]) -> None:
                self.blocked = blocked
                self.flags = flags

        return _Screening(blocked, self.flags if blocked else ())


class RecordingEmitter:
    """Captures the event stream so ordering can be asserted."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._seq = 0

    async def emit(self, event: Mapping[str, Any]) -> dict[str, Any]:
        self._seq += 1
        payload = {**dict(event), "seq": self._seq}
        self.events.append(payload)
        return payload

    def types(self) -> list[str]:
        return [str(event.get("type")) for event in self.events]

    def __getattr__(self, name: str) -> Any:
        """Accept every `EventEmitter` helper (`agent_thinking`, `speech_final`, …)."""
        if name.startswith("_"):
            raise AttributeError(name)

        async def helper(*args: Any, **kwargs: Any) -> dict[str, Any]:
            return await self.emit(
                {"type": name.replace("_", "."), "args": list(args), "kwargs": kwargs}
            )

        return helper


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def ctx() -> Any:
    from app.core.context import RequestContext

    return RequestContext(
        tenant_id="t1",
        workspace_id="w1",
        user_id="u1",
        roles=["trainee"],
        request_id="req1",
    )


@pytest.fixture
def coach_ctx() -> Any:
    from app.core.context import RequestContext

    return RequestContext(
        tenant_id="t1",
        workspace_id="w1",
        user_id="u_coach",
        roles=["coach"],
        request_id="req2",
    )


@pytest.fixture
def reviewer_ctx() -> Any:
    from app.core.context import RequestContext

    return RequestContext(
        tenant_id="t1",
        workspace_id="w1",
        user_id="u_reviewer",
        roles=["reviewer"],
        request_id="req3",
    )


@pytest.fixture
def repo() -> InMemoryRepository:
    return InMemoryRepository(tenant_id="t1", workspace_id="w1")


@pytest.fixture
def embedder() -> DeterministicEmbedder:
    return DeterministicEmbedder(dimension=64)


@pytest.fixture
def store() -> InMemoryVectorStore:
    return InMemoryVectorStore()


@pytest.fixture
def scope() -> TenantScope:
    return TenantScope(tenant_id="t1", workspace_id="w1")


@pytest.fixture
def persona_state() -> Any:
    from app.domain import PersonaSimulationState

    return PersonaSimulationState(
        scenario_phase="opening",
        emotion="neutral",
        trust=40,
        interest=45,
        resistance=55,
        patience=60,
        intent="unknown",
        current_goal="understand_monthly_cost",
        hidden_need_revealed=False,
        compliance_risk="safe",
        time_pressure=0,
    )


@pytest.fixture
def fake_llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture
def recording_emitter() -> RecordingEmitter:
    return RecordingEmitter()


def make_record(
    *,
    tenant_id: str,
    workspace_id: str,
    text: str,
    vector: Sequence[float],
    knowledge_base_id: str = "kb1",
    document_id: str = "doc1",
    chunk_index: int = 0,
    acl_subject_ids: Sequence[str] = (),
    is_parent: bool = False,
) -> VectorRecord:
    """Build a `VectorRecord` for the isolation tests."""
    return VectorRecord(
        id=f"{tenant_id}-{workspace_id}-{document_id}-{chunk_index}",
        vector=list(vector),
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        knowledge_base_id=knowledge_base_id,
        document_id=document_id,
        chunk_id=f"{document_id}:v1:{chunk_index}",
        chunk_index=chunk_index,
        text=text,
        is_parent=is_parent,
        acl_subject_ids=list(acl_subject_ids),
        metadata={"document_name": f"{document_id}.pdf"},
    )
