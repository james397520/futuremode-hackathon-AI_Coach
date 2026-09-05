"""Tenant isolation guard (spec §74 / §10 / §40.2).

Goal: **cross-tenant retrieval must be impossible by construction, not by convention.**

Three layers, each independently sufficient to stop a mistake:

1. :func:`scoped_select` / :class:`ScopedRepository` — the *only* sanctioned way for a
   service to read tenant data. They emit ``WHERE tenant_id = :t AND workspace_id = :w``
   for you, so no service ever hand-writes the predicate.

2. :func:`install_tenant_guard` — a SQLAlchemy ``do_orm_execute`` listener bound to the
   request's session. Any SELECT/UPDATE/DELETE that touches a table carrying both
   ``tenant_id`` and ``workspace_id`` is **rejected** unless its WHERE clause constrains
   both columns. A developer who forgets the filter gets
   :class:`~app.core.errors.TenantIsolationError`, not another tenant's rows.
   The same listener set adds a ``before_flush`` hook so a write cannot be *stamped*
   with a foreign tenant either.

3. :func:`assert_same_tenant` — a pure, unit-testable assertion used at trust
   boundaries (after loading an object by primary key, before emitting it, before
   handing an id to Qdrant/S3).

A table is "tenant scoped" purely by shape: if it has both columns, it is guarded.
That is deliberate — adding a new model cannot accidentally opt out.

Escape hatch: platform-level queries that legitimately cross tenants (retention
sweeps, health probes, the login lookup that resolves which tenant a user belongs to)
must call :func:`allow_cross_tenant`, which tags the statement with an explicit
execution option and a required human-readable ``reason``. Those call sites are
greppable and auditable; nothing else can bypass the guard.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Final, TypeVar

import structlog
from sqlalchemy import Delete, Select, Update, delete, event, func, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import visitors

from app.core.errors import TenantIsolationError

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

    from sqlalchemy import Column
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import ORMExecuteState
    from sqlalchemy.sql.elements import ColumnElement

    from app.core.context import RequestContext

logger = structlog.get_logger(__name__)

TENANT_COLUMN: Final[str] = "tenant_id"
WORKSPACE_COLUMN: Final[str] = "workspace_id"

#: Execution-option key that documents a deliberate cross-tenant query.
CROSS_TENANT_OPTION: Final[str] = "allow_cross_tenant"
#: Execution-option key carrying the justification string.
CROSS_TENANT_REASON: Final[str] = "cross_tenant_reason"

ModelT = TypeVar("ModelT")
StatementT = TypeVar("StatementT", bound=Select[Any] | Update | Delete)


# ---------------------------------------------------------------------------
# Scope value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TenantScope:
    """The (tenant, workspace) pair every query is confined to."""

    tenant_id: str
    workspace_id: str

    def __post_init__(self) -> None:
        if not self.tenant_id or not self.workspace_id:
            raise TenantIsolationError(
                log_context={"reason": "empty_scope"},
            )

    def matches(self, obj: object) -> bool:
        """True when ``obj`` carries exactly this tenant + workspace."""
        return (
            getattr(obj, TENANT_COLUMN, None) == self.tenant_id
            and getattr(obj, WORKSPACE_COLUMN, None) == self.workspace_id
        )

    def as_dict(self) -> dict[str, str]:
        return {TENANT_COLUMN: self.tenant_id, WORKSPACE_COLUMN: self.workspace_id}


def scope_from_context(ctx: RequestContext) -> TenantScope:
    """Build a scope from the verified request context.

    Raises:
        WorkspaceScopeRequiredError: the caller has not selected a workspace.
    """
    return TenantScope(tenant_id=ctx.tenant_id, workspace_id=ctx.require_workspace())


def assert_same_tenant(scope: TenantScope, *objects: object) -> None:
    """Assert every object belongs to ``scope``.

    Pure and side-effect free, so it can be unit tested with plain stubs::

        scope = TenantScope("t1", "w1")
        assert_same_tenant(scope, SimpleNamespace(tenant_id="t1", workspace_id="w1"))

    Raises:
        TenantIsolationError: on the first mismatch (reported to the client as 404 so
            the API never confirms that another tenant's resource exists).
    """
    for obj in objects:
        if obj is None:
            continue
        obj_tenant = getattr(obj, TENANT_COLUMN, None)
        obj_workspace = getattr(obj, WORKSPACE_COLUMN, None)
        if obj_tenant is None or obj_workspace is None:
            raise TenantIsolationError(
                log_context={
                    "reason": "object_not_tenant_scoped",
                    "object_type": type(obj).__name__,
                }
            )
        if obj_tenant != scope.tenant_id or obj_workspace != scope.workspace_id:
            logger.error(
                "tenant_isolation_violation",
                object_type=type(obj).__name__,
                expected_tenant=scope.tenant_id,
                expected_workspace=scope.workspace_id,
                actual_tenant=obj_tenant,
                actual_workspace=obj_workspace,
            )
            raise TenantIsolationError(
                log_context={
                    "reason": "scope_mismatch",
                    "object_type": type(obj).__name__,
                }
            )


# ---------------------------------------------------------------------------
# Statement helpers
# ---------------------------------------------------------------------------


def is_tenant_scoped(target: Any) -> bool:
    """True when the mapped class/mapper has both tenancy columns."""
    try:
        mapper = inspect(target)
    except Exception:  # not a mapped entity
        return False
    columns = getattr(mapper, "columns", None)
    if columns is None:
        return False
    return TENANT_COLUMN in columns and WORKSPACE_COLUMN in columns


def tenant_predicates(model: type[Any], scope: TenantScope) -> list[ColumnElement[bool]]:
    """The two predicates that confine ``model`` to ``scope``."""
    if not is_tenant_scoped(model):
        raise TenantIsolationError(
            log_context={"reason": "model_not_tenant_scoped", "model": model.__name__}
        )
    return [
        getattr(model, TENANT_COLUMN) == scope.tenant_id,
        getattr(model, WORKSPACE_COLUMN) == scope.workspace_id,
    ]


def scoped_select(model: type[ModelT], scope: TenantScope) -> Select[tuple[ModelT]]:
    """``select(model)`` pre-filtered to ``scope``. Use this instead of ``select()``."""
    return select(model).where(*tenant_predicates(model, scope))


def apply_scope(statement: StatementT, model: type[Any], scope: TenantScope) -> StatementT:
    """Add the tenancy predicates to an existing SELECT/UPDATE/DELETE."""
    return statement.where(*tenant_predicates(model, scope))  # type: ignore[return-value]


def scoped_delete(model: type[Any], scope: TenantScope) -> Delete:
    return delete(model).where(*tenant_predicates(model, scope))


def allow_cross_tenant(statement: StatementT, *, reason: str) -> StatementT:
    """Mark a statement as a deliberate, justified cross-tenant query.

    ``reason`` is mandatory and is logged, so every bypass is attributable.
    """
    if not reason:
        raise ValueError("allow_cross_tenant() requires a reason")
    return statement.execution_options(  # type: ignore[return-value]
        **{CROSS_TENANT_OPTION: True, CROSS_TENANT_REASON: reason}
    )


# ---------------------------------------------------------------------------
# The guard
# ---------------------------------------------------------------------------


def _referenced_column_names(clause: ColumnElement[Any] | None) -> set[tuple[str, str]]:
    """Collect ``(table_name, column_name)`` pairs referenced by a WHERE clause."""
    found: set[tuple[str, str]] = set()
    if clause is None:
        return found

    def _visit(column: Column[Any]) -> None:
        table = getattr(column, "table", None)
        table_name = getattr(table, "name", "") or ""
        found.add((table_name, column.name))

    visitors.traverse(clause, {}, {"column": _visit})
    return found


def _statement_is_scoped(statement: Select[Any] | Update | Delete) -> tuple[bool, str]:
    """Check that every tenant-scoped table in the statement is constrained.

    Returns ``(ok, offending_table)``.
    """
    referenced = _referenced_column_names(statement.whereclause)
    scoped_tables = {table for table, column in referenced if column == TENANT_COLUMN}
    workspace_tables = {table for table, column in referenced if column == WORKSPACE_COLUMN}

    for table in _statement_tenant_tables(statement):
        if table not in scoped_tables or table not in workspace_tables:
            return False, table
    return True, ""


def _statement_tenant_tables(statement: Select[Any] | Update | Delete) -> set[str]:
    """Names of tenant-scoped tables the statement reads or mutates.

    Both FROM sources are inspected for a SELECT: ``columns_clause_froms`` (what the
    entities in the columns clause imply) *and* ``get_final_froms()`` (the resolved FROM
    list). The second one matters for aggregates such as
    ``select(func.count()).select_from(Model)``, where the columns clause names no
    entity at all and a guard looking only at the first source would wave the query
    through unscoped.
    """
    tables: set[str] = set()
    froms: list[Any] = []
    if isinstance(statement, Select):
        froms.extend(statement.columns_clause_froms)
        # Some constructs cannot resolve their FROM list without compiling; the columns
        # clause above is then the best available signal.
        with suppress(Exception):
            froms.extend(statement.get_final_froms())
    else:
        froms.append(statement.table)
    for from_clause in froms:
        for table in _iter_tables(from_clause):
            columns = {column.name for column in table.columns}
            if TENANT_COLUMN in columns and WORKSPACE_COLUMN in columns:
                tables.add(table.name)
    return tables


def _iter_tables(from_clause: Any) -> Iterable[Any]:
    """Yield concrete tables inside a FROM element (handles joins/aliases)."""
    if hasattr(from_clause, "columns") and hasattr(from_clause, "name"):
        yield from_clause
    for attr in ("left", "right", "element", "original"):
        child = getattr(from_clause, attr, None)
        if child is not None and child is not from_clause:
            yield from _iter_tables(child)


def install_tenant_guard(session: AsyncSession, scope: TenantScope) -> None:
    """Bind the isolation guard to one request-scoped :class:`AsyncSession`.

    Registers two listeners on the underlying sync ``Session``:

    * ``do_orm_execute`` — rejects an unscoped SELECT/UPDATE/DELETE on a tenant table.
    * ``before_flush`` — rejects an INSERT/UPDATE that stamps a foreign tenant, and
      auto-fills the tenancy columns when a new object left them unset.

    The guard is idempotent per session.
    """
    sync_session = session.sync_session
    if getattr(sync_session, "_ai_coach_tenant_guard", None) is not None:
        sync_session.info["tenant_scope"] = scope
        return

    sync_session.info["tenant_scope"] = scope

    def _on_orm_execute(state: ORMExecuteState) -> None:
        if not state.is_orm_statement:
            return
        # Relationship / deferred-column loads originate from an object that was
        # already fetched through a scoped query; their criteria are the FK join.
        if state.is_relationship_load or state.is_column_load:
            return
        if state.execution_options.get(CROSS_TENANT_OPTION):
            logger.warning(
                "cross_tenant_query_allowed",
                reason=str(state.execution_options.get(CROSS_TENANT_REASON, "unspecified")),
            )
            return
        statement = state.statement
        if not isinstance(statement, Select | Update | Delete):
            return
        ok, table = _statement_is_scoped(statement)
        if not ok:
            logger.error(
                "unscoped_tenant_query_blocked",
                table=table,
                tenant_id=scope.tenant_id,
                workspace_id=scope.workspace_id,
            )
            raise TenantIsolationError(
                log_context={"reason": "unscoped_query", "table": table}
            )

    def _on_before_flush(
        flush_session: Session,
        flush_context: Any,
        instances: Any,
    ) -> None:
        _ = (flush_context, instances)
        active: TenantScope = flush_session.info.get("tenant_scope", scope)
        for obj in flush_session.new:
            if not is_tenant_scoped(type(obj)):
                continue
            if getattr(obj, TENANT_COLUMN, None) is None:
                setattr(obj, TENANT_COLUMN, active.tenant_id)
            if getattr(obj, WORKSPACE_COLUMN, None) is None:
                setattr(obj, WORKSPACE_COLUMN, active.workspace_id)
            assert_same_tenant(active, obj)
        for obj in flush_session.dirty:
            if is_tenant_scoped(type(obj)):
                assert_same_tenant(active, obj)
        for obj in flush_session.deleted:
            if is_tenant_scoped(type(obj)):
                assert_same_tenant(active, obj)

    event.listen(sync_session, "do_orm_execute", _on_orm_execute)
    event.listen(sync_session, "before_flush", _on_before_flush)
    sync_session._ai_coach_tenant_guard = (_on_orm_execute, _on_before_flush)


# ---------------------------------------------------------------------------
# Repository
# ---------------------------------------------------------------------------


class ScopedRepository:
    """Thin, always-scoped data-access facade handed to every service.

    Services receive ``(db_session, ctx)`` and build one of these; they must not call
    ``select()`` directly. Every method here is confined to ``scope``.
    """

    __slots__ = ("_session", "scope")

    def __init__(self, session: AsyncSession, scope: TenantScope) -> None:
        self._session = session
        self.scope = scope

    @property
    def session(self) -> AsyncSession:
        return self._session

    def select(self, model: type[ModelT]) -> Select[tuple[ModelT]]:
        """A pre-scoped ``SELECT`` the caller may further refine."""
        return scoped_select(model, self.scope)

    async def get(self, model: type[ModelT], entity_id: str) -> ModelT | None:
        """Fetch by primary key *within* the scope (never by bare ``session.get``)."""
        statement = scoped_select(model, self.scope).where(
            getattr(model, "id") == entity_id  # noqa: B009
        )
        result = await self._session.execute(statement)
        obj = result.scalar_one_or_none()
        if obj is not None:
            assert_same_tenant(self.scope, obj)
        return obj

    async def require(self, model: type[ModelT], entity_id: str) -> ModelT:
        """Like :meth:`get` but raises 404 when absent."""
        obj = await self.get(model, entity_id)
        if obj is None:
            from app.core.errors import NotFoundError

            raise NotFoundError.of(model.__name__, entity_id)
        return obj

    async def list(
        self,
        model: type[ModelT],
        *criteria: ColumnElement[bool],
        order_by: Sequence[ColumnElement[Any]] | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ModelT]:
        statement = scoped_select(model, self.scope).where(*criteria)
        if order_by:
            statement = statement.order_by(*order_by)
        statement = statement.limit(limit).offset(offset)
        result = await self._session.execute(statement)
        return list(result.scalars().all())

    async def count(self, model: type[Any], *criteria: ColumnElement[bool]) -> int:
        statement = (
            select(func.count())
            .select_from(model)
            .where(*tenant_predicates(model, self.scope), *criteria)
        )
        result = await self._session.execute(statement)
        return int(result.scalar_one())

    def add(self, obj: ModelT) -> ModelT:
        """Stamp the scope onto a new row and stage it."""
        if is_tenant_scoped(type(obj)):
            setattr(obj, TENANT_COLUMN, self.scope.tenant_id)
            setattr(obj, WORKSPACE_COLUMN, self.scope.workspace_id)
        self._session.add(obj)
        return obj

    async def delete(self, obj: object) -> None:
        assert_same_tenant(self.scope, obj)
        await self._session.delete(obj)

    async def flush(self) -> None:
        await self._session.flush()
