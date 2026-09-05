"""Add ``persona.gender`` — presentation gender for the 3D avatar body.

Revision ID: 0002_persona_gender
Revises: 0001_initial_schema
Create Date: 2026-09-05

Nullable on purpose: existing personas predate the field and the web resolves a
body from a name / voice heuristic when it is NULL. Kept as a short string
rather than a Postgres enum so a fourth value never needs an ``ALTER TYPE``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_persona_gender"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("persona", sa.Column("gender", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("persona", "gender")
