"""Async engine + session factory (spec §49.3 — the API stays stateless).

The engine is created lazily and shared per process. ``pool_pre_ping`` plus a bounded
pool keeps a rolling deploy from wedging on stale connections (§49.4).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    """Build a new async engine (used by the app factory and by Alembic)."""
    cfg = settings or get_settings()
    connect_args: dict[str, Any] = {
        # asyncpg caches prepared statements per connection; disable when running
        # behind a transaction-pooling proxy (pgbouncer) which rotates backends.
        "statement_cache_size": 0,
        "server_settings": {"application_name": cfg.app_name},
    }
    return create_async_engine(
        cfg.database_url,
        echo=cfg.debug_sql,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
        pool_recycle=1800,
        connect_args=connect_args,
    )


def get_engine(settings: Settings | None = None) -> AsyncEngine:
    """Process-wide engine singleton."""
    global _engine
    if _engine is None:
        _engine = create_engine(settings)
    return _engine


def get_sessionmaker(settings: Settings | None = None) -> async_sessionmaker[AsyncSession]:
    """Process-wide session factory.

    ``expire_on_commit=False`` so a router can still read an ORM object it just
    committed while shaping the response.
    """
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(settings),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope for workers and scripts (routers use ``core.deps.get_db``)."""
    factory = get_sessionmaker()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise


async def ping_database(settings: Settings | None = None) -> bool:
    """Readiness probe for Postgres (§health)."""
    engine = get_engine(settings)
    async with engine.connect() as connection:
        result = await connection.execute(text("SELECT 1"))
        return result.scalar_one() == 1


async def dispose_engine() -> None:
    """Close the pool on shutdown (graceful drain)."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None
