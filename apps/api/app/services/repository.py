"""Thin persistence seam between the services and `app.db` (owned by another module).

Why this exists: the ORM model classes live in `app.db.models`, which is written in
parallel. Rather than scatter guesses about class names through eight services, every
guess is isolated here:

* `Models.get("TrainingSession")` resolves a class lazily and raises a clear error
  naming what was missing, so a rename is a one-line fix in this file.
* `Repository` implements the four operations the services actually need (get by id,
  list with filters, insert, update) with **tenant columns always applied**.
* `InMemoryRepository` is a full stand-in used by the tests, so service logic —
  state machines, version pinning, review gates — is testable without a database.

Services always talk to a `RepositoryPort`, never to SQLAlchemy directly.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol, runtime_checkable

import structlog

log = structlog.get_logger(__name__)


class ModelNotAvailableError(RuntimeError):
    """`app.db.models` does not expose the expected ORM class."""


class Models:
    """Lazy accessor for `app.db.models`.

    ASSUMPTION: the API-platform module exposes SQLAlchemy models under
    `app.db.models` using the same names as the TypeScript entities in
    packages/shared (`TrainingSession`, `KnowledgeBase`, `KnowledgeDocument`,
    `Chunk`, `Question`, `Persona`, `Scenario`, `Rubric`, `Evaluation`,
    `ComplianceFinding`, `TranscriptTurn`, `CoachInsight`, `Assignment`,
    `SkillProfile`, `AuditEvent`). If it uses a different module path or names, only
    `_module()` and `ALIASES` need updating.
    """

    #: fallbacks tried in order, in case the platform module pluralised or prefixed
    ALIASES: dict[str, tuple[str, ...]] = {
        "TrainingSession": ("TrainingSession", "Session", "SessionModel"),
        "TranscriptTurn": ("TranscriptTurn", "Turn", "TranscriptTurnModel"),
        "KnowledgeBase": ("KnowledgeBase", "KnowledgeBaseModel"),
        "KnowledgeDocument": ("KnowledgeDocument", "Document", "DocumentModel"),
        "DocumentVersion": ("DocumentVersion", "DocumentVersionModel"),
        "Chunk": ("Chunk", "DocumentChunk", "ChunkModel"),
        "Question": ("Question", "QuestionModel"),
        "Persona": ("Persona", "PersonaModel"),
        "Scenario": ("Scenario", "ScenarioModel"),
        "Rubric": ("Rubric", "RubricModel"),
        "Evaluation": ("Evaluation", "EvaluationModel"),
        "ComplianceFinding": ("ComplianceFinding", "ComplianceFindingModel"),
        "CoachInsight": ("CoachInsight", "CoachInsightModel"),
        "Assignment": ("Assignment", "AssignmentModel"),
        "SkillProfile": ("SkillProfile", "SkillProfileModel"),
        "AuditEvent": ("AuditEvent", "AuditEventModel"),
        "MiningRun": ("MiningRun", "KnowledgeMiningRun", "MiningRunModel"),
    }

    _cache: dict[str, Any] = {}

    @staticmethod
    def _module() -> Any:
        from app import db  # noqa: PLC0415 - deliberately lazy

        module = getattr(db, "models", None)
        if module is None:
            import importlib

            module = importlib.import_module("app.db.models")
        return module

    @classmethod
    def get(cls, name: str) -> Any:
        if name in cls._cache:
            return cls._cache[name]
        module = cls._module()
        for candidate in cls.ALIASES.get(name, (name,)):
            model = getattr(module, candidate, None)
            if model is not None:
                cls._cache[name] = model
                return model
        raise ModelNotAvailableError(
            f"app.db.models does not define {name} "
            f"(tried {cls.ALIASES.get(name, (name,))}); update Models.ALIASES"
        )


#: Where the ORM column name differs from the wire/contract field name the services
#: use. Keeping the impedance mismatch in one table beats spreading `getattr` guesses
#: through eight services (and each entry is a one-line fix if the schema moves).
COLUMN_ALIASES: dict[str, dict[str, str]] = {
    # `metadata` is reserved by SQLAlchemy's declarative API, so the attribute is
    # `chunk_metadata` while the column and the wire field are both `metadata`.
    "Chunk": {"metadata": "chunk_metadata"},
    "Document": {
        "content_sha256": "checksum_sha256",
        "url": "source_url",
        "mime_type": "content_type",
    },
    "KnowledgeDocument": {
        "content_sha256": "checksum_sha256",
        "url": "source_url",
        "mime_type": "content_type",
    },
    # `TrainingSession` has no separate `session_id` column — the primary key *is* the
    # session id, and the services already pass `id` as well.
    "TrainingSession": {"session_id": "id"},
}


def translate(model: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """Rename contract field names onto ORM attribute names."""
    aliases = COLUMN_ALIASES.get(model)
    if not aliases:
        return dict(values)
    out: dict[str, Any] = {}
    for key, value in values.items():
        target = aliases.get(key, key)
        # An explicit value for the target wins over an aliased one.
        if target in out and key in aliases:
            continue
        out[target] = value
    return out


@runtime_checkable
class RepositoryPort(Protocol):
    async def get(self, model: str, entity_id: str) -> Any | None: ...

    async def list(
        self,
        model: str,
        *,
        filters: Mapping[str, Any] | None = None,
        order_by: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Any]: ...

    async def add(self, model: str, values: Mapping[str, Any]) -> Any: ...

    async def update(self, model: str, entity_id: str, values: Mapping[str, Any]) -> Any: ...

    async def delete(self, model: str, entity_id: str) -> bool: ...

    async def commit(self) -> None: ...


class Repository:
    """SQLAlchemy-backed repository with tenant columns applied to every operation."""

    def __init__(self, db: Any, *, tenant_id: str, workspace_id: str) -> None:
        self.db = db
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id

    def _tenant_filters(self, model: Any) -> dict[str, Any]:
        filters: dict[str, Any] = {}
        if hasattr(model, "tenant_id"):
            filters["tenant_id"] = self.tenant_id
        if hasattr(model, "workspace_id"):
            filters["workspace_id"] = self.workspace_id
        return filters

    async def get(self, model: str, entity_id: str) -> Any | None:
        from sqlalchemy import select

        cls = Models.get(model)
        statement = select(cls).where(cls.id == entity_id)
        for key, value in self._tenant_filters(cls).items():
            statement = statement.where(getattr(cls, key) == value)
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def list(
        self,
        model: str,
        *,
        filters: Mapping[str, Any] | None = None,
        order_by: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Any]:
        from sqlalchemy import select

        cls = Models.get(model)
        statement = select(cls)
        resolved = translate(model, {**self._tenant_filters(cls), **dict(filters or {})})
        for key, value in resolved.items():
            if not hasattr(cls, key):
                continue
            column = getattr(cls, key)
            statement = (
                statement.where(column.in_(list(value)))
                if isinstance(value, (list, tuple, set))
                else statement.where(column == value)
            )
        if order_by and hasattr(cls, order_by.lstrip("-")):
            column = getattr(cls, order_by.lstrip("-"))
            statement = statement.order_by(column.desc() if order_by.startswith("-") else column)
        if offset:
            statement = statement.offset(offset)
        if limit:
            statement = statement.limit(limit)
        result = await self.db.execute(statement)
        return list(result.scalars().all())

    async def add(self, model: str, values: Mapping[str, Any]) -> Any:
        cls = Models.get(model)
        payload = translate(model, {**self._tenant_filters(cls), **dict(values)})
        entity = cls(**{k: v for k, v in payload.items() if hasattr(cls, k)})
        self.db.add(entity)
        await self.db.flush()
        return entity

    async def update(self, model: str, entity_id: str, values: Mapping[str, Any]) -> Any:
        entity = await self.get(model, entity_id)
        if entity is None:
            return None
        for key, value in translate(model, values).items():
            if hasattr(entity, key):
                setattr(entity, key, value)
        await self.db.flush()
        return entity

    async def delete(self, model: str, entity_id: str) -> bool:
        entity = await self.get(model, entity_id)
        if entity is None:
            return False
        await self.db.delete(entity)
        await self.db.flush()
        return True

    async def commit(self) -> None:
        await self.db.commit()


class Row(dict):  # noqa: FURB189 - a dict subclass keeps attribute access simple
    """Attribute-accessible row used by `InMemoryRepository`."""

    def __getattr__(self, item: str) -> Any:
        try:
            return self[item]
        except KeyError as exc:
            raise AttributeError(item) from exc

    def __setattr__(self, key: str, value: Any) -> None:
        self[key] = value


class InMemoryRepository:
    """Full in-memory stand-in. Used by the tests; also handy for local demos."""

    def __init__(self, *, tenant_id: str = "t1", workspace_id: str = "w1") -> None:
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.tables: dict[str, dict[str, Row]] = {}
        self.committed = 0

    def table(self, model: str) -> dict[str, Row]:
        return self.tables.setdefault(model, {})

    def seed(self, model: str, values: Mapping[str, Any]) -> Row:
        row = Row(
            {
                "tenant_id": self.tenant_id,
                "workspace_id": self.workspace_id,
                **dict(values),
            }
        )
        self.table(model)[str(row["id"])] = row
        return row

    async def get(self, model: str, entity_id: str) -> Any | None:
        row = self.table(model).get(str(entity_id))
        if row is None:
            return None
        if row.get("tenant_id") not in (None, self.tenant_id):
            return None
        if row.get("workspace_id") not in (None, self.workspace_id):
            return None
        return row

    async def list(
        self,
        model: str,
        *,
        filters: Mapping[str, Any] | None = None,
        order_by: str | None = None,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[Any]:
        rows = [
            row
            for row in self.table(model).values()
            if row.get("tenant_id") in (None, self.tenant_id)
            and row.get("workspace_id") in (None, self.workspace_id)
        ]
        for key, value in dict(filters or {}).items():
            if isinstance(value, (list, tuple, set)):
                rows = [row for row in rows if row.get(key) in value]
            else:
                rows = [row for row in rows if row.get(key) == value]
        if order_by:
            key = order_by.lstrip("-")
            rows.sort(key=lambda row: row.get(key) or 0, reverse=order_by.startswith("-"))
        rows = rows[offset:]
        return rows[:limit] if limit else rows

    async def add(self, model: str, values: Mapping[str, Any]) -> Any:
        payload = dict(values)
        payload.setdefault("tenant_id", self.tenant_id)
        payload.setdefault("workspace_id", self.workspace_id)
        payload.setdefault("id", f"{model.lower()}_{len(self.table(model)) + 1}")
        row = Row(payload)
        self.table(model)[str(row["id"])] = row
        return row

    async def update(self, model: str, entity_id: str, values: Mapping[str, Any]) -> Any:
        row = await self.get(model, entity_id)
        if row is None:
            return None
        row.update(dict(values))
        return row

    async def delete(self, model: str, entity_id: str) -> bool:
        return self.table(model).pop(str(entity_id), None) is not None

    async def commit(self) -> None:
        self.committed += 1


def field(entity: Any, name: str, default: Any = None) -> Any:
    """Read a field from an ORM object, a dict row or a Pydantic model."""
    if entity is None:
        return default
    if isinstance(entity, Mapping):
        return entity.get(name, default)
    return getattr(entity, name, default)


def fields(entity: Any, names: Sequence[str]) -> dict[str, Any]:
    return {name: field(entity, name) for name in names}


__all__ = [
    "COLUMN_ALIASES",
    "InMemoryRepository",
    "ModelNotAvailableError",
    "Models",
    "Repository",
    "RepositoryPort",
    "Row",
    "field",
    "fields",
    "translate",
]
