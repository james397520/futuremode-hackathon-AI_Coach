"""structlog JSON logging that structurally cannot leak input text (spec §49.5).

Why this is a module and not a code-review rule
-----------------------------------------------
This service sees every sentence in every customer knowledge base and every
trainee utterance that gets embedded. §49.5 asks for "WebGPU backend telemetry
**without collecting sensitive content**", and the same constraint applies far
more sharply here: a single ``log.info("embed", texts=texts)`` would turn the
log aggregator into an unaudited copy of the customer's document corpus, outside
the tenant isolation boundary of §74 and outside the AMD AUP boundary of §72.
Logs are also retained longer, replicated wider and access-controlled more
loosely than the database is. So "do not log the text" is enforced twice:

1. **A typed emit surface.** :func:`log_inference` accepts only the keys in
   :class:`InferenceLogFields` — model ids, token counts, batch sizes, latencies,
   counts, status codes. There is no ``text`` key to pass. Under the project's
   strict mypy settings, an attempt to log content is a type error at the call
   site, before review and before runtime.
2. **A redaction processor.** :func:`redact_processor` runs on every event from
   every code path — including third-party libraries and ``logging`` records
   bridged into structlog — and replaces the value of any suspiciously-named key,
   masks e-mail/bearer/long-digit patterns inside remaining strings, and truncates
   anything longer than :data:`MAX_STRING_LENGTH`. What it removed is recorded in
   ``redacted`` so an auditor can see redaction happened rather than inferring it.

Layer 1 is the one that keeps the logs *useful* (you get numbers, not
``[redacted]`` everywhere). Layer 2 is the one that holds when someone adds a
call site in a hurry.

Key names are the same set as ``apps/api/app/core/logging.py`` so a field that is
redacted in one service is not accidentally printed by the other.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import TYPE_CHECKING, Any, Final, TypedDict, Unpack

import orjson
import structlog

if TYPE_CHECKING:
    from structlog.types import EventDict, Processor, WrappedLogger

    from app.core.config import Settings

# ---------------------------------------------------------------------------
# Redaction policy
# ---------------------------------------------------------------------------

#: Exact key names whose value must never enter the log stream.
SENSITIVE_KEYS: Final[frozenset[str]] = frozenset(
    {
        # model input / output content (§49.5)
        "text",
        "texts",
        "input",
        "inputs",
        "document",
        "documents",
        "query",
        "queries",
        "passage",
        "passages",
        "chunk",
        "chunks",
        "content",
        "body",
        "prompt",
        "prompts",
        "completion",
        "message",
        "messages",
        "transcript",
        "snippet",
        "quote",
        "evidence",
        "answer",
        "pair",
        "pairs",
        # decoded model artefacts that reconstruct the input
        "tokens",
        "token_strings",
        "input_ids",
        "embedding",
        "embeddings",
        "vector",
        "vectors",
        # identity / PII
        "email",
        "e_mail",
        "phone",
        "display_name",
        "full_name",
        "user_name",
        # credentials
        "authorization",
        "secret",
        "shared_secret",
        "password",
        "api_key",
        "token",
    }
)

#: Suffixes that mark a credential regardless of prefix.
SENSITIVE_SUFFIXES: Final[tuple[str, ...]] = ("_key", "_token", "_secret", "_password", "_text")

#: Truncation ceiling for any string that survives key-based redaction. A stray
#: payload dump cannot smuggle a paragraph into the log stream.
MAX_STRING_LENGTH: Final[int] = 200
#: How deep the walker descends into nested dicts/lists.
MAX_DEPTH: Final[int] = 4
#: Guard against logging a giant list of numbers.
MAX_SEQUENCE_ITEMS: Final[int] = 20

REDACTED: Final[str] = "[redacted]"
TRUNCATED_SUFFIX: Final[str] = "…[truncated]"

_EMAIL_RE: Final[re.Pattern[str]] = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
)
#: 9+ consecutive digits: card, national id and phone shaped.
_LONG_DIGITS_RE: Final[re.Pattern[str]] = re.compile(r"\d{9,}")
_BEARER_RE: Final[re.Pattern[str]] = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{8,}")

#: Keys the processor must leave alone even though the walker sees them.
_STRUCTURAL_KEYS: Final[frozenset[str]] = frozenset(
    {"event", "level", "logger", "timestamp", "exception", "exc_info", "redacted"}
)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in SENSITIVE_KEYS or lowered.endswith(SENSITIVE_SUFFIXES)


def _mask_patterns(value: str) -> str:
    masked = _EMAIL_RE.sub("[email]", value)
    masked = _BEARER_RE.sub("Bearer [redacted]", masked)
    return _LONG_DIGITS_RE.sub("[digits]", masked)


def _scrub(value: Any, depth: int) -> Any:
    """Recursively mask patterns and truncate strings. Never raises."""
    if isinstance(value, str):
        masked = _mask_patterns(value)
        if len(masked) > MAX_STRING_LENGTH:
            return masked[:MAX_STRING_LENGTH] + TRUNCATED_SUFFIX
        return masked
    if isinstance(value, (bool, int, float, type(None))):
        return value
    if depth >= MAX_DEPTH:
        return f"[{type(value).__name__}]"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for raw_key, raw_value in list(value.items())[:MAX_SEQUENCE_ITEMS]:
            key = str(raw_key)
            out[key] = REDACTED if _is_sensitive_key(key) else _scrub(raw_value, depth + 1)
        return out
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        scrubbed = [_scrub(item, depth + 1) for item in items[:MAX_SEQUENCE_ITEMS]]
        if len(items) > MAX_SEQUENCE_ITEMS:
            scrubbed.append(f"[+{len(items) - MAX_SEQUENCE_ITEMS} more]")
        return scrubbed
    # Unknown object: log its type, never its repr. A repr can contain the very
    # text we are protecting (e.g. a pydantic request model).
    return f"[{type(value).__name__}]"


def redact_processor(
    _logger: WrappedLogger,
    _method: str,
    event_dict: EventDict,
) -> EventDict:
    """Mandatory redaction stage. Runs on every event before any renderer."""
    removed: list[str] = []
    for key in list(event_dict.keys()):
        if key in _STRUCTURAL_KEYS:
            continue
        if _is_sensitive_key(key):
            event_dict[key] = REDACTED
            removed.append(key)
            continue
        event_dict[key] = _scrub(event_dict[key], 1)
    # `event` itself is a developer-authored constant, but scrub it anyway: an
    # f-string that interpolated user input is exactly the regression we fear.
    message = event_dict.get("event")
    if isinstance(message, str):
        event_dict["event"] = _scrub(message, MAX_DEPTH - 1)
    if removed:
        event_dict["redacted"] = sorted(removed)
    return event_dict


# ---------------------------------------------------------------------------
# The typed emit surface (layer 1)
# ---------------------------------------------------------------------------


class InferenceLogFields(TypedDict, total=False):
    """The only fields an inference code path may log.

    Everything here is a number, an identifier, or an enum value. There is
    deliberately no key that can hold model input or output content — that is the
    "enforce it in the type" half of the §49.5 guarantee.
    """

    request_id: str
    model: str
    model_task: str
    device: str
    provider: str
    #: number of texts / pairs in the request
    item_count: int
    #: number of ONNX executions the request was split into
    batch_count: int
    batch_size: int
    max_batch_size: int
    #: sum of non-padding tokens actually fed to the model
    token_count: int
    #: tokens including padding — the two together show how well batching worked
    padded_token_count: int
    max_sequence_length: int
    truncated_count: int
    dimension: int
    top_k: int
    duration_ms: float
    queue_wait_ms: float
    tokenize_ms: float
    inference_ms: float
    status: int
    code: str
    #: bytes of resident model weights, for eviction accounting
    resident_mb: float
    loaded_models: int
    evicted: str
    reason: str
    attempt: int
    error_type: str


def log_inference(
    logger: Any,
    event: str,
    **fields: Unpack[InferenceLogFields],
) -> None:
    """Emit an inference telemetry event.

    Use this instead of ``logger.info(...)`` on request paths. mypy rejects any
    key not declared in :class:`InferenceLogFields`, so there is no spelling of
    this call that logs the caller's text.
    """
    logger.info(event, **fields)


def get_logger(name: str) -> Any:
    """A bound structlog logger. ``Any`` because structlog's BindableLogger is
    a runtime protocol and annotating it buys nothing under strict mypy."""
    return structlog.get_logger(name)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _orjson_dumps(obj: Any, default: Any = None, **_: Any) -> str:
    return orjson.dumps(obj, default=default or repr).decode("utf-8")


def _build_processors(*, json_output: bool) -> list[Processor]:
    processors: list[Processor] = [
        # contextvars first, so request-scoped bound values are redacted too.
        structlog.contextvars.merge_contextvars,
        redact_processor,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]
    if json_output:
        processors += [
            # `format_exc_info` renders exc_info to a string. It runs *after*
            # redaction, which means a traceback is not walked by the scrubber —
            # that is why errors.py logs `exc_info` only in the unhandled handler
            # and never returns the traceback to the caller.
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(serializer=_orjson_dumps),
        ]
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()))
    return processors


def configure_logging(settings: Settings) -> None:
    """Install the processor chain. Idempotent; safe to call from tests."""
    level = getattr(logging, settings.log_level, logging.INFO)

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
        force=True,
    )
    # uvicorn's access log duplicates our own request log and prints the raw path.
    # Query strings must never carry content here, but silencing it removes the
    # question entirely.
    logging.getLogger("uvicorn.access").handlers = []
    logging.getLogger("uvicorn.access").propagate = False

    structlog.configure(
        processors=_build_processors(json_output=settings.log_json),
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def bind_request_id(request_id: str) -> None:
    """Bind the request id for the duration of this task."""
    structlog.contextvars.bind_contextvars(request_id=request_id)


def clear_log_context() -> None:
    """Unbind everything. Called at the end of every request."""
    structlog.contextvars.clear_contextvars()


__all__ = [
    "MAX_STRING_LENGTH",
    "REDACTED",
    "SENSITIVE_KEYS",
    "SENSITIVE_SUFFIXES",
    "InferenceLogFields",
    "bind_request_id",
    "clear_log_context",
    "configure_logging",
    "get_logger",
    "log_inference",
    "redact_processor",
]
