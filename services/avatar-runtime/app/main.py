"""Avatar Runtime — local Digital Human service (§39).

Binds to loopback only. It is reached from the browser same-origin through the
nginx `/avatar/` prefix in production, and directly in development.

The service is designed to start and serve on a machine with no ML engine
installed at all: expression control, compositing and the static-portrait
backend are numpy-only, and every engine sits behind a lazy import. That is what
makes §53 — an avatar failure must never end a training session — true at the
process level and not just inside the render loop.
"""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import routes_avatar, routes_health, routes_session, websocket
from app.core.config import Settings, get_settings
from app.core.errors import AvatarRuntimeError
from app.core.logging import configure_logging
from app.orchestrator import AvatarOrchestrator
from app.platform.detect import cached_platform, choose_profile

log = structlog.get_logger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    configure_logging(cfg)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        platform = cached_platform()
        profile = choose_profile(platform)
        app.state.orchestrator = AvatarOrchestrator(cfg)
        log.info(
            "avatar.runtime.started",
            platform=str(platform.accelerator),
            profile=str(profile.name),
            memory_mb=platform.total_memory_mb,
            avatars=app.state.orchestrator.store.list_ids(),
            engines={k: v for k, v in platform.modules.items() if v},
        )
        try:
            yield
        finally:
            await app.state.orchestrator.aclose()
            log.info("avatar.runtime.stopped")

    app = FastAPI(
        title="AI Coach Avatar Runtime",
        version="0.1.0",
        summary="Local LivePortrait + MuseTalk digital human runtime",
        lifespan=lifespan,
    )
    app.state.settings = cfg

    # The browser talks to this service directly in development, where the page
    # is on :3000 and the runtime on :8765. In production nginx makes it
    # same-origin and this list is empty.
    if cfg.cors_allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cfg.cors_allow_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type"],
        )

    @app.exception_handler(AvatarRuntimeError)
    async def _runtime_error(request: Request, exc: AvatarRuntimeError) -> JSONResponse:
        status = getattr(exc, "status_code", 400)
        code = getattr(exc, "code", None)
        log.warning("avatar.error", code=str(code), detail=str(exc), path=request.url.path)
        return JSONResponse(
            status_code=status,
            content={"error": str(code) if code else "avatar_error", "detail": str(exc)},
        )

    app.include_router(routes_health.router)
    app.include_router(routes_avatar.router)
    app.include_router(routes_session.router)
    app.include_router(websocket.router)
    return app


#: ASGI entry point: ``uvicorn app.main:app``.
app = create_app()
