"""Alembic environment — async (asyncpg) configuration.

The database URL comes from ``app.core.config.Settings`` (i.e. ``DATABASE_URL``), never
from ``alembic.ini``, so credentials stay out of version control and migrations always
target the same database the app does.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.db.base import Base

# Importing the models package registers every mapping on ``Base.metadata``, which is
# what autogenerate diffs against. Without this import Alembic would see an empty
# schema and cheerfully generate a migration that drops every table.
import app.db.models  # noqa: F401, E402  (import for side effects, after Base)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    return get_settings().database_url


def run_migrations_offline() -> None:
    """Emit SQL to stdout without connecting (``alembic upgrade head --sql``)."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: object) -> None:
    context.configure(
        connection=connection,  # type: ignore[arg-type]
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        include_schemas=False,
        # Every table is created in one transaction: a failed migration leaves no
        # half-applied schema behind (Postgres has transactional DDL).
        transaction_per_migration=False,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Connect with asyncpg and run the migrations inside ``run_sync``."""
    engine = create_async_engine(_database_url(), poolclass=None, future=True)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_do_run_migrations)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
