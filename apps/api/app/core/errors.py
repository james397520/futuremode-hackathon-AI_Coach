"""Typed error hierarchy + problem-shaped exception handlers (spec §94 / §73).

Every failure leaves the API as the same JSON envelope::

    {
      "type":       "https://docs.ai-coach.local/errors/<code>",
      "title":      "Short, human, non-sensitive",
      "status":     403,
      "code":       "rbac_denied",
      "detail":     "Safe, caller-actionable explanation",
      "request_id": "…",
      "recoverable": false,
      "errors":     [{"field": "body.name", "message": "Field required"}]
    }

Rules:

* ``detail`` is **caller-safe text only**. Database messages, stack traces, SQL,
  provider payloads, file paths and prompt content never appear (§40.2 / §49.5) —
  the unhandled-exception handler logs the traceback and returns a fixed sentence.
* ``recoverable`` mirrors the ``session.error.recoverable`` flag in the streaming
  contract, so the client can pick "inline notice" vs "blocking modal" (§94: a WebGPU
  fallback is a notice, a missing microphone permission is a modal).
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Any

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    from starlette.responses import Response

logger = structlog.get_logger(__name__)

ERROR_TYPE_BASE = "https://docs.ai-coach.local/errors"
REQUEST_ID_HEADER = "X-Request-ID"


class ErrorCode(StrEnum):
    """Stable machine-readable error codes (§94).

    These strings are part of the client contract: the web app switches on them, and
    ``session.error.code`` on the WebSocket reuses the same vocabulary.
    """

    # --- authn / authz ---
    UNAUTHENTICATED = "unauthenticated"
    INVALID_CREDENTIALS = "invalid_credentials"
    TOKEN_EXPIRED = "token_expired"
    TOKEN_INVALID = "token_invalid"
    CSRF_INVALID = "csrf_invalid"
    RBAC_DENIED = "rbac_denied"
    KNOWLEDGE_ACL_DENIED = "knowledge_acl_denied"
    WORKSPACE_SCOPE_REQUIRED = "workspace_scope_required"
    TENANT_ISOLATION_VIOLATION = "tenant_isolation_violation"
    # --- resource ---
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    VERSION_CONFLICT = "version_conflict"
    VALIDATION_FAILED = "validation_failed"
    UNSUPPORTED_MEDIA_TYPE = "unsupported_media_type"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    # --- domain ---
    SESSION_STATE_INVALID = "session_state_invalid"
    ASSESSMENT_MODE_RESTRICTED = "assessment_mode_restricted"
    CONTENT_NOT_PUBLISHED = "content_not_published"
    SAFETY_BLOCKED = "safety_blocked"
    RETRIEVAL_UNAVAILABLE = "retrieval_unavailable"
    # --- platform ---
    RATE_LIMITED = "rate_limited"
    QUOTA_EXCEEDED = "quota_exceeded"
    PROVIDER_UNAVAILABLE = "provider_unavailable"
    PROVIDER_TIMEOUT = "provider_timeout"
    SERVICE_UNAVAILABLE = "service_unavailable"
    NOT_IMPLEMENTED = "not_implemented"
    INTERNAL_ERROR = "internal_error"


class FieldError(BaseModel):
    """One field-level validation problem."""

    field: str
    message: str


class ProblemDetail(BaseModel):
    """The single response shape for every error (documented in OpenAPI)."""

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


class AppError(Exception):
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
        #: Extra fields for the server-side log only — never serialised to the client.
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


# --- 401 / 403 -------------------------------------------------------------


class UnauthenticatedError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = ErrorCode.UNAUTHENTICATED
    title = "需要登入"
    detail = "請先登入再繼續。"
    recoverable = True


class InvalidCredentialsError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = ErrorCode.INVALID_CREDENTIALS
    title = "登入失敗"
    # Deliberately does not say whether the account exists (user enumeration).
    detail = "電子郵件或密碼不正確。"
    recoverable = True


class TokenExpiredError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = ErrorCode.TOKEN_EXPIRED
    title = "登入已逾期"
    detail = "登入狀態已逾期，請重新登入。"
    recoverable = True


class TokenInvalidError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = ErrorCode.TOKEN_INVALID
    title = "登入狀態無效"
    detail = "無法驗證你的登入憑證。"
    recoverable = True


class CsrfError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = ErrorCode.CSRF_INVALID
    title = "請求已被阻擋"
    detail = "CSRF 驗證失敗，請重新整理頁面後再試。"
    recoverable = True


class PermissionDeniedError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = ErrorCode.RBAC_DENIED
    title = "沒有權限"
    detail = "你的角色不允許執行這個動作。"


class KnowledgeAclDeniedError(AppError):
    """§39 — the caller's role/team is not on the knowledge base ACL."""

    status_code = status.HTTP_403_FORBIDDEN
    code = ErrorCode.KNOWLEDGE_ACL_DENIED
    title = "無法存取知識庫"
    detail = "你沒有這個知識庫的存取權限。"


class WorkspaceScopeRequiredError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = ErrorCode.WORKSPACE_SCOPE_REQUIRED
    title = "請先選擇工作區"
    detail = "呼叫這個端點前請先選擇工作區。"
    recoverable = True


class TenantIsolationError(AppError):
    """§74 — raised by ``app.core.tenancy`` when a scope mismatch is detected.

    This is a *bug or an attack*, never a normal outcome. It is reported as 404 so the
    API does not confirm the existence of another tenant's resource, while the audit
    trail records the real reason.
    """

    status_code = status.HTTP_404_NOT_FOUND
    code = ErrorCode.NOT_FOUND
    title = "找不到資料"
    detail = "找不到你要求的資料。"


# --- 404 / 409 / 41x -------------------------------------------------------


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = ErrorCode.NOT_FOUND
    title = "找不到資料"
    detail = "找不到你要求的資料。"

    @classmethod
    def of(cls, resource: str, resource_id: str | None = None) -> NotFoundError:
        suffix = f" '{resource_id}'" if resource_id else ""
        return cls(f"在這個工作區找不到 {resource}{suffix}。")


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = ErrorCode.CONFLICT
    title = "狀態衝突"
    detail = "這筆資料目前的狀態與你的請求衝突。"


class VersionConflictError(AppError):
    """Optimistic concurrency failure on a versioned entity (§38)."""

    status_code = status.HTTP_409_CONFLICT
    code = ErrorCode.VERSION_CONFLICT
    title = "版本衝突"
    detail = "這筆資料在你載入後已被修改，請重新載入再套用你的編輯。"
    recoverable = True


class ValidationFailedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.VALIDATION_FAILED
    title = "請求格式錯誤"
    detail = "請求內容格式不正確。"
    recoverable = True


class UnsupportedMediaTypeError(AppError):
    status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    code = ErrorCode.UNSUPPORTED_MEDIA_TYPE
    title = "不支援的檔案格式"
    detail = "無法匯入這種檔案格式。"
    recoverable = True


class PayloadTooLargeError(AppError):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    code = ErrorCode.PAYLOAD_TOO_LARGE
    title = "檔案過大"
    detail = "檔案超過允許的大小上限。"
    recoverable = True


# --- domain ----------------------------------------------------------------


class SessionStateError(AppError):
    """The session state machine (§92) forbids this transition."""

    status_code = status.HTTP_409_CONFLICT
    code = ErrorCode.SESSION_STATE_INVALID
    title = "目前的練習狀態無法執行"
    detail = "這場練習目前的狀態不允許這個動作。"
    recoverable = True


class AssessmentModeRestrictedError(AppError):
    """§8.4 / §24 — hints, coach insights and knowledge peeks are off in assessment."""

    status_code = status.HTTP_403_FORBIDDEN
    code = ErrorCode.ASSESSMENT_MODE_RESTRICTED
    title = "評測模式不提供此功能"
    detail = "評測進行中，教練協助已停用。"


class ContentNotPublishedError(AppError):
    """§38 — trainees may only run published content."""

    status_code = status.HTTP_409_CONFLICT
    code = ErrorCode.CONTENT_NOT_PUBLISHED
    title = "內容尚未發布"
    detail = "這份內容尚未完成審核，還不能使用。"


class SafetyBlockedError(AppError):
    """§40.1 — safety service blocked the request (injection / jailbreak / out of scope)."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    code = ErrorCode.SAFETY_BLOCKED
    title = "請求被安全政策阻擋"
    detail = "這個請求已被安全政策阻擋。"


class RetrievalUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.RETRIEVAL_UNAVAILABLE
    title = "知識檢索暫時無法使用"
    detail = "知識檢索服務暫時無法使用。"
    recoverable = True


# --- platform --------------------------------------------------------------


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = ErrorCode.RATE_LIMITED
    title = "請求過於頻繁"
    detail = "已超過速率限制，請稍後再試。"
    recoverable = True

    def __init__(self, retry_after_seconds: int = 1, **kwargs: Any) -> None:
        headers = {"Retry-After": str(max(1, int(retry_after_seconds)))}
        headers.update(dict(kwargs.pop("headers", {}) or {}))
        super().__init__(headers=headers, **kwargs)


class QuotaExceededError(AppError):
    """§46 — workspace token/session quota exhausted."""

    status_code = status.HTTP_402_PAYMENT_REQUIRED
    code = ErrorCode.QUOTA_EXCEEDED
    title = "已達用量上限"
    detail = "這個工作區已達用量上限。"


class ProviderUnavailableError(AppError):
    """Upstream LLM / TTS / STT failure (§70 / §71). Provider detail stays server-side."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = ErrorCode.PROVIDER_UNAVAILABLE
    title = "AI 服務暫時無法使用"
    detail = "AI 服務暫時無法使用，請重試。"
    recoverable = True


class ProviderTimeoutError(AppError):
    status_code = status.HTTP_504_GATEWAY_TIMEOUT
    code = ErrorCode.PROVIDER_TIMEOUT
    title = "AI 服務逾時"
    detail = "AI 服務未在時限內回應，請重試。"
    recoverable = True


class ServiceUnavailableError(AppError):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = ErrorCode.SERVICE_UNAVAILABLE
    title = "服務暫時無法使用"
    detail = "相依服務暫時無法使用，請重試。"
    recoverable = True


class NotImplementedYetError(AppError):
    status_code = status.HTTP_501_NOT_IMPLEMENTED
    code = ErrorCode.NOT_IMPLEMENTED
    title = "此部署未提供這項功能"
    detail = "這個部署沒有提供這項功能。"


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

#: HTTP status -> (code, title) for framework-raised ``HTTPException``.
_HTTP_STATUS_FALLBACK: dict[int, tuple[ErrorCode, str]] = {
    400: (ErrorCode.VALIDATION_FAILED, "Invalid request"),
    401: (ErrorCode.UNAUTHENTICATED, "Authentication required"),
    403: (ErrorCode.RBAC_DENIED, "Not permitted"),
    404: (ErrorCode.NOT_FOUND, "Not found"),
    405: (ErrorCode.VALIDATION_FAILED, "Method not allowed"),
    409: (ErrorCode.CONFLICT, "Conflict"),
    413: (ErrorCode.PAYLOAD_TOO_LARGE, "Payload too large"),
    415: (ErrorCode.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type"),
    422: (ErrorCode.VALIDATION_FAILED, "Invalid request"),
    429: (ErrorCode.RATE_LIMITED, "Too many requests"),
    500: (ErrorCode.INTERNAL_ERROR, "Internal error"),
    502: (ErrorCode.PROVIDER_UNAVAILABLE, "Upstream unavailable"),
    503: (ErrorCode.SERVICE_UNAVAILABLE, "Service unavailable"),
    504: (ErrorCode.PROVIDER_TIMEOUT, "Upstream timeout"),
}


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", "")
    return str(value) if value else ""


def _problem_response(problem: ProblemDetail, headers: Mapping[str, str]) -> Response:
    response_headers = dict(headers)
    if problem.request_id:
        response_headers.setdefault(REQUEST_ID_HEADER, problem.request_id)
    return ORJSONResponse(
        status_code=problem.status,
        content=problem.model_dump(mode="json"),
        headers=response_headers,
    )


async def app_error_handler(request: Request, exc: Exception) -> Response:
    """Render an :class:`AppError`. 4xx logs at warning, 5xx at error."""
    assert isinstance(exc, AppError)
    request_id = _request_id(request)
    problem = exc.to_problem(request_id or None)
    log = logger.bind(
        error_code=exc.code.value,
        status_code=exc.status_code,
        path=request.url.path,
        method=request.method,
        **exc.log_context,
    )
    if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR:
        log.error("request_failed", exc_info=exc)
    else:
        log.warning("request_rejected")
    return _problem_response(problem, exc.headers)


async def validation_error_handler(request: Request, exc: Exception) -> Response:
    """Flatten pydantic/FastAPI validation errors into ``errors[]``.

    Only the field location and the validator message are echoed; the offending
    ``input`` value is dropped so request bodies (which may contain transcript text or
    PII) never land in a response or a log line (§40.2 / §49.5).
    """
    assert isinstance(exc, RequestValidationError)
    field_errors = [
        FieldError(
            field=".".join(str(part) for part in error.get("loc", ())) or "body",
            message=str(error.get("msg", "Invalid value")),
        )
        for error in exc.errors()
    ]
    error = ValidationFailedError(errors=field_errors)
    logger.warning(
        "request_validation_failed",
        path=request.url.path,
        method=request.method,
        fields=[fe.field for fe in field_errors],
    )
    return _problem_response(error.to_problem(_request_id(request) or None), {})


async def http_exception_handler(request: Request, exc: Exception) -> Response:
    """Map a framework ``HTTPException`` onto the problem shape."""
    assert isinstance(exc, StarletteHTTPException)
    code, title = _HTTP_STATUS_FALLBACK.get(
        exc.status_code, (ErrorCode.INTERNAL_ERROR, "Error")
    )
    detail = exc.detail if isinstance(exc.detail, str) and exc.detail else title
    problem = ProblemDetail(
        type=f"{ERROR_TYPE_BASE}/{code.value}",
        title=title,
        status=exc.status_code,
        code=code,
        detail=detail,
        request_id=_request_id(request) or None,
        recoverable=exc.status_code < status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
    logger.warning(
        "http_exception",
        status_code=exc.status_code,
        path=request.url.path,
        method=request.method,
    )
    return _problem_response(problem, dict(exc.headers or {}))


async def unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    """Last resort: log the traceback server-side, return a fixed, contentless message."""
    logger.error(
        "unhandled_exception",
        path=request.url.path,
        method=request.method,
        exc_info=exc,
    )
    problem = ProblemDetail(
        type=f"{ERROR_TYPE_BASE}/{ErrorCode.INTERNAL_ERROR.value}",
        title="系統發生錯誤",
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code=ErrorCode.INTERNAL_ERROR,
        detail="這個請求無法完成，事件已記錄。",
        request_id=_request_id(request) or None,
        recoverable=False,
    )
    return _problem_response(problem, {})


def install_exception_handlers(app: FastAPI) -> None:
    """Register every handler on the app (called by the factory in ``app.main``)."""
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
