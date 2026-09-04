"""structlog JSON logging that structurally cannot leak likeness or speech data.

Why this is a module and not a code-review rule
-----------------------------------------------
This process holds three things that must never reach a log aggregator: the
**portrait** of a real (or licensed) person, the **consent record** naming its
owner (§73), and the **TTS audio** of everything the simulated customer says —
which is the trainee's conversation by another route. A single
``log.info("audio", pcm=chunk)`` or ``log.info("avatar", consent=record)`` would
turn the log store into an unaudited copy of exactly the material ADR-010 exists
to control. So the same two layers as ``services/inference`` apply:

1. **A typed emit surface.** :func:`log_avatar` accepts only the keys in
   :class:`AvatarLogFields` — ids, enum values, counts, milliseconds. There is
   no ``pcm``, ``consent``, ``owner`` or ``portrait`` key to pass, so under
   strict mypy an attempt to log content is a type error at the call site.
2. **A redaction processor.** :func:`redact_processor` runs on every event from
   every code path, replaces the value of any suspiciously-named key, masks
   e-mail / bearer / long-digit patterns in the strings that remain, truncates
   anything long, and records what it removed in ``redacted``.

The key set is a superset of ``apps/api`` and ``services/inference`` so a field
redacted in one service is not accidentally printed by another.
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
        # conversation content
        "text",
        "texts",
        "reply",
        "transcript",
        "utterance",
        "prompt",
        "message",
        "messages",
        "content",
        "body",
        # media payloads — a base64'd frame or PCM chunk in a log line is both a
        # privacy leak and a way to make a log file unreadable
        "pcm",
        "audio",
        "samples",
        "frame",
        "frames",
        "image",
        "portrait",
        "source_image",
        "jpeg",
        "png",
        "webp",
        "payload",
        # likeness provenance (§73) — the record's *existence* is loggable, its
        # contents are not
        "consent",
        "consent_reference",
        "license",
        "owner",
        "subject",
        "subject_name",
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
        "password",
        "api_key",
        "token",
    }
)

#: Suffixes that mark a credential or a payload regardless of prefix.
SENSITIVE_SUFFIXES: Final[tuple[str, ...]] = (
    "_key",
    "_token",
    "_secret",
    "_password",
    "_text",
    "_pcm",
    "_audio",
    "_image",
    "_bytes",
)

MAX_STRING_LENGTH: Final[int] = 200
MAX_DEPTH: Final[int] = 4
MAX_SEQUENCE_ITEMS: Final[int] = 20

REDACTED: Final[str] = "[redacted]"
TRUNCATED_SUFFIX: Final[str] = "…[truncated]"

_EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_LONG_DIGITS_RE: Final[re.Pattern[str]] = re.compile(r"\d{9,}")
_BEARER_RE: Final[re.Pattern[str]] = re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{8,}")

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
    if isinstance(value, (bytes, bytearray, memoryview)):
        # A raw buffer is always a frame or a PCM chunk here. Log its size only.
        return f"[{type(value).__name__}:{len(bytes(value))}B]"
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
    # Unknown object: log its type, never its repr. A numpy array's repr is a
    # picture of somebody's face written out in decimals.
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
    message = event_dict.get("event")
    if isinstance(message, str):
        event_dict["event"] = _scrub(message, MAX_DEPTH - 1)
    if removed:
        event_dict["redacted"] = sorted(removed)
    return event_dict


# ---------------------------------------------------------------------------
# The typed emit surface (layer 1)
# ---------------------------------------------------------------------------


class AvatarLogFields(TypedDict, total=False):
    """The only fields an avatar code path may log.

    Everything here is an identifier, an enum value, or a number. There is
    deliberately no key that can hold pixels, PCM, a consent record or a line of
    dialogue.
    """

    request_id: str
    session_id: str
    avatar_id: str
    backend: str
    platform: str
    profile: str
    engine: str
    encoder: str
    transport: str
    mode: str
    precision: str
    degrade_level: str
    reason: str
    runtime_state: str
    from_state: str
    to_state: str
    expression: str
    transition_ms: float
    #: persona scalars — these are simulation variables, not personal data
    trust: float
    interest: float
    resistance: float
    patience: float
    intensity: float
    scenario_phase: str
    emotion: str
    # timing / counters
    fps: float
    target_fps: int
    width: int
    height: int
    frame_index: int
    frame_count: int
    dropped: int
    batch_size: int
    duration_ms: float
    first_frame_ms: float
    render_ms: float
    liveportrait_ms: float
    musetalk_ms: float
    composite_ms: float
    encode_ms: float
    av_drift_ms: float
    audio_buffer_ms: float
    sample_rate: int
    channels: int
    sample_count: int
    byte_count: int
    memory_mb: float
    status: int
    code: str
    error_type: str
    available: bool


def log_avatar(logger: Any, event: str, **fields: Unpack[AvatarLogFields]) -> None:
    """Emit an avatar telemetry event.

    Use this instead of ``logger.info(...)`` on the render and session paths.
    mypy rejects any key not declared in :class:`AvatarLogFields`, so there is
    no spelling of this call that logs a frame or a consent record.
    """
    logger.info(event, **fields)


def get_logger(name: str) -> Any:
    """A bound structlog logger. ``Any`` because structlog's BindableLogger is a
    runtime protocol and annotating it buys nothing under strict mypy."""
    return structlog.get_logger(name)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _orjson_dumps(obj: Any, default: Any = None, **_: Any) -> str:
    return orjson.dumps(obj, default=default or repr).decode("utf-8")


def _build_processors(*, json_output: bool) -> list[Processor]:
    processors: list[Processor] = [
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
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(serializer=_orjson_dumps),
        ]
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()))
    return processors


def configure_logging(settings: Settings) -> None:
    """Install the processor chain. Idempotent; safe to call from tests."""
    level = getattr(logging, settings.log_level, logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level, force=True)
    # uvicorn's access log duplicates our own and prints the raw path, which for
    # this service includes session ids on every WebSocket upgrade.
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


def bind_session(session_id: str) -> None:
    """Bind a session id so every frame-loop log line carries it."""
    structlog.contextvars.bind_contextvars(session_id=session_id)


def clear_log_context() -> None:
    """Unbind everything. Called at the end of every request / session task."""
    structlog.contextvars.clear_contextvars()


__all__ = [
    "MAX_STRING_LENGTH",
    "REDACTED",
    "SENSITIVE_KEYS",
    "SENSITIVE_SUFFIXES",
    "AvatarLogFields",
    "bind_request_id",
    "bind_session",
    "clear_log_context",
    "configure_logging",
    "get_logger",
    "log_avatar",
    "redact_processor",
]
