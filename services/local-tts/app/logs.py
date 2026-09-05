"""structlog JSON logs in the same shape as apps/api (§49.5): no request text, ever.

The server sees every persona line. Log events carry counts and timings only —
``chars``, ``phonemes``, ``audio_s``, ``rtf`` — never the string itself.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import orjson
import structlog


def _dumps(value: Any, **_: Any) -> str:
    return orjson.dumps(value, default=str).decode()


def configure_logging(*, json_output: bool = True, level: str = "INFO") -> None:
    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    renderer: Any = (
        structlog.processors.JSONRenderer(serializer=_dumps)
        if json_output
        else structlog.dev.ConsoleRenderer(colors=False)
    )
    structlog.configure(
        processors=[*processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping().get(level, logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=level, stream=sys.stdout, format="%(message)s")
