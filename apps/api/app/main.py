"""FastAPI application factory (spec §63 / §64 / §73).

============================================================================
 SECRET BOUNDARY — read before adding an endpoint
============================================================================
 ``OPENAI_API_KEY`` and ``ELEVENLABS_API_KEY`` exist **only inside this process**
 (§56 / §70 / §71). They are read by :mod:`app.core.config`, used by the agents /
 RAG / voice layer, and:

   * are never placed in a response body, header, cookie or error message;
   * are never proxied to the browser as a "temporary" or "ephemeral" key;
   * are never accepted from a client — ``/integrations`` takes a ``secret_ref``
     into the secrets manager, never raw credential material (§73).

 Every LLM and TTS call therefore travels
 ``Browser -> this API -> provider``, never ``Browser -> provider`` (§70 / §71).
 Likewise, object storage credentials stay here: uploads and exports are handed
 out as short-lived signed URLs (§40.2).
============================================================================

Middleware order (outermost first)::

    CORSMiddleware            explicit origins, credentials allowed (§73)
    SecurityHeadersMiddleware CSP / HSTS / frame + sniff protection (§73 / §40.3)
    RequestContextMiddleware  request id, best-effort tenant binding, access log

The tenant binding in the middleware is *observability only*; authorisation and the
authoritative :class:`~app.core.context.RequestContext` are produced by
:func:`app.core.deps.get_context`, and tenant isolation is enforced by the SQL guard in
:mod:`app.core.tenancy`.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

import structlog
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import __version__
from app.api import health
from app.api.v1 import api_router
from app.core.config import Settings, get_settings
from app.core.deps import UNSAFE_METHODS
from app.core.errors import REQUEST_ID_HEADER, install_exception_handlers
from app.core.logging import (
    bind_request_id,
    clear_log_context,
    configure_logging,
    get_logger,
)
from app.core.rate_limit import close_redis, rate_limit
from app.core.security import CSRF_HEADER_NAME, new_request_id
from app.db.session import dispose_engine, get_engine

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

    from starlette.responses import Response

logger = get_logger(__name__)

#: Content-Security-Policy for API responses. The API serves JSON only, so everything
#: is denied: a stored-XSS payload reflected by an error body has nowhere to execute.
API_CSP: Final[str] = (
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach the §73 browser hardening headers to every response."""

    def __init__(self, app: object, *, hsts: bool) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._hsts = hsts

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("Content-Security-Policy", API_CSP)
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        # Authenticated API answers must not be cached by intermediaries (§40.2).
        headers.setdefault("Cache-Control", "no-store")
        if self._hsts:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign a request id, bind the log context, and emit one access log line.

    Also performs a *best-effort* decode of the access token so that log lines produced
    before dependency resolution (rejections, validation errors) still carry
    ``tenant_id`` / ``user_id``. A bad token is ignored here; the real check happens in
    :func:`app.core.deps.get_context`.
    """

    def __init__(self, app: object, *, settings: Settings) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._settings = settings

    def _bind_tenant_best_effort(self, request: Request) -> None:
        from app.core.security import verify_access_token

        authorization = request.headers.get("Authorization", "")
        token = (
            authorization[7:].strip()
            if authorization.lower().startswith("bearer ")
            else request.cookies.get(self._settings.session_cookie_name, "")
        )
        if not token:
            return
        try:
            claims = verify_access_token(token, settings=self._settings)
        except Exception:
            # A bad/expired token must never break logging or the request pipeline;
            # ``get_context`` is the component that rejects it.
            return
        extra = {"workspace_id": claims.wid} if claims.wid else {}
        structlog.contextvars.bind_contextvars(
            tenant_id=claims.tid, user_id=claims.sub, **extra
        )

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or new_request_id()
        request.state.request_id = request_id
        clear_log_context()
        bind_request_id(request_id)
        self._bind_tenant_best_effort(request)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            logger.info(
                "request",
                method=request.method,
                path=request.url.path,
                duration_ms=round(duration_ms, 2),
                mutating=request.method in UNSAFE_METHODS,
            )
        response.headers[REQUEST_ID_HEADER] = request_id
        clear_log_context()
        return response


def _configure_tracing(app: FastAPI, settings: Settings) -> None:
    """OpenTelemetry tracing (§49.5).

    Span attributes are limited to route templates and status codes by the FastAPI
    instrumentor; request bodies are never captured, which keeps transcript content out
    of the trace backend just as the redaction processor keeps it out of the logs.
    """
    if not settings.otel_enabled:
        return
    from opentelemetry import trace
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create(
        {SERVICE_NAME: settings.otel_service_name, SERVICE_VERSION: __version__}
    )
    provider = TracerProvider(resource=resource)
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
            )
        )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="healthz,readyz",
        tracer_provider=provider,
    )
    logger.info("tracing_enabled", service=settings.otel_service_name)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Graceful startup / shutdown.

    Startup creates the connection pool eagerly so the first request does not pay for
    it, but does **not** hard-fail on an unreachable dependency: ``/readyz`` reports the
    degradation and the orchestrator keeps the pod out of rotation until it recovers
    (§49.4). Shutdown drains the pool and the Redis client.
    """
    _ = app
    settings = get_settings()
    logger.info(
        "startup",
        app_env=settings.app_env,
        version=__version__,
        llm_provider=settings.llm_provider,
        tts_provider=settings.tts_provider,
        otel_enabled=settings.otel_enabled,
        # Secrets are intentionally reported as booleans only.
        openai_key_present=settings.openai_api_key is not None,
        elevenlabs_key_present=settings.elevenlabs_api_key is not None,
    )
    get_engine(settings)
    try:
        yield
    finally:
        logger.info("shutdown")
        await dispose_engine()
        await close_redis()
        clear_log_context()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the ASGI application.

    Args:
        settings: Injected in tests; production reads the process environment.
    """
    cfg = settings or get_settings()
    configure_logging(cfg)

    app = FastAPI(
        title="AI Coach — AI Orchestration API",
        version=__version__,
        description=(
            "Enterprise AI training platform API. Provider credentials never leave "
            "this process (spec §56 / §70 / §71)."
        ),
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        docs_url="/docs" if not cfg.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not cfg.is_production else None,
    )

    # Innermost first: request context, then security headers, then CORS. Starlette
    # applies middleware in reverse registration order, so CORS ends up outermost and
    # can answer a preflight without running the rest of the stack.
    app.add_middleware(RequestContextMiddleware, settings=cfg)
    app.add_middleware(SecurityHeadersMiddleware, hsts=not cfg.is_local)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.cors_allow_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", CSRF_HEADER_NAME, REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER, "Retry-After"],
        max_age=600,
    )

    install_exception_handlers(app)
    _configure_tracing(app, cfg)

    app.include_router(health.router)
    # A coarse per-principal backstop on top of each route's own bucket (§40.3/§49.4):
    # even an endpoint whose author forgot a limiter cannot be hammered.
    app.include_router(
        api_router,
        prefix=cfg.api_prefix,
        dependencies=[
            Depends(
                rate_limit(
                    "global",
                    per_minute=cfg.rate_limit_default_per_minute,
                    burst=max(30, cfg.rate_limit_default_per_minute // 2),
                )
            )
        ],
    )

    return app


#: ASGI entry point: ``uvicorn app.main:app``.
app = create_app()
