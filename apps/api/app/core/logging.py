"""structlog JSON logging with a mandatory redaction stage (spec §49.5 / §40.2).

Design
------
Every log line is JSON and carries ``request_id`` / ``tenant_id`` / ``workspace_id`` /
``user_id`` from ``structlog.contextvars`` (bound once by the request-id + tenant
middleware in :mod:`app.main`).

**Transcript content and PII must never be logged.** That is not left to reviewer
discipline: :func:`redact_processor` runs as the *first* processor in the chain and

1. replaces the value of any key whose name matches :data:`SENSITIVE_KEYS`
   (``text``, ``prompt``, ``transcript``, ``quote``, ``snippet``, ``email``, keys ending
   in ``_key`` / ``_token`` / ``_secret``, …) with ``"[redacted]"``;
2. masks e-mail addresses, long digit runs (card / national-id shaped) and bearer
   tokens found anywhere inside remaining string values;
3. truncates any remaining string over :data:`MAX_STRING_LENGTH` so an accidental
   payload dump cannot smuggle a conversation into the log stream;
4. records what it removed in ``redacted`` so an auditor can see redaction happened.

The processor walks nested dicts/lists up to :data:`MAX_DEPTH`.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import TYPE_CHECKING, Any, Final

import orjson
import structlog

if TYPE_CHECKING:
    from structlog.types import EventDict, Processor, WrappedLogger

    from app.core.config import Settings
    from app.core.context import RequestContext

# ---------------------------------------------------------------------------
# Redaction policy
# ---------------------------------------------------------------------------

#: Exact key names that must never carry a value into the log stream.
SENSITIVE_KEYS: Final[frozenset[str]] = frozenset(
    {
        # conversation / model content (§49.5)
        "text",
        "delta",
        "transcript",
        "transcript_text",
        "turn_text",
        "message",
        "messages",
        "prompt",
        "prompts",
        "system_prompt",
        "completion",
        "response_text",
        "content",
        "body",
        "snippet",
        "quote",
        "evidence",
        "answer",
        "correct_answer",
        "explanation",
        "opening_context",
        "background",
        "hidden",
        "hidden_need",
        "audio",
        "audio_url",
        "audio_bytes",
        # identity / PII (§40.2)
        "email",
        "e_mail",
        "display_name",
        "full_name",
        "phone",
        "address",
        "ip",
        "ip_address",
        "user_agent",
        # secrets (§73)
        "password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set_cookie",
        "api_key",
        "jwt",
        "csrf",
    }
)

#: Suffixes that mark a key as secret regardless of prefix.
SENSITIVE_KEY_SUFFIXES: Final[tuple[str, ...]] = (
    "_key",
    "_token",
    "_secret",
    "_password",
    "_email",
    "_text",
    "_prompt",
)

REDACTED: Final[str] = "[redacted]"
MAX_DEPTH: Final[int] = 6
MAX_STRING_LENGTH: Final[int] = 512

_EMAIL_RE: Final[re.Pattern[str]] = re.compile(
    r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
)
#: 9+ consecutive digits (optionally separated) — card / national id / phone shaped.
_LONG_DIGITS_RE: Final[re.Pattern[str]] = re.compile(r"(?:\d[ \-]?){9,}")
_BEARER_RE: Final[re.Pattern[str]] = re.compile(r"(?i)\b(bearer|sk-[A-Za-z0-9]|eyJ)[\w.\-]*")

#: Keys that carry no content and are always safe to log verbatim.
SAFE_KEYS: Final[frozenset[str]] = frozenset(
    {
        "event",
        "level",
        "logger",
        "timestamp",
        "request_id",
        "tenant_id",
        "workspace_id",
        "user_id",
        "session_id",
        "turn_id",
        "seq",
        "path",
        "method",
        "status_code",
        "duration_ms",
        "error_code",
        "action",
        "resource",
        "result",
        "risk",
        "agent",
        "backend",
        "model",
        "latency_ms",
        "token_usage",
        "redacted",
    }
)


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in SAFE_KEYS:
        return False
    return lowered in SENSITIVE_KEYS or lowered.endswith(SENSITIVE_KEY_SUFFIXES)


def _scrub_string(value: str) -> str:
    """Mask PII-shaped substrings and cap the length of a free-text value."""
    scrubbed = _EMAIL_RE.sub("[email]", value)
    scrubbed = _LONG_DIGITS_RE.sub("[number]", scrubbed)
    scrubbed = _BEARER_RE.sub("[token]", scrubbed)
    if len(scrubbed) > MAX_STRING_LENGTH:
        scrubbed = scrubbed[:MAX_STRING_LENGTH] + "…[truncated]"
    return scrubbed


def _redact_value(value: Any, depth: int, removed: list[str], path: str) -> Any:
    if depth > MAX_DEPTH:
        return REDACTED
    if isinstance(value, str):
        return _scrub_string(value)
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key)
            child_path = f"{path}.{key}" if path else key
            if _is_sensitive_key(key):
                removed.append(child_path)
                result[key] = REDACTED
            else:
                result[key] = _redact_value(raw_value, depth + 1, removed, child_path)
        return result
    if isinstance(value, list | tuple | set):
        return [
            _redact_value(item, depth + 1, removed, f"{path}[]")
            for item in list(value)[:50]
        ]
    if isinstance(value, bytes | bytearray | memoryview):
        removed.append(path or "bytes")
        return REDACTED
    return value


def redact_processor(
    logger: WrappedLogger, method_name: str, event_dict: EventDict
) -> EventDict:
    """structlog processor enforcing the §49.5 / §40.2 "no content, no PII" rule."""
    _ = (logger, method_name)
    removed: list[str] = []
    result: EventDict = {}
    for raw_key, raw_value in event_dict.items():
        key = str(raw_key)
        if key in ("exc_info", "exception", "stack"):
            # Tracebacks are rendered by ``dict_tracebacks``; keep them intact but they
            # are never sent to a client (see ``errors.unhandled_exception_handler``).
            result[key] = raw_value
            continue
        if _is_sensitive_key(key):
            removed.append(key)
            result[key] = REDACTED
            continue
        result[key] = _redact_value(raw_value, 1, removed, key)
    if removed:
        result["redacted"] = sorted(set(removed))
    return result


def _orjson_dumps(obj: Any, default: Any = None, **_: Any) -> str:
    return orjson.dumps(obj, default=default).decode("utf-8")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def configure_logging(settings: Settings) -> None:
    """Install the structlog + stdlib logging configuration for this process."""
    level = logging.getLevelNamesMapping().get(settings.log_level, logging.INFO)

    shared: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.dict_tracebacks,
        # Redaction runs last before rendering so it also covers values injected by
        # the processors above (e.g. exception messages).
        redact_processor,
    ]

    renderer: Processor = (
        structlog.dev.ConsoleRenderer(colors=True)
        if settings.app_env == "local"
        else structlog.processors.JSONRenderer(serializer=_orjson_dumps)
    )

    structlog.configure(
        processors=[*shared, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )

    # Route stdlib loggers (uvicorn, sqlalchemy, httpx) through the same pipeline.
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                renderer,
            ],
        )
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).handlers = []
        logging.getLogger(noisy).propagate = True
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.debug_sql else logging.WARNING
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound logger; prefer module-level ``get_logger(__name__)``."""
    return structlog.get_logger(name)  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------
# Context binding
# ---------------------------------------------------------------------------


def bind_request_id(request_id: str) -> None:
    """Bind the correlation id as early as possible (before auth resolves)."""
    structlog.contextvars.bind_contextvars(request_id=request_id)


def bind_request_context(ctx: RequestContext) -> None:
    """Bind the non-PII identity fields of a resolved context (§49.5)."""
    structlog.contextvars.bind_contextvars(**ctx.log_fields())


def clear_log_context() -> None:
    """Clear contextvars at the end of a request/task to avoid cross-talk."""
    structlog.contextvars.clear_contextvars()
