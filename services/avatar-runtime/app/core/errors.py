"""Typed errors + the problem-shaped envelope (spec §76; mirrors services/inference).

The envelope is byte-compatible with ``apps/api/app/core/errors.py`` and
``services/inference/app/core/errors.py``, so a caller switches on ``code``::

    {
      "type":        "https://docs.ai-coach.local/errors/lipsync_timeout",
      "title":       "Lip sync timeout",
      "status":      503,
      "code":        "lipsync_timeout",
      "detail":      "Safe, caller-actionable explanation",
      "request_id":  "…",
      "recoverable": true,
      "errors":      []
    }

§76 lists the codes in SCREAMING_CASE. The enum *member names* are those
identifiers verbatim; the wire values are the repo-wide lowercase convention.

Two rules specific to this service:

1. **``detail`` is caller-safe text only.** No file paths, no avatar owner
   names, no consent-record contents, no engine tracebacks.
2. **An engine failure is not an HTTP failure.** :class:`EngineUnavailableError`
   exists so the orchestrator can walk the §53 fallback chain
   (LivePortrait → MuseTalk-only → LivePortrait-only → static portrait) instead
   of surfacing a 5xx. It is only ever converted to a response when a caller
   explicitly asked for an engine that is not installed. **Avatar 故障不得終止
   AI Training Session** (§53 / ADR-009).
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import REQUEST_ID_HEADER

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from starlette.responses import Response

logger = structlog.get_logger(__name__)

ERROR_TYPE_BASE: Final[str] = "https://docs.ai-coach.local/errors"


class ErrorCode(StrEnum):
    """Stable machine-readable codes.

    The first block is shared vocabulary with ``apps/api`` and
    ``services/inference``; the second block is §76 verbatim; the third covers
    the consent and engine-availability rules this service adds.
    """

    # --- shared with apps/api / services/inference ---
    VALIDATION_FAILED = "validation_failed"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    NOT_FOUND = "not_found"
    SERVICE_UNAVAILABLE = "service_unavailable"
    NOT_IMPLEMENTED = "not_implemented"
    INTERNAL_ERROR = "internal_error"
    # --- §76 error codes ---
    MODEL_LOAD_FAILED = "model_load_failed"
    AVATAR_PREPARE_FAILED = "avatar_prepare_failed"
    AUDIO_FORMAT_INVALID = "audio_format_invalid"
    LIPSYNC_TIMEOUT = "lipsync_timeout"
    FRAME_QUEUE_OVERFLOW = "frame_queue_overflow"
    ENCODER_FAILED = "encoder_failed"
    WEBRTC_DISCONNECTED = "webrtc_disconnected"
    OUT_OF_MEMORY = "out_of_memory"
    # --- avatar-runtime specific ---
    AVATAR_NOT_FOUND = "avatar_not_found"
    #: §73/§74/ADR-010 — no valid consent record, so the likeness is not usable.
    AVATAR_CONSENT_MISSING = "avatar_consent_missing"
    EXPRESSION_BANK_INVALID = "expression_bank_invalid"
    ENGINE_UNAVAILABLE = "engine_unavailable"
    SESSION_NOT_FOUND = "session_not_found"
    SESSION_LIMIT_REACHED = "session_limit_reached"


class FieldError(BaseModel):
    """One field-level validation problem."""

    field: str
    message: str


class ProblemDetail(BaseModel):
    """The single error response shape, documented in OpenAPI."""

    type: str
    title: str
    status: int
    code: ErrorCode
    detail: str
    request_id: str | None = None
    recoverable: bool = False
    errors: list[FieldError] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Exception hierarchy
# ---------------------------------------------------------------------------


class AvatarRuntimeError(Exception):
    """Base class for every deliberate, caller-visible failure."""

    status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    title: str = "Internal error"
    detail: str = "The request could not be completed."
    recoverable: bool = False

    def __init__(
        self,
        detail: str | None = None,
        *,
        title: str | None = None,
        errors: Sequence[FieldError] | None = None,
        headers: Mapping[str, str] | None = None,
        log_context: Mapping[str, Any] | None = None,
    ) -> None:
        self.detail = detail or self.detail
        self.title = title or self.title
        self.errors: list[FieldError] = list(errors or [])
        self.headers: dict[str, str] = dict(headers or {})
        #: Server-side log fields only — never serialised to the client.
        self.log_context: dict[str, Any] = dict(log_context or {})
        super().__init__(self.detail)

    def to_problem(self, request_id: str | None) -> ProblemDetail:
        return ProblemDetail(
            type=f"{ERROR_TYPE_BASE}/{self.code.value}",
            title=self.title,
            status=self.status_code,
            code=self.code,
            detail=self.detail,
            request_id=request_id,
            recoverable=self.recoverable,
            errors=self.errors,
        )


# --- 4xx: the caller can fix it -------------------------------------------


class ValidationFailedError(AvatarRuntimeError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.VALIDATION_FAILED
    title = "Validation failed"
    detail = "The request body is not valid."


class PayloadTooLargeError(AvatarRuntimeError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = ErrorCode.PAYLOAD_TOO_LARGE
    title = "Payload too large"
    detail = "The request exceeds this service's input limits."


class AudioFormatInvalidError(AvatarRuntimeError):
    """§76 ``AUDIO_FORMAT_INVALID``.

    Raised before anything reaches the jitter buffer: an unparseable WAV header,
    a sample rate we cannot resample from, or a channel count above stereo.
    §16 says the MuseTalk feature path is mono 16 kHz — we will resample for the
    caller, but we will not guess at a container we cannot read.
    """

    status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    code = ErrorCode.AUDIO_FORMAT_INVALID
    title = "Audio format invalid"
    detail = "The audio payload could not be decoded as PCM."


class AvatarNotFoundError(AvatarRuntimeError):
    status_code = status.HTTP_404_NOT_FOUND
    code = ErrorCode.AVATAR_NOT_FOUND
    title = "Avatar not found"
    detail = "No avatar bundle exists with that id."


class AvatarConsentMissingError(AvatarRuntimeError):
    """§73 / §74 / ADR-010 — the likeness has no usable consent record.

    A 403 rather than a 404 on purpose: the bundle exists, and the honest
    answer is that this deployment is not permitted to animate it. This is the
    one failure in the service that is *not* routed into the §53 fallback
    chain — degrading to "static portrait of a person who did not consent"
    would be worse than no avatar at all.
    """

    status_code = status.HTTP_403_FORBIDDEN
    code = ErrorCode.AVATAR_CONSENT_MISSING
    title = "Avatar consent record missing"
    detail = (
        "The avatar has no valid licence/consent record and cannot be used. "
        "Only self-produced, synthetic or explicitly licensed likenesses are permitted."
    )


class AvatarPrepareFailedError(AvatarRuntimeError):
    """§76 ``AVATAR_PREPARE_FAILED`` — source image rejected, or bank build failed."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.AVATAR_PREPARE_FAILED
    title = "Avatar preparation failed"
    detail = "The avatar could not be prepared from the supplied source image."


class ExpressionBankInvalidError(AvatarRuntimeError):
    """§21 uniformity rules violated: mixed resolution / fps / length / crop."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.EXPRESSION_BANK_INVALID
    title = "Expression bank invalid"
    detail = "The expression loops are not uniform in resolution, fps, length or crop."


class SessionNotFoundError(AvatarRuntimeError):
    status_code = status.HTTP_404_NOT_FOUND
    code = ErrorCode.SESSION_NOT_FOUND
    title = "Session not found"
    detail = "No avatar session exists with that id."


class SessionLimitReachedError(AvatarRuntimeError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = ErrorCode.SESSION_LIMIT_REACHED
    title = "Session limit reached"
    detail = "This runtime already holds the maximum number of concurrent sessions."
    recoverable = True


# --- 5xx / degradation signals --------------------------------------------


class EngineUnavailableError(AvatarRuntimeError):
    """A LivePortrait or MuseTalk port could not be used on this machine.

    **This is a routing signal, not an outage.** The orchestrator catches it and
    walks the §53 chain. It only reaches an HTTP handler when a caller pinned an
    engine explicitly, which is why it carries the engine name in
    :attr:`engine` for the ``avatar.runtime.degraded`` event.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.ENGINE_UNAVAILABLE
    title = "Engine unavailable"
    detail = "The requested inference engine is not installed on this machine."
    recoverable = True

    def __init__(self, engine: str, reason: str, **kwargs: Any) -> None:
        self.engine = engine
        self.reason = reason
        super().__init__(
            detail=f"Engine '{engine}' is unavailable on this machine.",
            log_context={"engine": engine, "reason": reason},
            **kwargs,
        )


class ModelLoadFailedError(AvatarRuntimeError):
    """§76 ``MODEL_LOAD_FAILED`` — weights present but the runtime refused them."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.MODEL_LOAD_FAILED
    title = "Model load failed"
    detail = "The avatar model could not be loaded."


class LipSyncTimeoutError(AvatarRuntimeError):
    """§76 ``LIPSYNC_TIMEOUT`` — MuseTalk did not return a mouth batch in time.

    Recoverable: the frame loop keeps the LivePortrait motion and drops the
    mouth update for that batch (§53 middle rung), rather than stalling video.
    """

    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = ErrorCode.LIPSYNC_TIMEOUT
    title = "Lip sync timeout"
    detail = "The lip-sync engine did not produce frames within the frame budget."
    recoverable = True


class FrameQueueOverflowError(AvatarRuntimeError):
    """§76 ``FRAME_QUEUE_OVERFLOW`` — the consumer is slower than the renderer.

    §49: never accumulate seconds of latency. The queue drops the oldest frame
    and raises this only when the drop rate itself is pathological.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.FRAME_QUEUE_OVERFLOW
    title = "Frame queue overflow"
    detail = "Frames are being produced faster than the transport can drain them."
    recoverable = True


class EncoderFailedError(AvatarRuntimeError):
    """§76 ``ENCODER_FAILED``."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.ENCODER_FAILED
    title = "Encoder failed"
    detail = "The frame encoder failed to produce an image."


class WebRTCDisconnectedError(AvatarRuntimeError):
    """§76 ``WEBRTC_DISCONNECTED``."""

    status_code = status.HTTP_409_CONFLICT
    code = ErrorCode.WEBRTC_DISCONNECTED
    title = "WebRTC disconnected"
    detail = "The media peer connection is not established."
    recoverable = True


class OutOfMemoryError_(AvatarRuntimeError):
    """§76 ``OUT_OF_MEMORY`` / §65.

    Named with a trailing underscore so it does not shadow the builtin. §65 is
    explicit that the runtime must degrade — fp16→q8, continuous→state_bank,
    25→20fps on Mac; batch↓, continuous→state_bank, resolution↓ on RTX — rather
    than OOM-crash, so this is raised only after the ladder is exhausted.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.OUT_OF_MEMORY
    title = "Out of memory"
    detail = "The runtime exhausted memory after degrading to its lowest profile."
    recoverable = True


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def _request_id(request: Request) -> str | None:
    value = getattr(request.state, "request_id", None)
    if isinstance(value, str) and value:
        return value
    header = request.headers.get(REQUEST_ID_HEADER)
    return header if header else None


def _problem_response(
    problem: ProblemDetail,
    headers: Mapping[str, str] | None = None,
) -> ORJSONResponse:
    merged = dict(headers or {})
    if problem.request_id:
        merged.setdefault(REQUEST_ID_HEADER, problem.request_id)
    return ORJSONResponse(
        status_code=problem.status,
        content=problem.model_dump(mode="json"),
        headers=merged,
    )


def install_exception_handlers(app: FastAPI) -> None:
    """Attach the four handlers that guarantee a typed body on every failure."""

    @app.exception_handler(AvatarRuntimeError)
    async def _service_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, AvatarRuntimeError)
        request_id = _request_id(request)
        log = logger.bind(
            code=exc.code.value,
            status=exc.status_code,
            request_id=request_id,
            **exc.log_context,
        )
        if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            log.error("avatar.error")
        else:
            log.info("avatar.rejected")
        return _problem_response(exc.to_problem(request_id), exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, RequestValidationError)
        request_id = _request_id(request)
        errors = [
            FieldError(
                field=".".join(str(part) for part in error.get("loc", ())) or "body",
                # `input` is echoed by pydantic and would contain caller data,
                # so only pydantic's own message is passed through.
                message=str(error.get("msg", "invalid value")),
            )
            for error in exc.errors()
        ]
        problem = ProblemDetail(
            type=f"{ERROR_TYPE_BASE}/{ErrorCode.VALIDATION_FAILED.value}",
            title="Validation failed",
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code=ErrorCode.VALIDATION_FAILED,
            detail="The request body is not valid.",
            request_id=request_id,
            errors=errors,
        )
        logger.info(
            "avatar.rejected",
            code=problem.code.value,
            status=problem.status,
            request_id=request_id,
            field_count=len(errors),
        )
        return _problem_response(problem)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, StarletteHTTPException)
        request_id = _request_id(request)
        code = _CODE_BY_STATUS.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
        problem = ProblemDetail(
            type=f"{ERROR_TYPE_BASE}/{code.value}",
            title=_TITLE_BY_STATUS.get(exc.status_code, "Error"),
            status=exc.status_code,
            code=code,
            detail=str(exc.detail) if exc.detail else "The request could not be completed.",
            request_id=request_id,
        )
        return _problem_response(problem, exc.headers)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> Response:
        request_id = _request_id(request)
        logger.error(
            "avatar.unhandled",
            request_id=request_id,
            error_type=type(exc).__name__,
            exc_info=exc,
        )
        problem = ProblemDetail(
            type=f"{ERROR_TYPE_BASE}/{ErrorCode.INTERNAL_ERROR.value}",
            title="Internal error",
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            detail="The request could not be completed.",
            request_id=request_id,
        )
        return _problem_response(problem)


_CODE_BY_STATUS: Final[dict[int, ErrorCode]] = {
    status.HTTP_404_NOT_FOUND: ErrorCode.NOT_FOUND,
    status.HTTP_405_METHOD_NOT_ALLOWED: ErrorCode.VALIDATION_FAILED,
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: ErrorCode.AUDIO_FORMAT_INVALID,
    status.HTTP_422_UNPROCESSABLE_ENTITY: ErrorCode.VALIDATION_FAILED,
    status.HTTP_501_NOT_IMPLEMENTED: ErrorCode.NOT_IMPLEMENTED,
    status.HTTP_503_SERVICE_UNAVAILABLE: ErrorCode.SERVICE_UNAVAILABLE,
}

_TITLE_BY_STATUS: Final[dict[int, str]] = {
    status.HTTP_403_FORBIDDEN: "Forbidden",
    status.HTTP_404_NOT_FOUND: "Not found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "Method not allowed",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "Payload too large",
    status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "Unsupported media type",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "Validation failed",
    status.HTTP_429_TOO_MANY_REQUESTS: "Too many sessions",
    status.HTTP_503_SERVICE_UNAVAILABLE: "Service unavailable",
}


__all__ = [
    "ERROR_TYPE_BASE",
    "AudioFormatInvalidError",
    "AvatarConsentMissingError",
    "AvatarNotFoundError",
    "AvatarPrepareFailedError",
    "AvatarRuntimeError",
    "EncoderFailedError",
    "EngineUnavailableError",
    "ErrorCode",
    "ExpressionBankInvalidError",
    "FieldError",
    "FrameQueueOverflowError",
    "LipSyncTimeoutError",
    "ModelLoadFailedError",
    "OutOfMemoryError_",
    "PayloadTooLargeError",
    "ProblemDetail",
    "SessionLimitReachedError",
    "SessionNotFoundError",
    "ValidationFailedError",
    "WebRTCDisconnectedError",
    "install_exception_handlers",
]
