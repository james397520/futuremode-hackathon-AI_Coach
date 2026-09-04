"""Provider-agnostic LLM port + concrete clients (spec §70, §72, §44).

Layering
--------
    Agent -> LlmPort (protocol) -> RoutedLlmClient -+-> OpenAiClient
                                                    +-> PrivateLlmClient (AMD AUP)

`RoutedLlmClient` owns the cross-cutting concerns spec §70 demands of *every*
production LLM request: **model routing, fallback, quota, audit** (retry/timeout live
one level up in `app.agents.base.Agent`, so a fallback hop is not multiplied by the
retry count).

Key rules encoded here
----------------------
* API keys are read **only** from `app.core.config.get_settings()` — never from
  `os.environ` in this layer, never from a request payload, never from the browser
  (spec §70 "API key 不可放 browser").
* `PrivateLlmClient` targets the self-hosted / AMD AUP OpenAI-compatible endpoint
  (spec §72). It is the same wire protocol, different base URL + credential source,
  so both share one HTTP implementation.
* Structured output is requested with a JSON schema (`response_format`), and the
  schema is normalised to the strict dialect (all keys required,
  `additionalProperties: false`) which the providers demand.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol, runtime_checkable

import httpx
import structlog

from app.agents.errors import (
    LlmQuotaExceededError,
    LlmRateLimitError,
    LlmTimeoutError,
    LlmTransportError,
    NoModelAvailableError,
)

log = structlog.get_logger(__name__)

DEFAULT_TIMEOUT_S = 30.0


# ---------------------------------------------------------------------------
# Wire types
# ---------------------------------------------------------------------------
class LlmRole(StrEnum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"


@dataclass(frozen=True, slots=True)
class LlmMessage:
    role: LlmRole
    content: str

    def as_wire(self) -> dict[str, str]:
        return {"role": str(self.role), "content": self.content}


@dataclass(frozen=True, slots=True)
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def __add__(self, other: TokenUsage) -> TokenUsage:
        return TokenUsage(
            self.prompt_tokens + other.prompt_tokens,
            self.completion_tokens + other.completion_tokens,
        )


@dataclass(frozen=True, slots=True)
class LlmCompletion:
    """One non-streaming model answer."""

    text: str
    model: str
    provider: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    latency_ms: int = 0
    finish_reason: str = "stop"
    request_id: str = ""

    def json_payload(self) -> Any:
        """Parse `text` as JSON, tolerating ```json fences some models still emit."""
        return json.loads(strip_code_fence(self.text))


def strip_code_fence(text: str) -> str:
    body = text.strip()
    if not body.startswith("```"):
        return body
    lines = body.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


class ModelPurpose(StrEnum):
    """Routing keys — spec §44 "Model / AI Runtime Settings"."""

    PERSONA = "persona"          # customer agent: fluent, in-character, streamed
    COACH = "coach"              # coach insights
    KNOWLEDGE = "knowledge"      # grounded RAG answering
    EVALUATOR = "evaluator"      # scoring; may run on the private evaluation model
    COMPLIANCE = "compliance"    # cheap + fast, runs on every turn
    INTENT = "intent"            # cheap classifier
    DIRECTOR = "director"        # optional narrative colour for injected events
    MINING = "mining"            # knowledge mining (batch)
    QUESTION_GEN = "question_gen"


# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------
@runtime_checkable
class LlmPort(Protocol):
    """The only surface an agent is allowed to depend on."""

    provider: str

    async def complete(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        schema: Mapping[str, Any] | None = None,
        schema_name: str = "Output",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> LlmCompletion: ...

    def stream(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> AsyncIterator[str]: ...


@runtime_checkable
class QuotaGuard(Protocol):
    """Spec §70 "quota" + §46 billing. Checked before spend, charged after."""

    async def check(self, tenant_id: str, workspace_id: str, purpose: ModelPurpose) -> None: ...

    async def charge(
        self, tenant_id: str, workspace_id: str, purpose: ModelPurpose, usage: TokenUsage
    ) -> None: ...


@runtime_checkable
class LlmAuditSink(Protocol):
    """Spec §70 "audit" + §42 audit log. Never receives raw prompt content."""

    async def record(self, entry: Mapping[str, Any]) -> None: ...


class NullQuotaGuard:
    """Permissive guard used in tests and single-tenant POC deployments."""

    provider = "null"

    async def check(self, tenant_id: str, workspace_id: str, purpose: ModelPurpose) -> None:
        return None

    async def charge(
        self, tenant_id: str, workspace_id: str, purpose: ModelPurpose, usage: TokenUsage
    ) -> None:
        return None


class InMemoryQuotaGuard:
    """Token budget per (tenant, workspace). Process-local; a Redis-backed
    implementation belongs in `app.services` once billing lands (§46)."""

    def __init__(self, limit_tokens: int) -> None:
        self._limit = limit_tokens
        self._used: dict[tuple[str, str], int] = {}

    async def check(self, tenant_id: str, workspace_id: str, purpose: ModelPurpose) -> None:
        if self._used.get((tenant_id, workspace_id), 0) >= self._limit:
            raise LlmQuotaExceededError(
                f"token quota exhausted for workspace {workspace_id} (limit {self._limit})"
            )

    async def charge(
        self, tenant_id: str, workspace_id: str, purpose: ModelPurpose, usage: TokenUsage
    ) -> None:
        key = (tenant_id, workspace_id)
        self._used[key] = self._used.get(key, 0) + usage.total_tokens


class StructlogAuditSink:
    """Default audit sink: structured logs only, no prompt/response bodies (§49.5)."""

    async def record(self, entry: Mapping[str, Any]) -> None:
        log.info("llm.audit", **dict(entry))


# ---------------------------------------------------------------------------
# JSON schema normalisation for structured output
# ---------------------------------------------------------------------------
def to_strict_schema(schema: Mapping[str, Any]) -> dict[str, Any]:
    """Normalise a Pydantic JSON schema into the providers' strict dialect.

    Providers that support `response_format={"type": "json_schema", strict: true}`
    require every property to be listed in `required` and objects to declare
    `additionalProperties: false`. Optional fields therefore become nullable unions,
    which Pydantic accepts back for `X | None` fields.
    """

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(item) for item in node]
        if not isinstance(node, dict):
            return node
        out = {k: walk(v) for k, v in node.items()}
        if out.get("type") == "object" or "properties" in out:
            props = out.get("properties") or {}
            out.setdefault("type", "object")
            out["additionalProperties"] = False
            out["required"] = list(props.keys())
        return out

    return walk(dict(schema))


# ---------------------------------------------------------------------------
# HTTP client shared by OpenAI and the private OpenAI-compatible endpoint
# ---------------------------------------------------------------------------
class _OpenAiCompatibleClient:
    """Chat Completions over HTTP: non-streaming, streaming, JSON-schema output."""

    provider = "openai-compatible"

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        models: Mapping[ModelPurpose, str],
        default_model: str,
        organization: str | None = None,
        client: httpx.AsyncClient | None = None,
        supports_json_schema: bool = True,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._models = dict(models)
        self._default_model = default_model
        self._organization = organization
        self._client = client
        self._supports_json_schema = supports_json_schema

    # -- plumbing ----------------------------------------------------------
    def model_for(self, purpose: ModelPurpose) -> str:
        return self._models.get(purpose, self._default_model)

    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if self._organization:
            headers["OpenAI-Organization"] = self._organization
        return headers

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=self._base_url, timeout=DEFAULT_TIMEOUT_S)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _body(
        self,
        messages: Sequence[LlmMessage],
        *,
        model: str,
        temperature: float,
        max_tokens: int | None,
        schema: Mapping[str, Any] | None,
        schema_name: str,
        stream: bool,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": model,
            "messages": [m.as_wire() for m in messages],
            "temperature": temperature,
            "stream": stream,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens
        if schema is not None and not stream:
            if self._supports_json_schema:
                body["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": schema_name,
                        "strict": True,
                        "schema": to_strict_schema(schema),
                    },
                }
            else:
                # Older / smaller self-hosted servers only implement json_object.
                # The prompt still carries the schema, and `Agent` re-validates.
                body["response_format"] = {"type": "json_object"}
        return body

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code == 429:
            raise LlmRateLimitError(f"provider throttled: {response.text[:200]}")
        if response.status_code >= 500:
            raise LlmTransportError(f"provider {response.status_code}: {response.text[:200]}")
        if response.status_code >= 400:
            # 4xx other than 429 is a request bug: not retryable, but the agent's
            # repair pass may still fix a schema problem, so surface it as transport.
            raise LlmTransportError(f"provider {response.status_code}: {response.text[:200]}")

    # -- LlmPort -----------------------------------------------------------
    async def complete(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        schema: Mapping[str, Any] | None = None,
        schema_name: str = "Output",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> LlmCompletion:
        model = self.model_for(purpose)
        body = self._body(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            schema=schema,
            schema_name=schema_name,
            stream=False,
        )
        started = time.perf_counter()
        try:
            response = await self._http().post(
                "/chat/completions", json=body, headers=self._headers(), timeout=timeout_s
            )
        except httpx.TimeoutException as exc:
            raise LlmTimeoutError(f"{self.provider} timeout after {timeout_s}s") from exc
        except httpx.HTTPError as exc:  # connection reset, DNS, proxy...
            raise LlmTransportError(f"{self.provider} transport error: {exc}") from exc
        self._raise_for_status(response)
        payload = response.json()
        choice = (payload.get("choices") or [{}])[0]
        usage_raw = payload.get("usage") or {}
        return LlmCompletion(
            text=(choice.get("message") or {}).get("content") or "",
            model=payload.get("model", model),
            provider=self.provider,
            usage=TokenUsage(
                prompt_tokens=int(usage_raw.get("prompt_tokens", 0)),
                completion_tokens=int(usage_raw.get("completion_tokens", 0)),
            ),
            latency_ms=int((time.perf_counter() - started) * 1000),
            finish_reason=choice.get("finish_reason") or "stop",
            request_id=str(payload.get("id") or ""),
        )

    async def stream(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> AsyncIterator[str]:
        model = self.model_for(purpose)
        body = self._body(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            schema=None,
            schema_name="Output",
            stream=True,
        )
        try:
            async with self._http().stream(
                "POST",
                "/chat/completions",
                json=body,
                headers=self._headers(),
                timeout=timeout_s,
            ) as response:
                self._raise_for_status(response)
                async for line in response.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    for choice in chunk.get("choices") or []:
                        delta = (choice.get("delta") or {}).get("content")
                        if delta:
                            yield delta
        except httpx.TimeoutException as exc:
            raise LlmTimeoutError(f"{self.provider} stream timeout after {timeout_s}s") from exc
        except httpx.HTTPError as exc:
            raise LlmTransportError(f"{self.provider} stream transport error: {exc}") from exc


class OpenAiClient(_OpenAiCompatibleClient):
    """Public OpenAI Chat Completions (spec §70).

    Reached only from the AI Orchestration API — Browser -> BFF -> Orchestration ->
    OpenAI. The key comes from settings and never leaves this process.
    """

    provider = "openai"

    @classmethod
    def from_settings(cls, client: httpx.AsyncClient | None = None) -> OpenAiClient:
        # Imported lazily so that importing this module never requires the API
        # platform's settings object to be constructible (keeps tests hermetic).
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        return cls(
            base_url=getattr(settings, "openai_base_url", "https://api.openai.com/v1"),
            api_key=_secret(getattr(settings, "openai_api_key", "")),
            organization=getattr(settings, "openai_organization", None),
            default_model=getattr(settings, "openai_default_model", "gpt-4o-mini"),
            models={
                ModelPurpose.PERSONA: getattr(settings, "model_persona", "gpt-4o"),
                ModelPurpose.COACH: getattr(settings, "model_coach", "gpt-4o-mini"),
                ModelPurpose.KNOWLEDGE: getattr(settings, "model_knowledge", "gpt-4o-mini"),
                ModelPurpose.EVALUATOR: getattr(settings, "model_evaluator", "gpt-4o"),
                ModelPurpose.COMPLIANCE: getattr(settings, "model_compliance", "gpt-4o-mini"),
                ModelPurpose.INTENT: getattr(settings, "model_intent", "gpt-4o-mini"),
                ModelPurpose.DIRECTOR: getattr(settings, "model_director", "gpt-4o-mini"),
                ModelPurpose.MINING: getattr(settings, "model_mining", "gpt-4o-mini"),
                ModelPurpose.QUESTION_GEN: getattr(settings, "model_question_gen", "gpt-4o"),
            },
            client=client,
            supports_json_schema=True,
        )


class PrivateLlmClient(_OpenAiCompatibleClient):
    """Self-hosted / AMD AUP OpenAI-compatible endpoint (spec §72).

    Spec §72 puts *private LLM if used*, the evaluation model, the reranker and local
    embeddings inside the AMD AUP environment. Those deployments (vLLM, TGI,
    llama.cpp server, Ollama's OpenAI shim) speak Chat Completions but frequently do
    **not** implement `response_format=json_schema`; `supports_json_schema` therefore
    defaults to False and the schema is carried in the prompt, with
    `Agent._invoke_structured` doing authoritative validation + one repair pass.
    """

    provider = "private"

    @classmethod
    def from_settings(cls, client: httpx.AsyncClient | None = None) -> PrivateLlmClient:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        default = getattr(settings, "private_llm_default_model", "qwen2.5-14b-instruct")
        return cls(
            base_url=getattr(settings, "private_llm_base_url", "http://llm.aup.internal/v1"),
            api_key=_secret(getattr(settings, "private_llm_api_key", "")),
            default_model=default,
            models={
                ModelPurpose.EVALUATOR: getattr(settings, "private_model_evaluator", default),
                ModelPurpose.COMPLIANCE: getattr(settings, "private_model_compliance", default),
                ModelPurpose.INTENT: getattr(settings, "private_model_intent", default),
            },
            client=client,
            supports_json_schema=bool(
                getattr(settings, "private_llm_supports_json_schema", False)
            ),
        )


def _secret(value: Any) -> str:
    """Accept `SecretStr` or `str` from settings without importing pydantic here."""
    getter = getattr(value, "get_secret_value", None)
    return str(getter()) if callable(getter) else str(value or "")


# ---------------------------------------------------------------------------
# Routing + fallback + quota + audit
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class ModelRoute:
    """Which backend serves a purpose, and what to do when it fails."""

    purpose: ModelPurpose
    primary: str                      # provider name, e.g. "openai" / "private"
    fallbacks: tuple[str, ...] = ()


#: Default policy: persona/coach quality on the public API, and the compliance +
#: evaluation path preferring the private AMD AUP deployment (§72) with the public
#: API as a fallback so a private-endpoint outage cannot stall a live session.
DEFAULT_ROUTES: dict[ModelPurpose, ModelRoute] = {
    ModelPurpose.PERSONA: ModelRoute(ModelPurpose.PERSONA, "openai", ("private",)),
    ModelPurpose.COACH: ModelRoute(ModelPurpose.COACH, "openai", ("private",)),
    ModelPurpose.KNOWLEDGE: ModelRoute(ModelPurpose.KNOWLEDGE, "openai", ("private",)),
    ModelPurpose.EVALUATOR: ModelRoute(ModelPurpose.EVALUATOR, "private", ("openai",)),
    ModelPurpose.COMPLIANCE: ModelRoute(ModelPurpose.COMPLIANCE, "private", ("openai",)),
    ModelPurpose.INTENT: ModelRoute(ModelPurpose.INTENT, "private", ("openai",)),
    ModelPurpose.DIRECTOR: ModelRoute(ModelPurpose.DIRECTOR, "openai", ()),
    ModelPurpose.MINING: ModelRoute(ModelPurpose.MINING, "private", ("openai",)),
    ModelPurpose.QUESTION_GEN: ModelRoute(ModelPurpose.QUESTION_GEN, "openai", ("private",)),
}


class RoutedLlmClient:
    """`LlmPort` implementation that fans out to the configured providers."""

    provider = "routed"

    def __init__(
        self,
        providers: Mapping[str, LlmPort],
        *,
        tenant_id: str,
        workspace_id: str,
        request_id: str = "",
        routes: Mapping[ModelPurpose, ModelRoute] | None = None,
        quota: QuotaGuard | None = None,
        audit: LlmAuditSink | None = None,
    ) -> None:
        if not providers:
            raise ValueError("RoutedLlmClient needs at least one provider")
        self._providers = dict(providers)
        self._routes = dict(routes or DEFAULT_ROUTES)
        self._quota: QuotaGuard = quota or NullQuotaGuard()
        self._audit: LlmAuditSink = audit or StructlogAuditSink()
        self._tenant_id = tenant_id
        self._workspace_id = workspace_id
        self._request_id = request_id
        self.last_usage = TokenUsage()

    # -- helpers -----------------------------------------------------------
    def _chain(self, purpose: ModelPurpose) -> list[LlmPort]:
        route = self._routes.get(purpose)
        names = [route.primary, *route.fallbacks] if route else list(self._providers)
        chain = [self._providers[n] for n in names if n in self._providers]
        return chain or list(self._providers.values())

    async def _audit_entry(self, **fields: Any) -> None:
        await self._audit.record(
            {
                "tenant_id": self._tenant_id,
                "workspace_id": self._workspace_id,
                "request_id": self._request_id,
                **fields,
            }
        )

    # -- LlmPort -----------------------------------------------------------
    async def complete(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        schema: Mapping[str, Any] | None = None,
        schema_name: str = "Output",
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> LlmCompletion:
        await self._quota.check(self._tenant_id, self._workspace_id, purpose)
        call_id = uuid.uuid4().hex
        failures: list[str] = []
        for index, client in enumerate(self._chain(purpose)):
            try:
                completion = await client.complete(
                    messages,
                    purpose=purpose,
                    schema=schema,
                    schema_name=schema_name,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout_s=timeout_s,
                )
            except LlmQuotaExceededError:
                raise
            except (LlmTransportError, LlmTimeoutError, LlmRateLimitError) as exc:
                failures.append(f"{client.provider}:{type(exc).__name__}")
                await self._audit_entry(
                    event="llm.call.failed",
                    call_id=call_id,
                    purpose=str(purpose),
                    provider=client.provider,
                    attempt=index,
                    error=type(exc).__name__,
                )
                continue
            self.last_usage = completion.usage
            await self._quota.charge(
                self._tenant_id, self._workspace_id, purpose, completion.usage
            )
            await self._audit_entry(
                event="llm.call",
                call_id=call_id,
                purpose=str(purpose),
                provider=completion.provider,
                model=completion.model,
                fell_back=index > 0,
                prompt_tokens=completion.usage.prompt_tokens,
                completion_tokens=completion.usage.completion_tokens,
                latency_ms=completion.latency_ms,
                structured=schema is not None,
            )
            return completion
        raise NoModelAvailableError(
            f"all providers failed for purpose={purpose}: {', '.join(failures) or 'no provider'}"
        )

    async def stream(
        self,
        messages: Sequence[LlmMessage],
        *,
        purpose: ModelPurpose,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> AsyncIterator[str]:
        await self._quota.check(self._tenant_id, self._workspace_id, purpose)
        call_id = uuid.uuid4().hex
        chain = self._chain(purpose)
        for index, client in enumerate(chain):
            emitted = False
            try:
                async for delta in client.stream(
                    messages,
                    purpose=purpose,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout_s=timeout_s,
                ):
                    emitted = True
                    yield delta
            except (LlmTransportError, LlmTimeoutError, LlmRateLimitError) as exc:
                await self._audit_entry(
                    event="llm.stream.failed",
                    call_id=call_id,
                    purpose=str(purpose),
                    provider=client.provider,
                    attempt=index,
                    error=type(exc).__name__,
                    partial=emitted,
                )
                # Once bytes reached the client we must not restart on another
                # provider: the trainee would see two half answers. Fail the turn
                # instead and let the orchestrator degrade (§49.4).
                if emitted or index == len(chain) - 1:
                    raise
                continue
            await self._audit_entry(
                event="llm.stream",
                call_id=call_id,
                purpose=str(purpose),
                provider=client.provider,
                fell_back=index > 0,
            )
            return


__all__ = [
    "DEFAULT_ROUTES",
    "DEFAULT_TIMEOUT_S",
    "InMemoryQuotaGuard",
    "LlmAuditSink",
    "LlmCompletion",
    "LlmMessage",
    "LlmPort",
    "LlmRole",
    "ModelPurpose",
    "ModelRoute",
    "NullQuotaGuard",
    "OpenAiClient",
    "PrivateLlmClient",
    "QuotaGuard",
    "RoutedLlmClient",
    "StructlogAuditSink",
    "TokenUsage",
    "to_strict_schema",
]
