"""Persist per-chapter author context without changing manuscripts or facts."""

import sqlalchemy as sa

from alembic import op

revision = "b73d2f809a61"
down_revision = "a12c7e604bc9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("chapters", sa.Column("references", sa.JSON(), server_default="{}", nullable=False))
    op.add_column("chapters", sa.Column("references_revision", sa.Integer(), server_default="0", nullable=False))


def downgrade():
    op.drop_column("chapters", "references_revision")
    op.drop_column("chapters", "references")
