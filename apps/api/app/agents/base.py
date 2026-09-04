"""`Agent` ABC — the structured-output contract every agent obeys (spec §66).

    每一個 Agent 必須輸出 structured data.  (spec §66)

Concretely: an agent never returns free text to the rest of the system. It returns a
validated Pydantic model. The only place raw model text exists is inside
`_invoke_structured`, which:

1. sends the JSON schema of `output_model` to the provider (strict structured output
   where the provider supports it, schema-in-prompt where it does not),
2. validates the answer against `output_model`,
3. on failure performs **exactly one** bounded repair round-trip that shows the model
   its own output plus the validator error, and
4. raises `OutputValidationError` if that still fails.

Transport failures are retried separately with `tenacity` (exponential backoff,
spec §49.4), under an `asyncio.timeout` budget, and every call emits token/latency
telemetry (spec §49.5 "LLM latency / token usage").

Streaming agents (only the customer agent today) additionally get
`_stream_with_state`, which streams the human-visible sentence to the trainee while
still ending with a validated structured payload — see `customer_agent.py`.
"""

from __future__ import annotations

import asyncio
import json
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar, Generic, Protocol, TypeVar, runtime_checkable

import structlog
from pydantic import BaseModel, ValidationError
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.agents.errors import (
    AgentError,
    LlmRateLimitError,
    LlmTimeoutError,
    LlmTransportError,
    OutputValidationError,
)
from app.agents.llm_client import (
    LlmMessage,
    LlmPort,
    LlmRole,
    ModelPurpose,
    TokenUsage,
    strip_code_fence,
)

log = structlog.get_logger(__name__)

InT = TypeVar("InT")
OutT = TypeVar("OutT", bound=BaseModel)

#: Sentinel that separates the human-visible utterance from the machine state block
#: in streamed persona turns. Chosen to be something no natural sentence contains.
STATE_SENTINEL = "<<<STATE>>>"


@dataclass(slots=True)
class AgentTelemetry:
    """Per-run observability record (spec §49.5, no prompt/response bodies)."""

    agent: str
    purpose: str
    latency_ms: int = 0
    usage: TokenUsage = field(default_factory=TokenUsage)
    attempts: int = 0
    repaired: bool = False
    ok: bool = True
    error: str | None = None
    model: str = ""
    provider: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "agent": self.agent,
            "purpose": self.purpose,
            "latency_ms": self.latency_ms,
            "prompt_tokens": self.usage.prompt_tokens,
            "completion_tokens": self.usage.completion_tokens,
            "attempts": self.attempts,
            "repaired": self.repaired,
            "ok": self.ok,
            "error": self.error,
            "model": self.model,
            "provider": self.provider,
        }


@runtime_checkable
class TelemetrySink(Protocol):
    def record(self, telemetry: AgentTelemetry) -> None: ...


class StructlogTelemetrySink:
    def record(self, telemetry: AgentTelemetry) -> None:
        log.info("agent.run", **telemetry.as_dict())


class CollectingTelemetrySink:
    """Keeps telemetry in memory — used by the orchestrator to build a turn trace."""

    def __init__(self) -> None:
        self.records: list[AgentTelemetry] = []

    def record(self, telemetry: AgentTelemetry) -> None:
        self.records.append(telemetry)

    @property
    def total_usage(self) -> TokenUsage:
        total = TokenUsage()
        for item in self.records:
            total = total + item.usage
        return total


class Agent(ABC, Generic[InT, OutT]):
    """Base class for every agent in the §19 topology."""

    #: One of `AGENT_NAMES` in packages/shared/src/events.ts — the value is
    #: used verbatim in the `agent.thinking` streaming event.
    name: ClassVar[str] = "orchestrator"
    purpose: ClassVar[ModelPurpose] = ModelPurpose.KNOWLEDGE
    output_model: ClassVar[type[BaseModel]]

    #: Agents whose failure must not abort the turn (spec §49.4).
    optional: ClassVar[bool] = False

    default_temperature: ClassVar[float] = 0.4
    default_max_tokens: ClassVar[int | None] = 900

    def __init__(
        self,
        llm: LlmPort,
        *,
        locale: str = "zh-TW",
        timeout_s: float = 25.0,
        max_attempts: int = 3,
        temperature: float | None = None,
        max_tokens: int | None = None,
        telemetry: TelemetrySink | None = None,
    ) -> None:
        self.llm = llm
        self.locale = locale
        self.timeout_s = timeout_s
        self.max_attempts = max(1, max_attempts)
        self.temperature = self.default_temperature if temperature is None else temperature
        self.max_tokens = self.default_max_tokens if max_tokens is None else max_tokens
        self.telemetry: TelemetrySink = telemetry or StructlogTelemetrySink()

    # -- prompt hooks ------------------------------------------------------
    @abstractmethod
    def system_prompt(self) -> str:
        """Static role framing. Must contain the injection-resistance clause."""

    @abstractmethod
    def build_user_prompt(self, request: InT) -> str:
        """Render the turn-specific payload. Untrusted text must be delimited."""

    @abstractmethod
    async def run(self, request: InT) -> OutT:
        """Public entry point. Implementations usually call `_invoke_structured`."""

    # -- machinery ---------------------------------------------------------
    def _messages(self, request: InT) -> list[LlmMessage]:
        return [
            LlmMessage(LlmRole.SYSTEM, self.system_prompt()),
            LlmMessage(LlmRole.USER, self.build_user_prompt(request)),
        ]

    def _schema(self) -> dict[str, Any]:
        return self.output_model.model_json_schema()

    async def _invoke_structured(
        self,
        messages: Sequence[LlmMessage],
        *,
        model: type[OutT] | None = None,
        temperature: float | None = None,
    ) -> OutT:
        """Call the model and return validated output, or raise.

        Retry policy:
          * transport/timeout/rate-limit  -> `tenacity`, exponential backoff,
            `max_attempts` tries (spec §49.4).
          * schema violation              -> one repair round-trip, then raise
            `OutputValidationError` (spec §66 — never fall back to free text).
        """
        out_model: type[BaseModel] = model or self.output_model
        telemetry = AgentTelemetry(agent=self.name, purpose=str(self.purpose))
        started = time.perf_counter()
        raw_text = ""
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self.max_attempts),
                wait=wait_exponential(multiplier=0.4, max=4.0),
                retry=retry_if_exception_type(
                    (LlmTransportError, LlmTimeoutError, LlmRateLimitError)
                ),
                reraise=True,
            ):
                with attempt:
                    telemetry.attempts += 1
                    async with asyncio.timeout(self.timeout_s):
                        completion = await self.llm.complete(
                            messages,
                            purpose=self.purpose,
                            schema=out_model.model_json_schema(),
                            schema_name=out_model.__name__,
                            temperature=(
                                self.temperature if temperature is None else temperature
                            ),
                            max_tokens=self.max_tokens,
                            timeout_s=self.timeout_s,
                        )
                    telemetry.usage = telemetry.usage + completion.usage
                    telemetry.model = completion.model
                    telemetry.provider = completion.provider
                    raw_text = completion.text
        except TimeoutError as exc:  # asyncio.timeout
            telemetry.ok = False
            telemetry.error = "timeout"
            raise LlmTimeoutError(f"{self.name} exceeded {self.timeout_s}s") from exc
        except RetryError as exc:  # pragma: no cover - reraise=True makes this rare
            telemetry.ok = False
            telemetry.error = "retry_exhausted"
            raise LlmTransportError(f"{self.name}: retries exhausted") from exc
        except AgentError as exc:
            telemetry.ok = False
            telemetry.error = type(exc).__name__
            raise
        finally:
            telemetry.latency_ms = int((time.perf_counter() - started) * 1000)

        try:
            return self._validate(out_model, raw_text)
        except ValidationError as first_error:
            telemetry.repaired = True
            repaired = await self._repair(messages, out_model, raw_text, first_error)
            self.telemetry.record(telemetry)
            return repaired
        finally:
            if not telemetry.repaired:
                self.telemetry.record(telemetry)

    def _validate(self, out_model: type[BaseModel], raw_text: str) -> Any:
        body = strip_code_fence(raw_text)
        if not body:
            raise ValidationError.from_exception_data(out_model.__name__, [])
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            # A JSON syntax error is a schema violation as far as the caller is
            # concerned; surface it through the same repair path.
            raise _as_validation_error(out_model, f"not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise _as_validation_error(out_model, "top level value must be an object")
        return out_model.model_validate(payload)

    async def _repair(
        self,
        messages: Sequence[LlmMessage],
        out_model: type[BaseModel],
        raw_text: str,
        error: Exception,
    ) -> Any:
        """One bounded repair attempt (never more — spec §66 / §49.4 cost control)."""
        repair_prompt = (
            "你上一次的輸出不符合 schema，無法被程式解析。\n"
            "Your previous output did not satisfy the required JSON schema.\n\n"
            f"### validator_error\n{str(error)[:1200]}\n\n"
            f"### your_previous_output\n{raw_text[:2000]}\n\n"
            f"### required_json_schema\n{json.dumps(out_model.model_json_schema())}\n\n"
            "只輸出修正後、符合 schema 的 JSON 物件，不要任何說明文字或 code fence。"
        )
        repair_messages = [*messages, LlmMessage(LlmRole.USER, repair_prompt)]
        telemetry = AgentTelemetry(
            agent=self.name, purpose=str(self.purpose), attempts=1, repaired=True
        )
        started = time.perf_counter()
        try:
            async with asyncio.timeout(self.timeout_s):
                completion = await self.llm.complete(
                    repair_messages,
                    purpose=self.purpose,
                    schema=out_model.model_json_schema(),
                    schema_name=out_model.__name__,
                    temperature=0.0,
                    max_tokens=self.max_tokens,
                    timeout_s=self.timeout_s,
                )
            telemetry.usage = completion.usage
            telemetry.model = completion.model
            telemetry.provider = completion.provider
            return self._validate(out_model, completion.text)
        except (ValidationError, json.JSONDecodeError) as exc:
            telemetry.ok = False
            telemetry.error = "schema_invalid"
            raise OutputValidationError(self.name, str(exc)[:400], raw=raw_text) from exc
        except TimeoutError as exc:
            telemetry.ok = False
            telemetry.error = "repair_timeout"
            raise LlmTimeoutError(f"{self.name} repair exceeded {self.timeout_s}s") from exc
        finally:
            telemetry.latency_ms = int((time.perf_counter() - started) * 1000)
            self.telemetry.record(telemetry)

    # -- streaming ---------------------------------------------------------
    async def _stream_with_state(
        self,
        messages: Sequence[LlmMessage],
        *,
        on_delta: Callable[[str], Any] | None = None,
        model: type[OutT] | None = None,
    ) -> tuple[str, OutT]:
        """Stream the visible utterance, then validate the trailing state block.

        Wire protocol (documented in the persona prompt): the model emits the reply
        the trainee should see, then `<<<STATE>>>`, then a JSON object matching
        `output_model`. Deltas are forwarded to `on_delta` only until the sentinel, so
        the trainee never sees JSON. If the state block is missing or malformed we do
        **one** non-streaming structured call to recover it — the visible text is kept,
        so a state hiccup cannot corrupt an already-delivered sentence.
        """
        out_model: type[BaseModel] = model or self.output_model
        telemetry = AgentTelemetry(
            agent=self.name, purpose=str(self.purpose), attempts=1, provider=self.llm.provider
        )
        started = time.perf_counter()
        buffer: list[str] = []
        visible_emitted = 0
        try:
            async with asyncio.timeout(self.timeout_s):
                async for delta in self.llm.stream(
                    messages,
                    purpose=self.purpose,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                    timeout_s=self.timeout_s,
                ):
                    buffer.append(delta)
                    whole = "".join(buffer)
                    head, sep, _ = whole.partition(STATE_SENTINEL)
                    # Hold back a sentinel-length tail so we never leak a partial
                    # sentinel into the trainee's transcript.
                    safe_len = len(head) if sep else max(0, len(whole) - len(STATE_SENTINEL))
                    if safe_len > visible_emitted and on_delta is not None:
                        chunk = whole[visible_emitted:safe_len]
                        if chunk:
                            result = on_delta(chunk)
                            if asyncio.iscoroutine(result):
                                await result
                    visible_emitted = max(visible_emitted, safe_len)
        except TimeoutError as exc:
            telemetry.ok = False
            telemetry.error = "stream_timeout"
            self.telemetry.record(telemetry)
            raise LlmTimeoutError(f"{self.name} stream exceeded {self.timeout_s}s") from exc
        except AgentError as exc:
            telemetry.ok = False
            telemetry.error = type(exc).__name__
            self.telemetry.record(telemetry)
            raise
        finally:
            telemetry.latency_ms = int((time.perf_counter() - started) * 1000)

        whole = "".join(buffer)
        visible, _, state_blob = whole.partition(STATE_SENTINEL)
        visible = visible.strip()
        if on_delta is not None and len(visible) > visible_emitted:
            result = on_delta(visible[visible_emitted:])
            if asyncio.iscoroutine(result):
                await result
        try:
            state = self._validate(out_model, state_blob)
        except (ValidationError, json.JSONDecodeError):
            telemetry.repaired = True
            state = await self._recover_state(messages, out_model, visible)
        self.telemetry.record(telemetry)
        return visible, state  # type: ignore[return-value]

    async def _recover_state(
        self,
        messages: Sequence[LlmMessage],
        out_model: type[BaseModel],
        visible: str,
    ) -> Any:
        recovery = [
            *messages,
            LlmMessage(
                LlmRole.ASSISTANT,
                visible or "(empty)",
            ),
            LlmMessage(
                LlmRole.USER,
                "上面是你剛才對學員說的話。現在只輸出對應的 state JSON 物件，"
                "符合 schema，不要重複對話內容、不要 code fence。\n\n"
                f"### required_json_schema\n{json.dumps(out_model.model_json_schema())}",
            ),
        ]
        return await self._invoke_structured(recovery, model=out_model, temperature=0.0)

    # -- convenience -------------------------------------------------------
    async def safe_run(self, request: InT) -> OutT | None:
        """Run and swallow failures for non-critical agents (spec §49.4).

        The orchestrator uses this for the coach/evaluator/knowledge legs so a single
        agent outage degrades the turn instead of failing it.
        """
        try:
            return await self.run(request)
        except AgentError as exc:
            log.warning("agent.degraded", agent=self.name, error=type(exc).__name__, detail=str(exc))
            return None
        except (TimeoutError, asyncio.CancelledError):
            raise
        except Exception as exc:  # noqa: BLE001 - last line of defence around a model call
            log.warning("agent.unexpected", agent=self.name, error=repr(exc))
            return None


def _as_validation_error(out_model: type[BaseModel], message: str) -> ValidationError:
    return ValidationError.from_exception_data(
        out_model.__name__,
        [
            {
                "type": "value_error",
                "loc": (),
                "input": None,
                "ctx": {"error": ValueError(message)},
            }
        ],
    )


async def gather_degrading(*aws: Any) -> list[Any]:
    """`asyncio.gather` that returns `None` for legs that raised (spec §49.4)."""
    results = await asyncio.gather(*aws, return_exceptions=True)
    out: list[Any] = []
    for item in results:
        if isinstance(item, asyncio.CancelledError):
            raise item
        if isinstance(item, BaseException):
            log.warning("agent.leg_failed", error=repr(item))
            out.append(None)
        else:
            out.append(item)
    return out


async def stream_to_list(stream: AsyncIterator[str]) -> list[str]:
    """Test helper: drain an async token stream."""
    return [chunk async for chunk in stream]


__all__ = [
    "STATE_SENTINEL",
    "Agent",
    "AgentTelemetry",
    "CollectingTelemetrySink",
    "StructlogTelemetrySink",
    "TelemetrySink",
    "gather_degrading",
    "stream_to_list",
]
