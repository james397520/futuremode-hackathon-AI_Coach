"""Typed errors + the problem-shaped envelope (mirrors apps/api ``core/errors.py``).

The main API switches on ``code``, so the envelope is byte-compatible with
``apps/api/app/core/errors.py``::

    {
      "type":        "https://docs.ai-coach.local/errors/model_not_allowed",
      "title":       "Model not permitted",
      "status":      400,
      "code":        "model_not_allowed",
      "detail":      "Safe, caller-actionable explanation",
      "request_id":  "…",
      "recoverable": false,
      "errors":      [{"field": "body.texts", "message": "…"}]
    }

Two rules make this file worth its length:

1. **``detail`` is caller-safe text only.** No file paths, no ONNX error strings,
   no tracebacks and — above all — no input text (§49.5). The unhandled-exception
   handler logs the traceback server-side and returns a fixed sentence.
2. **Every failure path has a class here.** A missing weight file, a sha256
   mismatch, a corrupt graph, an allocator failure, a queue timeout and a NaN in
   the output tensor are all typed; none of them may surface as a 500 with a
   stack trace.
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

    The first block is shared vocabulary with ``apps/api``; the second is specific
    to model serving. Never rename one of these — the caller branches on them.
    """

    # --- shared with apps/api ---
    UNAUTHENTICATED = "unauthenticated"
    VALIDATION_FAILED = "validation_failed"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    NOT_FOUND = "not_found"
    RATE_LIMITED = "rate_limited"
    SERVICE_UNAVAILABLE = "service_unavailable"
    PROVIDER_TIMEOUT = "provider_timeout"
    NOT_IMPLEMENTED = "not_implemented"
    INTERNAL_ERROR = "internal_error"
    # --- inference-specific ---
    MODEL_NOT_ALLOWED = "model_not_allowed"
    MODEL_NOT_FOUND = "model_not_found"
    MODEL_LOAD_FAILED = "model_load_failed"
    MODEL_INTEGRITY_FAILED = "model_integrity_failed"
    MODEL_NOT_READY = "model_not_ready"
    MODEL_TASK_MISMATCH = "model_task_mismatch"
    QUEUE_TIMEOUT = "queue_timeout"
    INFERENCE_FAILED = "inference_failed"
    NUMERICAL_ERROR = "numerical_error"
    RESOURCE_EXHAUSTED = "resource_exhausted"


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


class InferenceServiceError(Exception):
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
        #: Server-side log fields only — never serialised to the client. Must not
        #: contain input text; :mod:`app.core.logging` redacts it anyway.
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


class UnauthenticatedError(InferenceServiceError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = ErrorCode.UNAUTHENTICATED
    title = "Unauthenticated"
    detail = "A valid service credential is required."


class ValidationFailedError(InferenceServiceError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.VALIDATION_FAILED
    title = "Validation failed"
    detail = "The request body is not valid."


class PayloadTooLargeError(InferenceServiceError):
    """Input exceeds a configured limit — see ``preprocessing/text.py``.

    413 rather than 422 because the honest answer is "this body is too big for
    this service", and the caller's remedy is to split it, not to reshape it.
    """

    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = ErrorCode.PAYLOAD_TOO_LARGE
    title = "Payload too large"
    detail = "The request exceeds this service's input limits."


class ModelNotAllowedError(InferenceServiceError):
    """The model id is not on the allowlist (or not in the manifest at all)."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = ErrorCode.MODEL_NOT_ALLOWED
    title = "Model not permitted"
    detail = "The requested model is not permitted on this deployment."


class ModelNotFoundError(InferenceServiceError):
    status_code = status.HTTP_404_NOT_FOUND
    code = ErrorCode.MODEL_NOT_FOUND
    title = "Model not found"
    detail = "The requested model is not present in the model manifest."


class ModelTaskMismatchError(InferenceServiceError):
    """e.g. asking ``/rerank`` for an embedding model."""

    status_code = status.HTTP_400_BAD_REQUEST
    code = ErrorCode.MODEL_TASK_MISMATCH
    title = "Wrong model kind"
    detail = "The requested model cannot serve this endpoint."


# --- 5xx: the operator has to fix it --------------------------------------


class ModelIntegrityError(InferenceServiceError):
    """sha256 mismatch, truncated download, or a missing file in the manifest set.

    Deliberately *not* recoverable: retrying reads the same bad bytes. Somebody
    has to re-run the download script.
    """

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.MODEL_INTEGRITY_FAILED
    title = "Model integrity check failed"
    detail = "The model weights on disk failed verification and were not loaded."


class ModelLoadError(InferenceServiceError):
    """The graph exists and hashes fine but onnxruntime refused it."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.MODEL_LOAD_FAILED
    title = "Model load failed"
    detail = "The model could not be loaded."


class ModelNotReadyError(InferenceServiceError):
    """Warmup has not finished. Distinct from a load failure so the caller retries."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.MODEL_NOT_READY
    title = "Model not ready"
    detail = "The model is still loading. Retry shortly."
    recoverable = True


class QueueTimeoutError(InferenceServiceError):
    """No device slot became free within ``queue_timeout_s`` (§49.4 load shedding)."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.QUEUE_TIMEOUT
    title = "Inference queue timeout"
    detail = "The service is at capacity. Retry with backoff."
    recoverable = True


class InferenceTimeoutError(InferenceServiceError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = ErrorCode.PROVIDER_TIMEOUT
    title = "Inference timeout"
    detail = "The model did not produce a result within the configured budget."
    recoverable = True


class ResourceExhaustedError(InferenceServiceError):
    """Allocator failure / OOM inside the runtime."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.RESOURCE_EXHAUSTED
    title = "Resource exhausted"
    detail = "The service ran out of memory for this request. Retry with a smaller batch."
    recoverable = True


class InferenceFailedError(InferenceServiceError):
    status_code = status.HTTP_502_BAD_GATEWAY
    code = ErrorCode.INFERENCE_FAILED
    title = "Inference failed"
    detail = "The model failed to produce a result."


class NumericalError(InferenceServiceError):
    """A NaN/Inf reached the postprocessing guard.

    This is a 502 and not a silent zero-fill on purpose: a NaN vector written to
    Qdrant is silent index corruption that surfaces months later as "retrieval
    got worse".
    """

    status_code = status.HTTP_502_BAD_GATEWAY
    code = ErrorCode.NUMERICAL_ERROR
    title = "Numerically invalid model output"
    detail = "The model produced a non-finite value; the result was discarded."


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
    request: Request,
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

    @app.exception_handler(InferenceServiceError)
    async def _service_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, InferenceServiceError)
        request_id = _request_id(request)
        log = logger.bind(
            code=exc.code.value,
            status=exc.status_code,
            request_id=request_id,
            **exc.log_context,
        )
        # 5xx is our fault; 4xx is the caller's. Different levels so an alert on
        # error-rate does not fire because somebody sent a bad model id.
        if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
            log.error("inference.error")
        else:
            log.info("inference.rejected")
        return _problem_response(request, exc.to_problem(request_id), exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: Exception) -> Response:
        assert isinstance(exc, RequestValidationError)
        request_id = _request_id(request)
        errors = [
            FieldError(
                field=".".join(str(part) for part in error.get("loc", ())) or "body",
                # `msg` is pydantic's own message; `input` is echoed by pydantic and
                # would contain the caller's text, so it is never included.
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
            "inference.rejected",
            code=problem.code.value,
            status=problem.status,
            request_id=request_id,
            field_count=len(errors),
        )
        return _problem_response(request, problem)

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
            # Starlette details are our own strings (route not found, method not
            # allowed), so they are safe to pass through.
            detail=str(exc.detail) if exc.detail else "The request could not be completed.",
            request_id=request_id,
        )
        return _problem_response(request, problem, exc.headers)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> Response:
        request_id = _request_id(request)
        # exc_info goes to the log; the caller gets a fixed sentence. A traceback
        # can contain file paths and, through repr'd locals, input text.
        logger.error(
            "inference.unhandled",
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
        return _problem_response(request, problem)


_CODE_BY_STATUS: Final[dict[int, ErrorCode]] = {
    status.HTTP_401_UNAUTHORIZED: ErrorCode.UNAUTHENTICATED,
    status.HTTP_403_FORBIDDEN: ErrorCode.UNAUTHENTICATED,
    status.HTTP_404_NOT_FOUND: ErrorCode.NOT_FOUND,
    status.HTTP_405_METHOD_NOT_ALLOWED: ErrorCode.VALIDATION_FAILED,
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: ErrorCode.PAYLOAD_TOO_LARGE,
    status.HTTP_422_UNPROCESSABLE_ENTITY: ErrorCode.VALIDATION_FAILED,
    status.HTTP_429_TOO_MANY_REQUESTS: ErrorCode.RATE_LIMITED,
    status.HTTP_501_NOT_IMPLEMENTED: ErrorCode.NOT_IMPLEMENTED,
    status.HTTP_503_SERVICE_UNAVAILABLE: ErrorCode.SERVICE_UNAVAILABLE,
    status.HTTP_504_GATEWAY_TIMEOUT: ErrorCode.PROVIDER_TIMEOUT,
}

_TITLE_BY_STATUS: Final[dict[int, str]] = {
    status.HTTP_401_UNAUTHORIZED: "Unauthenticated",
    status.HTTP_403_FORBIDDEN: "Forbidden",
    status.HTTP_404_NOT_FOUND: "Not found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "Method not allowed",
    status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "Payload too large",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "Validation failed",
    status.HTTP_429_TOO_MANY_REQUESTS: "Rate limited",
    status.HTTP_503_SERVICE_UNAVAILABLE: "Service unavailable",
    status.HTTP_504_GATEWAY_TIMEOUT: "Gateway timeout",
}


__all__ = [
    "ERROR_TYPE_BASE",
    "ErrorCode",
    "FieldError",
    "InferenceFailedError",
    "InferenceServiceError",
    "InferenceTimeoutError",
    "ModelIntegrityError",
    "ModelLoadError",
    "ModelNotAllowedError",
    "ModelNotFoundError",
    "ModelNotReadyError",
    "ModelTaskMismatchError",
    "NumericalError",
    "PayloadTooLargeError",
    "ProblemDetail",
    "QueueTimeoutError",
    "ResourceExhaustedError",
    "UnauthenticatedError",
    "ValidationFailedError",
    "install_exception_handlers",
]
