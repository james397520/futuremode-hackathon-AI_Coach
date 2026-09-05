"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

Checklist for a new revision (spec §40.2 / §74):
  * every new tenant-scoped table has NOT NULL, indexed ``tenant_id`` + ``workspace_id``
    (that is what puts it under the isolation guard in ``app.core.tenancy``);
  * tables holding learner content carry the soft-delete + retention columns;
  * a data backfill goes in its own revision, separate from the DDL.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}
revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
