"""FastAPI application factory for the private inference service (spec §72 / §49).

============================================================================
 CONTENT BOUNDARY — read before adding an endpoint
============================================================================
 This process sees **raw customer text**: every sentence of every knowledge base
 that gets indexed, and every trainee utterance that gets embedded or reranked.
 That makes it the single highest-value place in the platform to leak content
 from, and the rules are correspondingly blunt:

   * No request field carrying text (``text``, ``texts``, ``input``, ``query``,
     ``documents``, ``prompt``) is ever logged, echoed into an error body, or
     placed in a span attribute. :mod:`app.core.logging` enforces this twice —
     a typed emit surface that has no key to put content in, and a redaction
     processor that runs on every event from every library.
   * No error message contains a file path, an onnxruntime string or a
     traceback. :mod:`app.core.errors` returns a fixed sentence and logs the
     detail server-side.
   * Nothing leaves this process except vectors and scores. There is no outbound
     provider call here at all; the OpenAI path lives in ``apps/api`` and never
     routes through this service (§2.1).

 The service is also **internal**: it binds inside the private network, it is
 not reachable from a browser, and ``cors_allow_origins`` is empty by default
 for that reason (see :class:`~app.core.config.Settings`).
============================================================================

Middleware order (outermost first)::

    CORSMiddleware            only when explicitly configured; usually absent
    SecurityHeadersMiddleware CSP / frame + sniff protection, HSTS off locally
    BodySizeLimitMiddleware   `max_request_bytes`, refused before parsing
    RequestContextMiddleware  request id, log binding, access log, metrics

Startup is non-blocking: the port opens immediately and models load in the
background, so ``/healthz`` and ``/metrics`` are available even when the model
directory is empty. ``/readyz`` is the endpoint that tells the truth about
whether this pod can serve traffic — see :mod:`app.api.deps`.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Final

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app import __version__
from app.api import routes_embed, routes_health, routes_models, routes_rerank
from app.api.deps import ServiceState, build_state, new_request_id
from app.core.config import REQUEST_ID_HEADER, SECRET_HEADER, Settings, get_settings
from app.core.errors import (
    ERROR_TYPE_BASE,
    ErrorCode,
    ProblemDetail,
    install_exception_handlers,
)
from app.core.logging import (
    bind_request_id,
    clear_log_context,
    configure_logging,
    get_logger,
)
from app.core.metrics import REQUEST_DURATION, REQUESTS

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable

    from starlette.responses import Response

    from app.models.session import SessionFactory
    from app.preprocessing.tokenizer import TokenizerFactory

logger = get_logger(__name__)

#: The service answers JSON only, so everything is denied: an error body that
#: somehow reflected input has nowhere to execute. Same policy as ``apps/api``.
API_CSP: Final[str] = (
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)

#: Prefix for the versioned surface. The same routers are also mounted at the
#: root so that a caller configured with ``base_url=".../v1"`` and one configured
#: with the bare host both resolve — ``apps/api``'s embedder uses the former and
#: its reranker the latter.
API_PREFIX: Final[str] = "/v1"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Attach the §73 hardening headers to every response."""

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
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        # A vector is derived from customer content; no intermediary may keep it.
        headers.setdefault("Cache-Control", "no-store")
        if self._hsts:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Refuse an oversized body on ``Content-Length``, before anything parses it.

    The per-item and per-request character guards in
    :mod:`app.preprocessing.text` are the precise limits; this is the crude one
    that stops a 500 MB body from being buffered into memory in the first place.
    Chunked requests without a ``Content-Length`` fall through to those guards.

    The response is built by hand rather than raised: an exception from
    ``BaseHTTPMiddleware`` does not reach the application's exception handlers,
    so raising here would produce a bare 500 instead of a typed problem body.
    """

    def __init__(self, app: object, *, max_bytes: int) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._max_bytes = max_bytes

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        raw_length = request.headers.get("content-length")
        if raw_length is not None:
            try:
                length = int(raw_length)
            except ValueError:
                length = 0
            if length > self._max_bytes:
                request_id = getattr(request.state, "request_id", None)
                problem = ProblemDetail(
                    type=f"{ERROR_TYPE_BASE}/{ErrorCode.PAYLOAD_TOO_LARGE.value}",
                    title="Payload too large",
                    status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    code=ErrorCode.PAYLOAD_TOO_LARGE,
                    detail=(
                        f"The request body exceeds this service's limit of "
                        f"{self._max_bytes} bytes. Split it into smaller batches."
                    ),
                    request_id=request_id if isinstance(request_id, str) else None,
                )
                logger.info(
                    "inference.rejected",
                    code=problem.code.value,
                    status=problem.status,
                    reason="body_too_large",
                )
                return ORJSONResponse(
                    status_code=problem.status,
                    content=problem.model_dump(mode="json"),
                )
        return await call_next(request)


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign a request id, bind the log context, emit one access log line.

    The access log records the **route template** and never the query string:
    this service takes its input in the body precisely so that no content can end
    up in a URL, and logging ``request.url`` would undo that the first time
    someone added a query parameter.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get(REQUEST_ID_HEADER) or new_request_id()
        request.state.request_id = request_id
        clear_log_context()
        bind_request_id(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            duration_s = time.perf_counter() - started
            endpoint = _endpoint_label(request)
            logger.info(
                "request",
                method=request.method,
                path=endpoint,
                duration_ms=round(duration_s * 1000, 2),
            )
            REQUEST_DURATION.labels(endpoint=endpoint).observe(duration_s)
        # `code` is the HTTP status rather than the typed error code: the label
        # set has to stay small, and the typed code is already in the log line
        # the exception handler wrote for this same request id.
        REQUESTS.labels(endpoint=endpoint, code=str(response.status_code)).inc()
        response.headers[REQUEST_ID_HEADER] = request_id
        clear_log_context()
        return response


def _endpoint_label(request: Request) -> str:
    """Route template, or ``unmatched`` — never the raw path.

    A raw path would be unbounded label cardinality on ``/models/{model_id}``
    and, worse, would put caller-supplied strings into the metric registry.
    """
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) and path else "unmatched"


def _configure_tracing(app: FastAPI, settings: Settings) -> None:
    """OpenTelemetry tracing (§49.5), mirroring ``apps/api``'s hook.

    The FastAPI instrumentor records route templates and status codes only;
    request bodies are never captured, which keeps knowledge-base text out of the
    trace backend for the same reason the redaction processor keeps it out of the
    logs. The SDK is an optional extra, imported lazily, so a deployment without
    it starts normally.
    """
    if not settings.otel_enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        # Tracing is observability, not function: a missing extra must not stop
        # the service from serving (§49.4).
        logger.error("tracing_unavailable", reason="opentelemetry_not_installed")
        return

    resource = Resource.create(
        {SERVICE_NAME: settings.otel_service_name, SERVICE_VERSION: __version__}
    )
    provider = TracerProvider(resource=resource)
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
            )
        )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(
        app,
        excluded_urls="healthz,readyz,metrics",
        tracer_provider=provider,
    )
    logger.info("tracing_enabled", service=settings.otel_service_name)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start the pool and the background warmup; release everything on shutdown.

    Startup never hard-fails on a model problem. A missing weight file, an
    unreadable manifest or an accelerator that did not engage all leave the
    process up and reporting the reason through ``/readyz`` (§49.4) — a
    crash-looping container in a locked-down environment is far harder to
    diagnose than a pod that is up and says "model_integrity_failed".
    """
    state: ServiceState = app.state.service
    settings = state.settings
    logger.info(
        "startup",
        app_env=settings.app_env.value,
        version=__version__,
        device=settings.device.value,
        providers=list(settings.execution_providers),
        preload_models=list(settings.preload_models),
        warmup_on_startup=settings.warmup_on_startup,
        auth_required=settings.auth_required,
        otel_enabled=settings.otel_enabled,
    )
    await state.start()
    try:
        yield
    finally:
        logger.info("shutdown")
        await state.aclose()
        clear_log_context()


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: SessionFactory | None = None,
    tokenizer_factory: TokenizerFactory | None = None,
) -> FastAPI:
    """Build the ASGI application.

    Args:
        settings: Injected in tests; production reads the process environment.
        session_factory: Injected in tests to avoid onnxruntime and real weights.
        tokenizer_factory: Injected in tests to avoid `tokenizers` and real vocabs.
    """
    cfg = settings or get_settings()
    configure_logging(cfg)

    app = FastAPI(
        title="AI Coach — Private Inference Service",
        version=__version__,
        description=(
            "Embedding and cross-encoder reranking on open weights, inside the "
            "private environment (spec §72). Internal service: no browser talks "
            "to it, and no request content is ever logged (§49.5)."
        ),
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        docs_url="/docs" if not cfg.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not cfg.is_production else None,
    )
    app.state.service = build_state(
        cfg,
        session_factory=session_factory,
        tokenizer_factory=tokenizer_factory,
    )

    # Innermost first — Starlette applies middleware in reverse registration
    # order, so CORS (when present) ends up outermost and can answer a preflight
    # without running the rest of the stack.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=cfg.max_request_bytes)
    app.add_middleware(SecurityHeadersMiddleware, hsts=not cfg.is_local)
    if cfg.cors_allow_origins:
        # Never a wildcard, never credentials: the only legitimate origin is the
        # API service, and this service has no cookie session to protect.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_allow_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization", SECRET_HEADER, REQUEST_ID_HEADER],
            expose_headers=[REQUEST_ID_HEADER, "Retry-After"],
            max_age=600,
        )

    install_exception_handlers(app)
    _configure_tracing(app, cfg)

    # Probes and the scrape endpoint live at the root, unversioned and
    # unauthenticated, exactly as in `apps/api`.
    app.include_router(routes_health.router)

    for prefix, in_schema in ((API_PREFIX, True), ("", False)):
        # The root mount is the compatibility surface: `apps/api`'s reranker is
        # configured with a bare base URL while its embedder uses `/v1`. Both
        # must resolve, but only one copy belongs in the OpenAPI document.
        app.include_router(routes_embed.router, prefix=prefix, include_in_schema=in_schema)
        app.include_router(routes_rerank.router, prefix=prefix, include_in_schema=in_schema)
        app.include_router(routes_models.router, prefix=prefix, include_in_schema=in_schema)

    return app


#: ASGI entry point: ``uvicorn app.main:app``.
app = create_app()
