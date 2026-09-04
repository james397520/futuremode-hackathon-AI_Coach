"""Initial schema — every §53 entity.

Revision ID: 0001_initial_schema
Revises: None
Create Date: 2026-09-04

Why this revision builds from ``Base.metadata`` instead of ~30 hand-written
``op.create_table`` calls
------------------------------------------------------------------------------
For the *first* revision the ORM metadata and the desired schema are by definition the
same thing, and transcribing 28 tables, 60+ indexes and every CHECK constraint by hand
introduces a class of bug that is invisible until production: a column that differs
between the models and the migration. Emitting the schema from the single source of
truth removes that gap entirely, and Postgres' transactional DDL means the whole thing
commits or rolls back as one unit.

Every *subsequent* revision must use explicit ``op.*`` operations (autogenerate then
review), because from that point on the metadata describes the target state, not the
delta — ``create_all`` would silently skip an ``ALTER``.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

from app.db.base import Base

# Registers all mappings on Base.metadata before create_all runs.
import app.db.models  # noqa: F401

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create the full schema.

    Tables (§53): organization, workspace, app_user, team, user_team, role_assignment,
    knowledge_base, document, document_version, chunk, embedding_index, question,
    question_version, persona, scenario, scenario_version, rubric, assignment,
    training_session, transcript_turn, persona_state_event, coach_insight, evaluation,
    evaluation_evidence, compliance_finding, report, audit_event, integration,
    runtime_policy.
    """
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=False)


def downgrade() -> None:
    """Drop the full schema (development only — this destroys tenant data)."""
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=False)
